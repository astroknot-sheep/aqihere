import { test } from "node:test";
import assert from "node:assert/strict";
import {
  aqi,
  averagedConcentrations,
  currentModelIndex,
  nowCast,
  subIndex,
} from "../src/lib/aqi";
import { matchingModelMean } from "../src/lib/model";
import { mergeHistory } from "../src/lib/history";
import { calibrate } from "../src/lib/calibration";
import { estimate, MODEL_ONLY } from "../src/lib/estimate";
import { normalizeCitizen } from "../src/lib/adapters";
import { measuredStationIndex, streetEvidence } from "../src/lib/street";
import type { StationRecord } from "../src/lib/types";
const now = Date.parse("2026-11-10T12:00:00Z");
const record = (overrides: Partial<StationRecord> = {}): StationRecord => ({
  id: "one",
  name: "one",
  source: "sensor-community",
  lat: 52.5,
  lon: 13.4,
  pollutant: "pm2_5",
  value_ugm3: 10,
  ts: new Date(now).toISOString(),
  quality: "citizen",
  averagingMinutes: 60,
  model_ugm3: 20,
  modelTs: new Date(now).toISOString(),
  modelAveragingMinutes: 60,
  ...overrides,
});
test("EPA PM NowCast responds to abrupt changes, preserves gaps, and handles clean air", () => {
  assert.equal(nowCast([0, 0, 0]), 0);
  assert.equal(nowCast(Array(12).fill(12)), 12);
  assert.equal(nowCast([10, undefined, 20]), 12);
  assert.equal(nowCast([undefined, undefined, 20, 20]), undefined);
  assert.ok(nowCast([100, ...Array(11).fill(10)])! > 55);
  assert.ok(nowCast([100, ...Array(11).fill(10)])! < 56);
});
test("CO and SO2 can dominate the full index; severe SO2 uses 24h concentration", () => {
  assert.equal(
    subIndex("carbon_monoxide", ((9.4 * 28.01) / 24.45) * 1000, "us"),
    100,
  );
  assert.equal(
    aqi({ pm2_5: 0, carbon_monoxide: ((9.4 * 28.01) / 24.45) * 1000 }, "us")
      .dominant,
    "carbon_monoxide",
  );
  const so2 = (ppb: number) => (ppb * 64.066) / 24.45;
  assert.equal(
    aqi({ sulphur_dioxide: so2(400) }, "us", undefined, so2(100)).value,
    200,
  );
  assert.equal(
    aqi({ sulphur_dioxide: so2(400) }, "us", undefined, so2(604)).value,
    300,
  );
  assert.equal(subIndex("carbon_monoxide", 2000, "india"), 100);
  assert.equal(subIndex("carbon_monoxide", 2000, "eu"), null);
});
test("undefined Indian Severe endpoints are lower bounds; EU boundaries are continuous", () => {
  assert.equal(aqi({ pm2_5: 300 }, "india").aboveRange, true);
  assert.equal(aqi({ pm2_5: 250 }, "india").aboveRange, false);
  assert.equal(subIndex("pm2_5", 5.1, "eu"), 2);
});
test("baseline integration respects actual averaging windows and missing model hours", () => {
  const series = [0, 3600, 7200].map((time) => ({
    time,
    values: { pm2_5: time / 60 },
  }));
  assert.equal(matchingModelMean(series, 4800, "pm2_5", 60), 50);
  assert.equal(matchingModelMean(series, 4800, "pm2_5", 5), 77.5);
  assert.equal(
    matchingModelMean([series[0], series[2]], 4800, "pm2_5", 60),
    undefined,
  );
});
test("history retains real past observations without copying values into missing hours", () => {
  const old = record({ ts: new Date(now - 3600000).toISOString() }),
    future = record({ ts: new Date(now + 1).toISOString() });
  const kept = mergeHistory([old], [record(), future], now);
  assert.equal(kept.length, 2);
  assert.ok(kept.every((s) => Date.parse(s.ts) <= now));
  assert.equal(
    new Set(kept.map((s) => Math.floor(Date.parse(s.ts) / 3600000))).size,
    2,
  );
});
test("indoor sensors are excluded, with zero concentrations preserved", () => {
  const raw = {
    sensor: { id: 1 },
    location: { id: 1, latitude: "52", longitude: "13", indoor: 1 },
    timestamp: "2026-11-10 12:00:00",
    sensordatavalues: [{ value_type: "P2", value: "0" }],
  };
  assert.equal(normalizeCitizen([raw], 60).length, 0);
  assert.equal(
    normalizeCitizen(
      [{ ...raw, location: { ...raw.location, indoor: 0 } }],
      60,
    )[0].value_ugm3,
    0,
  );
});
test("sparse or unhelpful monitors cannot enable an unvalidated correction", () => {
  const sparse = calibrate([record()], now);
  assert.equal(sparse.configs.pm2_5?.gain, 0);
  const records = Array.from({ length: 20 }, (_, i) =>
    record({
      id: `s${i}`,
      lat: 52.3 + i * 0.02,
      lon: 13.1 + (i % 5) * 0.07,
      value_ugm3: 20,
    }),
  );
  const fit = calibrate(records, now);
  assert.equal(fit.configs.pm2_5?.gain, 0);
  assert.equal(
    estimate({
      point: records[0],
      model: { pm2_5: 20 },
      observations: records,
      now,
      configs: { pm2_5: MODEL_ONLY },
    }).stations.length,
    0,
  );
});
test("unknown averaging windows never enter residual correction", () => {
  const s = record({ averagingMinutes: null });
  assert.equal(
    estimate({ point: s, model: { pm2_5: 20 }, observations: [s], now })
      .stations.length,
    0,
  );
});
test("the current US index uses the correct clock-hour slots and ignores future values", () => {
  const at = now / 1000;
  const hourly = [
    { time: at, values: { pm2_5: 10 } },
    { time: at - 7200, values: { pm2_5: 20 } },
    { time: at + 3600, values: { pm2_5: 999 } },
  ];
  assert.equal(averagedConcentrations(hourly, at, "us").pm2_5, 12);
});

