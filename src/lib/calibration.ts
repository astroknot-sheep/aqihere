import { estimate, legacyEstimate, MODEL_ONLY } from "./estimate";
import { distanceKm } from "./geo";
import {
  POLLUTANTS,
  type Calibration,
  type EstimatorConfig,
  type StationRecord,
  type ValidationMetric,
} from "./types";

const CANDIDATES: EstimatorConfig[] = [
  MODEL_ONLY,
  ...[5, 15, 30].flatMap((lengthScaleKm) =>
    [0.3, 1, 3].flatMap((prior) =>
      [0.5, 1].map((gain) => ({ lengthScaleKm, prior, gain })),
    ),
  ),
];
function metrics(
  errors: number[],
  baseline: number[],
  legacy?: number[],
): ValidationMetric {
  const n = errors.length,
    rmse = (a: number[]) => Math.sqrt(a.reduce((s, x) => s + x * x, 0) / n),
    mae = (a: number[]) => a.reduce((s, x) => s + Math.abs(x), 0) / n;
  return {
    count: n,
    rmse: rmse(errors),
    mae: mae(errors),
    bias: errors.reduce((s, x) => s + x, 0) / n,
    modelRmse: rmse(baseline),
    modelMae: mae(baseline),
    ...(legacy ? { legacyRmse: rmse(legacy) } : {}),
    method: "Nested spatial holdout, 1 km exclusion buffer",
  };
}
// Whole ~4km cells share a fold. Individual monitors are never shuffled into
// different folds merely because their IDs differ.
function fold(s: StationRecord, count: number) {
  const y = Math.floor((s.lat * 111) / 4),
    x = Math.floor((s.lon * 111 * Math.cos((s.lat * Math.PI) / 180)) / 4);
  return (((x * 73856093) ^ (y * 19349663)) >>> 0) % count;
}
function prediction(
  target: StationRecord,
  training: StationRecord[],
  config: EstimatorConfig,
  now: number,
) {
  return estimate({
    point: target,
    model: { [target.pollutant]: target.model_ugm3! },
    observations: training.filter(
      (s) => s.id !== target.id && distanceKm(s, target) > 1,
    ),
    now,
    radiusKm: 25,
    configs: { [target.pollutant]: config },
  }).concentrations[target.pollutant]!;
}
function fit(
  records: StationRecord[],
  now: number,
  referenceTargets: boolean,
): EstimatorConfig {
  const targets = referenceTargets
    ? records.filter((s) => s.quality === "reference")
    : records;
  if (records.length < 12 || targets.length < 4) return MODEL_ONLY;
  const base = targets.map((s) => s.model_ugm3! - s.value_ugm3);
  const baseMetric = metrics(base, base);
  let best = MODEL_ONLY,
    bestRmse = baseMetric.rmse;
  for (const config of CANDIDATES.slice(1)) {
    const errors = targets.map(
      (target) =>
        prediction(
          target,
          records.filter((s) => fold(s, 3) !== fold(target, 3)),
          config,
          now,
        ) - target.value_ugm3,
    );
    const m = metrics(errors, base);
    if (
      m.rmse < bestRmse &&
      m.rmse < baseMetric.rmse * 0.97 &&
      m.mae < baseMetric.mae * 0.99
    ) {
      best = config;
      bestRmse = m.rmse;
    }
  }
  return best;
}

/** Hyperparameters are fit only inside the training portion of each outer
 * spatial fold. Targets and co-located sensors never choose their own model. */
export function calibrate(
  observations: StationRecord[],
  now: number,
): Calibration {
  const configs: Calibration["configs"] = {},
    validation: Calibration["validation"] = {};
  for (const pollutant of POLLUTANTS) {
    const records = observations.filter(
      (s) =>
        s.pollutant === pollutant &&
        s.averagingMinutes &&
        s.modelAveragingMinutes === s.averagingMinutes &&
        Number.isFinite(s.model_ugm3) &&
        Number.isFinite(s.value_ugm3) &&
        s.modelTs &&
        Date.parse(s.ts) <= now + 900000 &&
        now - Date.parse(s.ts) <= 7200000,
    );
    configs[pollutant] = MODEL_ONLY;
    const references = records.filter((s) => s.quality === "reference");
    const referenceTargets = references.length >= 6;
    const targets = referenceTargets ? references : records;
    if (records.length < 16 && !referenceTargets) {
      if (records.length) {
        const base = records.map((s) => s.model_ugm3! - s.value_ugm3);
        validation[pollutant] = {
          ...metrics(base, base),
          method: "Insufficient monitors for nested calibration; CAMS retained",
        };
      }
      continue;
    }
    const errors: number[] = [],
      base: number[] = [],
      legacy: number[] = [];
    for (let outer = 0; outer < 5; outer++) {
      const held = targets.filter((s) => fold(s, 5) === outer),
        train = records.filter((s) => fold(s, 5) !== outer);
      const config = fit(train, now, referenceTargets);
      for (const target of held) {
        errors.push(prediction(target, train, config, now) - target.value_ugm3);
        base.push(target.model_ugm3! - target.value_ugm3);
        const remaining = train.filter(
          (s) => s.id !== target.id && distanceKm(s, target) > 1,
        );
        legacy.push(
          legacyEstimate({
            point: target,
            model: { [pollutant]: target.model_ugm3! },
            observations: remaining,
            now,
            radiusKm: 25,
          }).concentrations[pollutant]! - target.value_ugm3,
        );
      }
    }
    const m = metrics(errors, base, legacy);
    validation[pollutant] = {
      ...m,
      referenceCount: targets.filter((s) => s.quality === "reference").length,
    };
    // The independent outer score must improve too. A failed correction is
    // disabled even if tuning on all observations could make it look better.
    if (m.rmse < m.modelRmse * 0.98 && m.mae < (m.modelMae ?? 0) * 0.99)
      configs[pollutant] = fit(records, now, referenceTargets);
  }
  return {
    algorithm: "robust-residual-v2",
    generatedAt: new Date(now).toISOString(),
    configs,
    validation,
    method:
      "Five outer spatial folds and three training folds with a 1 km exclusion buffer. Reference monitors are the targets when six or more are available. CAMS is retained when correction does not improve both RMSE and MAE.",
  };
}

