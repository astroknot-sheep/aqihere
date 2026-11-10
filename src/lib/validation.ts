import { estimate } from "./estimate";
import { distanceKm } from "./geo";
import { POLLUTANTS, type StationRecord, type ValidationMetric } from "./types";

export function validateSnapshot(observations: StationRecord[]) {
  const metrics: Partial<
    Record<(typeof POLLUTANTS)[number], ValidationMetric>
  > = {};
  for (const pollutant of POLLUTANTS) {
    const errors: number[] = [],
      modelErrors: number[] = [];
    for (const target of observations.filter(
      (s) =>
        s.pollutant === pollutant && Number.isFinite(s.model_ugm3) && s.modelTs,
    )) {
      const remaining = observations.filter(
        (s) => s.id !== target.id && distanceKm(s, target) > 1,
      );
      const prediction = estimate({
        point: target,
        model: { [pollutant]: target.model_ugm3! },
        observations: remaining,
        now: Date.parse(target.ts),
      });
      errors.push(prediction.concentrations[pollutant]! - target.value_ugm3);
      modelErrors.push(target.model_ugm3! - target.value_ugm3);
    }
    if (errors.length)
      metrics[pollutant] = {
        count: errors.length,
        rmse: Math.sqrt(errors.reduce((a, e) => a + e * e, 0) / errors.length),
        mae: errors.reduce((a, e) => a + Math.abs(e), 0) / errors.length,
        bias: errors.reduce((a, e) => a + e, 0) / errors.length,
        modelRmse: Math.sqrt(
          modelErrors.reduce((a, e) => a + e * e, 0) / errors.length,
        ),
      };
  }
  return metrics;
}
