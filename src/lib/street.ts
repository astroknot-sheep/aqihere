import { aqi, averagedConcentrations, periodMean } from "./aqi";
import { distanceKm } from "./geo";
import type { ModelData, Point, Standard, StationRecord } from "./types";

export function streetEvidence(
  point: Point,
  radiusMeters: number,
  observations: StationRecord[],
  now: number,
) {
  const byStation = new Map<
    string,
    {
      station: StationRecord;
      distanceMeters: number;
      readings: StationRecord[];
    }
  >();
  for (const reading of observations) {
    if (!Number.isFinite(reading.value_ugm3) || reading.value_ugm3 < 0)
      continue;
    const age = now - Date.parse(reading.ts);
    if (
      !Number.isFinite(age) ||
      age < 0 ||
      age > 7200000 ||
      (reading.coordinateQuality !== "official" &&
        reading.coordinateQuality !== "declared-exact")
    )
      continue;
    const distanceMeters = 1000 * distanceKm(point, reading);
    if (
      !Number.isFinite(distanceMeters) ||
      distanceMeters + Math.max(0, point.accuracyMeters ?? 0) > radiusMeters
    )
      continue;
    const station = byStation.get(reading.id);
    if (station) station.readings.push(reading);
    else
      byStation.set(reading.id, {
        station: reading,
        distanceMeters,
        readings: [reading],
      });
  }
  return [...byStation.values()].sort(
    (a, b) =>
      Number(b.station.quality === "reference") -
        Number(a.station.quality === "reference") ||
      a.distanceMeters - b.distanceMeters,
  );
}

/** A measured station index uses only that monitor's completed hourly
 * observations. It never substitutes regional model data for a missing hour. */
export function measuredStationIndex(
  id: string,
  records: StationRecord[],
  standard: Standard,
  now: number,
) {
  const byTime = new Map<number, ModelData["hourly"][number]>();
  for (const r of records) {
    const time = Date.parse(r.ts) / 1000;
    if (
      r.id !== id ||
      r.quality !== "reference" ||
      r.averagingMinutes !== 60 ||
      !Number.isFinite(r.value_ugm3) ||
      r.value_ugm3 < 0 ||
      !Number.isFinite(time) ||
      time % 3600 !== 0 ||
      time * 1000 > now ||
      now - time * 1000 > 24 * 3600000
    )
      continue;
    const hour = byTime.get(time) ?? { time, values: {} };
    hour.values[r.pollutant] = r.value_ugm3;
    byTime.set(time, hour);
  }
  if (!byTime.size) return null;
  const at = Math.max(...byTime.keys());
  if (now - at * 1000 > 7200000) return null;
  const hourly = [...byTime.values()];
  const index = aqi(
    averagedConcentrations(hourly, at, standard),
    standard,
    byTime.get(at)?.values.ozone,
    periodMean(hourly, at, "sulphur_dioxide", 24),
  );
  return index.value === null
    ? null
    : {
        ...index,
        time: at,
        pollutantCount: new Set(index.indices.map((s) => s.pollutant)).size,
      };
}