/** Test the reference-only policy on later hours, with the target monitor
 * withheld in every hour. The evaluation hours never select parameters. */
export function calibrateWithHistory(
  observations: StationRecord[],
  history: StationRecord[],
  now: number,
): Calibration {
  const result = calibrate(observations, now);
  for (const pollutant of POLLUTANTS) {
    const hours = new Map<number, StationRecord[]>();
    for (const s of history) {
      const time = Date.parse(s.ts);
      if (
        s.pollutant !== pollutant ||
        s.quality !== "reference" ||
        s.modelAveragingMinutes !== 60 ||
        !Number.isFinite(s.model_ugm3) ||
        time % 3600000 !== 0 ||
        time > now
      )
        continue;
      hours.set(time, [...(hours.get(time) ?? []), s]);
    }
    const frames = [...hours.entries()]
      .filter(([, records]) => new Set(records.map((s) => s.id)).size >= 6)
      .sort(([a], [b]) => a - b);
    if (frames.length < 14) continue;
    const trainingEnd = Math.floor(frames.length * 0.6),
      selectionEnd = Math.floor(frames.length * 0.8);
    const training = frames.slice(0, trainingEnd),
      selection = frames.slice(trainingEnd, selectionEnd),
      testing = frames.slice(selectionEnd);
    const evaluate = (data: typeof frames, config: EstimatorConfig) =>
      data.flatMap(([time, records]) =>
        records.map(
          (target) =>
            prediction(target, records, config, time) - target.value_ugm3,
        ),
      );
    const trainBase = evaluate(training, MODEL_ONLY);
    const trainModel = metrics(trainBase, trainBase);
    let robust = MODEL_ONLY,
      best = trainModel;
    for (const config of CANDIDATES.slice(1)) {
      const referenceConfig = { ...config, referenceOnly: true };
      const score = metrics(evaluate(training, referenceConfig), trainBase);
      if (score.rmse < best.rmse && score.mae < trainModel.mae * 0.99) {
        robust = referenceConfig;
        best = score;
      }
    }
    const selectionBase = evaluate(selection, MODEL_ONLY),
      selectionModel = metrics(selectionBase, selectionBase);
    const weighted: EstimatorConfig = {
      lengthScaleKm: 15,
      prior: 1,
      gain: 1,
      referenceOnly: true,
      strategy: "weighted",
    };
    let selected = MODEL_ONLY,
      selectionBest = selectionModel.rmse;
    for (const config of [robust, weighted]) {
      const score = metrics(evaluate(selection, config), selectionBase);
      if (
        score.rmse < selectionBest &&
        score.rmse < selectionModel.rmse * 0.98 &&
        score.mae < selectionModel.mae * 0.99
      ) {
        selected = config;
        selectionBest = score.rmse;
      }
    }
    const baseline = evaluate(testing, MODEL_ONLY);
    const legacy = testing.flatMap(([time, records]) =>
      records.map(
        (target) =>
          legacyEstimate({
            point: target,
            model: { [pollutant]: target.model_ugm3! },
            observations: records.filter(
              (s) => s.id !== target.id && distanceKm(s, target) > 1,
            ),
            now: time,
            radiusKm: 25,
          }).concentrations[pollutant]! - target.value_ugm3,
      ),
    );
    const score = metrics(evaluate(testing, selected), baseline, legacy);
    result.validation[pollutant] = {
      ...score,
      referenceCount: new Set(
        testing.flatMap(([, records]) => records.map((s) => s.id)),
      ).size,
      holdoutHours: testing.length,
      method:
        "Later-hour reference holdout with each target station and its 1 km neighbours excluded",
    };
    result.configs[pollutant] = selected;
  }
  result.method =
    "Reference history uses separate chronological periods for fitting, choosing between correction methods and evaluating the result. Each target monitor and neighbours within 1 km are withheld. Sparse histories use nested spatial folds.";
  return result;
}