test("current AQI uses the hourly grid in fractional-offset time zones", () => {
  const currentTime = Date.parse("2026-11-10T13:00:00Z") / 1000;
  const indexTime = currentTime - 1800;
  const hours = Array.from({ length: 24 }, (_, i) => ({
    time: indexTime - (23 - i) * 3600,
    values: { pm2_5: 88.7, nitrogen_dioxide: 79.1 },
  }));
  const future = { time: indexTime + 3600, values: { pm2_5: 999 } };
  for (const standard of ["us", "india", "eu"] as const) {
    const result = currentModelIndex([...hours, future], currentTime, standard);
    assert.equal(result.indexTime, indexTime);
    assert.ok(Math.abs(result.average.pm2_5! - 88.7) < 1e-9);
    assert.equal(result.index.dominant, "pm2_5");
  }
  const gap = currentModelIndex(
    [...hours.slice(0, -1), future],
    currentTime,
    "us",
  );
  assert.equal(gap.indexTime, indexTime);
  assert.equal(gap.average.nitrogen_dioxide, undefined);
  assert.ok(Math.abs(gap.average.pm2_5! - 88.7) < 1e-9);
  assert.equal(
    currentModelIndex([future], currentTime, "us").index.value,
    null,
  );
  assert.equal(currentModelIndex(hours, indexTime, "us").indexTime, indexTime);
});

test("street searches enforce the selected radius, source position and GPS uncertainty", () => {
  const point = { lat: 52.5, lon: 13.4 };
  const monitor = record({
    lat: 52.5003,
    quality: "reference",
    coordinateQuality: "official",
  });
  const approximate = record({
    id: "approx",
    coordinateQuality: "approximate",
  });
  const stale = record({
    id: "stale",
    coordinateQuality: "declared-exact",
    ts: new Date(now - 7200001).toISOString(),
  });
  const evidence = [monitor, approximate, stale];
  assert.equal(streetEvidence(point, 10, evidence, now).length, 0);
  assert.equal(streetEvidence(point, 25, evidence, now).length, 0);
  assert.equal(
    streetEvidence(point, 50, evidence, now)[0].station.id,
    monitor.id,
  );
  assert.equal(
    streetEvidence({ ...point, accuracyMeters: 20 }, 50, evidence, now).length,
    0,
  );
  assert.equal(
    streetEvidence({ ...point, accuracyMeters: 20 }, 100, evidence, now).length,
    1,
  );
});
test("measured street AQI requires the selected monitor's own completed hourly readings", () => {
  const current = record({
    quality: "reference",
    averagingMinutes: 60,
    value_ugm3: 12,
  });
  const past = { ...current, ts: new Date(now - 3600000).toISOString() };
  assert.equal(
    measuredStationIndex(
      current.id,
      [current, { ...past, id: "neighbour" }],
      "us",
      now,
    ),
    null,
  );
  assert.equal(
    measuredStationIndex(
      current.id,
      [current, { ...past, value_ugm3: NaN }],
      "us",
      now,
    ),
    null,
  );
  const result = measuredStationIndex(current.id, [current, past], "us", now);
  assert.equal(result?.value, subIndex("pm2_5", 12, "us"));
  assert.equal(result?.pollutantCount, 1);
});
