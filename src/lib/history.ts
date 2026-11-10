import type { StationRecord } from "./types";

/** Keep one genuine observation per monitor/pollutant/hour. Never fill a
 * missing hour by copying today's residual into the past. */
export function mergeHistory(
  previous: StationRecord[],
  current: StationRecord[],
  now: number,
): StationRecord[] {
  const buckets = new Map<string, StationRecord>();
  for (const s of [...previous, ...current]) {
    const timestamp = Date.parse(s.ts);
    if (
      !Number.isFinite(timestamp) ||
      timestamp > now ||
      now - timestamp > 26 * 3600000 ||
      s.averagingMinutes !== 60
    )
      continue;
    if (
      s.coordinateQuality !== "official" &&
      (!Number.isFinite(s.model_ugm3) || s.modelAveragingMinutes !== 60)
    )
      continue;
    const key = `${s.id}:${s.pollutant}:${Math.floor(timestamp / 3600000)}`;
    const old = buckets.get(key);
    if (!old || timestamp > Date.parse(old.ts)) buckets.set(key, s);
  }
  return [...buckets.values()]
    .sort((a, b) => Date.parse(a.ts) - Date.parse(b.ts))
    .slice(-5200);
}
