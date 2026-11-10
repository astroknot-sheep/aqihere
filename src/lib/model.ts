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
  cache?: BaselineCache,
): Promise<StationRecord[]> {
  const missing = records.filter(
    (s) =>
      !finite(s.model_ugm3) ||
      !s.modelTs ||
      s.modelAveragingMinutes !== s.averagingMinutes,
  );
  const unique = [...new Map(missing.map((s) => [s.id, s])).values()].slice(
    0,
    96,
  );
  if (!unique.length) return records;
  const lookup = new Map<string, ModelData>();
  for (const s of unique) {
    const entry = cache?.entries.find(
      (e) =>
        e.id === s.id &&
        e.lat === s.lat &&
        e.lon === s.lon &&
        Date.now() - e.fetchedAt < 3600000 &&
        e.model.hourly.some((h) => h.time >= Date.parse(s.ts) / 1000),
    );
    if (entry) lookup.set(s.id, entry.model);
  }
  const pending = unique.filter((s) => !lookup.has(s.id));
  if (pending.length) {
    const response = await fetchJSON<RawAir | RawAir[]>(airURL(pending), {
      signal,
      timeoutMs: 12000,
    });
    const models = (Array.isArray(response) ? response : [response]).map(
      normalizeAir,
    );
    pending.forEach((s, i) => {
      lookup.set(s.id, models[i]);
      if (cache) {
        cache.entries = cache.entries.filter((e) => e.id !== s.id);
        cache.entries.push({
          id: s.id,
          lat: s.lat,
          lon: s.lon,
          fetchedAt: Date.now(),
          model: models[i],
        });
      }
    });
  }
  return records.map((s) => {
    if (
      finite(s.model_ugm3) &&
      s.modelTs &&
      s.modelAveragingMinutes === s.averagingMinutes
    )
      return s;
    const model = lookup.get(s.id);
    if (!model || !s.averagingMinutes || s.averagingMinutes > 120) return s;
    const value = matchingModelMean(
      model.hourly,
      Date.parse(s.ts) / 1000,
      s.pollutant,
      s.averagingMinutes,
    );
    if (!finite(value)) return s;
    return {
      ...s,
      model_ugm3: value,
      modelTs: s.ts,
      modelAveragingMinutes: s.averagingMinutes,
    };
  });
}

export type BaselineCache = {
  version: 2;
  entries: {
    id: string;
    lat: number;
    lon: number;
    fetchedAt: number;
    model: ModelData;
  }[];
};
/** Integrate the model's piecewise-linear field over the sensor's actual
 * averaging window. A 1h mean must not be compared with an instantaneous grid. */
export function matchingModelMean(
  hourly: ModelData["hourly"],
  end: number,
  pollutant: (typeof POLLUTANTS)[number],
  minutes: number,
): number | undefined {
  if (!Number.isFinite(end) || minutes <= 0) return undefined;
  const start = end - minutes * 60,
    series = hourly
      .filter((h) => Number.isFinite(h.values[pollutant]))
      .sort((a, b) => a.time - b.time);
  let area = 0,
    covered = 0;
  for (let i = 1; i < series.length; i++) {
    const a = series[i - 1],
      b = series[i];
    if (b.time - a.time !== 3600) continue;
    const lo = Math.max(start, a.time),
      hi = Math.min(end, b.time);
    if (hi <= lo) continue;
    const value = (t: number) =>
      a.values[pollutant]! +
      ((b.values[pollutant]! - a.values[pollutant]!) * (t - a.time)) /
        (b.time - a.time);
    area += ((value(lo) + value(hi)) / 2) * (hi - lo);
    covered += hi - lo;
  }
  return Math.abs(covered - (end - start)) < 0.01 ? area / covered : undefined;
}
