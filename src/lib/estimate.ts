import { bearing, distanceKm } from "./geo";
import {
  POLLUTANTS,
  type Concentrations,
  type EstimateResult,
  type Point,
  type StationRecord,
  type Weather,
} from "./types";

export function airDensity(
  weather: Pick<Weather, "temperature" | "pressure" | "humidity">,
) {
  const kelvin = weather.temperature + 273.15;
  const vapor =
    (Math.max(0, Math.min(100, weather.humidity)) / 100) *
    610.94 *
    Math.exp((17.625 * weather.temperature) / (weather.temperature + 243.04));
  const pressure = weather.pressure * 100;
  return (pressure - vapor) / (287.058 * kelvin) + vapor / (461.495 * kelvin);
}

export function estimate(input: {
  point: Point;
  model: Concentrations;
  observations: StationRecord[];
  now: number;
  radiusKm?: number;
  lengthScaleKm?: number;
  wind?: { speed: number; direction: number };
}): EstimateResult {
  const {
    point,
    model,
    observations,
    now,
    radiusKm = 25,
    lengthScaleKm = 15,
    wind,
  } = input;
  const concentrations = { ...model };
  const corrections: Concentrations = {};
  const stations: EstimateResult["stations"] = [];
  // Only residuals matched to a model value at the observation hour are usable.
  for (const s of observations) {
    const ageHours = (now - Date.parse(s.ts)) / 3_600_000;
    const distance = distanceKm(point, s);
    if (
      !Number.isFinite(ageHours) ||
      ageHours < -0.25 ||
      ageHours > 2 ||
      !Number.isFinite(distance) ||
      distance > radiusKm ||
      !Number.isFinite(s.value_ugm3) ||
      s.value_ugm3 < 0 ||
      !Number.isFinite(s.model_ugm3)
    )
      continue;
    if (
      !s.modelTs ||
      !Number.isFinite(Date.parse(s.modelTs)) ||
      Math.abs(Date.parse(s.ts) - Date.parse(s.modelTs)) > 3_600_000
    )
      continue;
    const windStrength = wind
      ? Math.min(1, Math.max(0, (wind.speed - 0.5) / 1.5))
      : 0;
    const alignment = wind
      ? Math.cos(((bearing(point, s) - wind.direction) * Math.PI) / 180)
      : 0;
    // Wind direction is where air comes FROM. A station on that bearing is upwind.
    const windWeight = 1 + 0.35 * windStrength * alignment;
    const weight =
      Math.exp(-distance / lengthScaleKm) *
      Math.exp(-Math.max(0, ageHours) / 2) *
      (s.quality === "reference" ? 1 : 0.35) *
      windWeight;
    stations.push({ ...s, distance, weight });
  }
  for (const pollutant of POLLUTANTS) {
    if (!Number.isFinite(model[pollutant])) continue;
    const usable = stations.filter((s) => s.pollutant === pollutant);
    const weightSum = usable.reduce((sum, s) => sum + s.weight, 0);
    // One unit of zero-residual model prior guarantees smooth reversion to CAMS.
    const correction =
      usable.reduce(
        (sum, s) => sum + s.weight * (s.value_ugm3 - s.model_ugm3!),
        0,
      ) /
      (1 + weightSum);
    corrections[pollutant] = correction;
    concentrations[pollutant] = Math.max(0, model[pollutant]! + correction);
  }
  const unique = new Set(stations.map((s) => s.id));
  return {
    concentrations,
    corrections,
    stations: stations.sort((a, b) => a.distance - b.distance),
    support: unique.size >= 3 ? "local" : unique.size ? "limited" : "model",
  };
}

export function qualityControl(
  records: StationRecord[],
  now: number,
): StationRecord[] {
  const limits = {
    pm2_5: 1000,
    pm10: 2000,
    nitrogen_dioxide: 2000,
    ozone: 1500,
  };
  const valid = records.filter(
    (s) =>
      Number.isFinite(s.value_ugm3) &&
      s.value_ugm3 >= 0 &&
      s.value_ugm3 <= limits[s.pollutant] &&
      Number.isFinite(s.lat) &&
      Number.isFinite(s.lon) &&
      Math.abs(s.lat) <= 90 &&
      Math.abs(s.lon) <= 180 &&
      now - Date.parse(s.ts) <= 2 * 3_600_000 &&
      now - Date.parse(s.ts) >= -900_000 &&
      !(
        s.quality === "citizen" &&
        s.humidity !== undefined &&
        s.humidity >= 85
      ),
  );
  const seen = new Map<string, StationRecord>();
  for (const s of valid) {
    const key = `${s.source}:${s.id}:${s.pollutant}`;
    const previous = seen.get(key);
    if (!previous || Date.parse(s.ts) > Date.parse(previous.ts))
      seen.set(key, s);
  }
  const deduplicated = [...seen.values()];
  return deduplicated.filter((s) => {
    if (s.quality === "reference") return true;
    const neighbors = deduplicated
      .filter(
        (n) =>
          n.id !== s.id && n.pollutant === s.pollutant && distanceKm(s, n) <= 5,
      )
      .map((n) => n.value_ugm3)
      .sort((a, b) => a - b);
    if (neighbors.length < 3) return true;
    const median = neighbors[Math.floor(neighbors.length / 2)];
    return Math.abs(s.value_ugm3 - median) <= Math.max(30, median * 2);
  });
}

// Nearby citizen monitors share errors. One median per ~1 km cell prevents
// a dense group of low-cost monitors from overwhelming a reference station.
export function clusterCitizens(records: StationRecord[]): StationRecord[] {
  const groups = new Map<string, StationRecord[]>();
  const result = records.filter((s) => s.quality === "reference");
  for (const s of records.filter((s) => s.quality === "citizen")) {
    const key = `${s.pollutant}:${Math.floor(s.lat * 100)}:${Math.floor(s.lon * Math.cos((s.lat * Math.PI) / 180) * 100)}`;
    groups.set(key, [...(groups.get(key) ?? []), s]);
  }
  for (const values of groups.values()) {
    values.sort((a, b) => a.value_ugm3 - b.value_ugm3);
    result.push(values[Math.floor(values.length / 2)]);
  }
  return result;
}
