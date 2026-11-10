import { fetchJSON } from "./fetch";
import {
  POLLUTANTS,
  type Concentrations,
  type ModelData,
  type Point,
  type StationRecord,
  type Weather,
} from "./types";

type RawAir = {
  current?: Record<string, number | null>;
  timezone?: string;
  elevation?: number;
  hourly?: { time: number[]; [key: string]: (number | null)[] };
};
const finite = (v: unknown): v is number =>
  typeof v === "number" && Number.isFinite(v);
export function normalizeAir(raw: RawAir): ModelData {
  const current: Concentrations = {};
  for (const p of POLLUTANTS)
    if (finite(raw.current?.[p])) current[p] = raw.current![p]!;
  const hourly = (raw.hourly?.time ?? []).filter(finite).map((time, i) => {
    const values: Concentrations = {};
    for (const p of POLLUTANTS)
      if (finite(raw.hourly?.[p]?.[i])) values[p] = raw.hourly![p][i]!;
    return { time, values };
  });
  if (!hourly.length && !Object.keys(current).length)
    throw new Error("Air-quality data are missing for this point.");
  const time = raw.current?.time;
  return {
    time: finite(time) ? time : Math.floor(Date.now() / 1000 / 3600) * 3600,
    timezone: raw.timezone ?? "UTC",
    current,
    hourly,
    aod: finite(raw.current?.aerosol_optical_depth)
      ? raw.current!.aerosol_optical_depth!
      : null,
    elevation: finite(raw.elevation) ? raw.elevation : null,
  };
}
export function airURL(points: Point[], historical = true) {
  const url = new URL("https://air-quality-api.open-meteo.com/v1/air-quality");
  url.search = new URLSearchParams({
    latitude: points.map((p) => p.lat.toFixed(4)).join(","),
    longitude: points.map((p) => p.lon.toFixed(4)).join(","),
    current: [...POLLUTANTS, "aerosol_optical_depth"].join(","),
    hourly: POLLUTANTS.join(","),
    past_days: historical ? "2" : "1",
    forecast_days: "2",
    timezone: "auto",
    timeformat: "unixtime",
  }).toString();
  return url.toString();
}
export async function fetchAir(
  point: Point,
  signal?: AbortSignal,
): Promise<ModelData> {
  return normalizeAir(await fetchJSON<RawAir>(airURL([point]), { signal }));
}
export async function fetchWeather(
  point: Point,
  signal?: AbortSignal,
): Promise<Weather> {
  const params = new URLSearchParams({
    latitude: String(point.lat),
    longitude: String(point.lon),
    current:
      "temperature_2m,relative_humidity_2m,surface_pressure,wind_speed_10m,wind_direction_10m",
    wind_speed_unit: "ms",
    forecast_days: "1",
  });
  const raw = await fetchJSON<{
    current: Record<string, number>;
    elevation?: number;
  }>(`https://api.open-meteo.com/v1/forecast?${params}`, {
    signal,
    timeoutMs: 6000,
  });
  const c = raw.current;
  if (
    !c ||
    ![
      c.temperature_2m,
      c.relative_humidity_2m,
      c.surface_pressure,
      c.wind_speed_10m,
      c.wind_direction_10m,
    ].every(finite)
  )
    throw new Error("Weather data unavailable");
  return {
    temperature: c.temperature_2m,
    humidity: c.relative_humidity_2m,
    pressure: c.surface_pressure,
    windSpeed: c.wind_speed_10m,
    windDirection: c.wind_direction_10m,
    elevation: raw.elevation ?? null,
  };
}
export async function attachModelBaselines(
  records: StationRecord[],
  signal?: AbortSignal,
): Promise<StationRecord[]> {
  const missing = records.filter((s) => !finite(s.model_ugm3) || !s.modelTs);
  const unique = [...new Map(missing.map((s) => [s.id, s])).values()].slice(
    0,
    12,
  );
  if (!unique.length) return records;
  const response = await fetchJSON<RawAir | RawAir[]>(airURL(unique), {
    signal,
    timeoutMs: 6000,
  });
  const models = (Array.isArray(response) ? response : [response]).map(
    normalizeAir,
  );
  const lookup = new Map(unique.map((s, i) => [s.id, models[i]]));
  return records.map((s) => {
    if (finite(s.model_ugm3) && s.modelTs) return s;
    const model = lookup.get(s.id);
    const at = Math.floor(Date.parse(s.ts) / 3_600_000) * 3600;
    const hourly = model?.hourly.find((h) => h.time === at);
    if (!hourly || !finite(hourly.values[s.pollutant])) return s;
    return {
      ...s,
      model_ugm3: hourly.values[s.pollutant],
      modelTs: new Date(at * 1000).toISOString(),
    };
  });
}
