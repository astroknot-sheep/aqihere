import { calibrate } from "./calibration";
import type { StationRecord } from "./types";
export function validateSnapshot(observations: StationRecord[]) {
  const timestamps = observations
    .map((s) => Date.parse(s.ts))
    .filter(Number.isFinite);
  return calibrate(
    observations,
    timestamps.length ? Math.max(...timestamps) : Date.now(),
  ).validation;
}
