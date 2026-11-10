import { test } from "node:test";
import assert from "node:assert/strict";
import {
  aqi,
  averagedConcentrations,
  category,
  subIndex,
} from "../src/lib/aqi";
import { normalizeCitizen, normalizeOpenAQ } from "../src/lib/adapters";
import {
  airDensity,
  clusterCitizens,
  estimate,
  qualityControl,
} from "../src/lib/estimate";
import { distanceKm } from "../src/lib/geo";
import { normalizeAir } from "../src/lib/model";
import { validateSnapshot } from "../src/lib/validation";
import type { StationRecord } from "../src/lib/types";
const now = Date.parse("2026-11-10T10:00:00Z");
const station = (overrides: Partial<StationRecord> = {}): StationRecord => ({
  id: "s1",
  name: "Test reference",
  source: "openaq",
  lat: 0,
  lon: 0,
  pollutant: "pm2_5",
  value_ugm3: 30,
  model_ugm3: 10,
  modelTs: new Date(now).toISOString(),
  modelAveragingMinutes: 60,
  ts: new Date(now).toISOString(),
  quality: "reference",
  averagingMinutes: 60,
  ...overrides,
});

test("EPA 2024 PM2.5 endpoints and truncation", () => {
  for (const [c, expected] of [
    [0, 0],
    [9, 50],
    [9.1, 51],
    [35.4, 100],
    [55.4, 150],
    [125.4, 200],
    [225.4, 300],
    [325.4, 500],
  ])
    assert.equal(subIndex("pm2_5", c, "us"), expected);
  assert.equal(subIndex("pm2_5", 9.09, "us"), 50);
  assert.equal(subIndex("pm2_5", NaN, "us"), null);
  assert.ok(subIndex("pm2_5", 500, "us")! > 500);
});
test("India and revised EEA categories remain distinct", () => {
  assert.equal(subIndex("pm2_5", 30, "india"), 50);
  assert.equal(subIndex("pm2_5", 60, "india"), 100);
  assert.equal(subIndex("pm2_5", 90, "india"), 200);
  for (const [c, band] of [
    [5, 1],
    [6, 2],
    [15, 2],
    [16, 3],
    [50, 3],
    [51, 4],
    [91, 5],
    [141, 6],
  ])
    assert.equal(subIndex("pm2_5", c, "eu"), band);
  assert.equal(category(4, "eu").label, "Poor");
});
test("AQI is the worst available sub-index; missing is not zero", () => {
  assert.equal(aqi({ pm2_5: 9, pm10: 154 }, "us").value, 100);
  assert.equal(aqi({}, "us").value, null);
  assert.equal(aqi({ pm2_5: 0 }, "us", (604 * 48) / 24.45).value, 500);
});
test("averaging uses past data only and requires 75% coverage", () => {
  const at = now / 1000;
  const hours = Array.from({ length: 25 }, (_, i) => ({
    time: at - (23 - i) * 3600,
    values: { pm2_5: i === 24 ? 999 : 12, ozone: 48 },
  }));
  assert.equal(averagedConcentrations(hours, at, "us").pm2_5, 12);
  assert.equal(averagedConcentrations(hours.slice(-8), at, "us").pm2_5, 12);
  assert.equal(averagedConcentrations(hours, at, "us").ozone, 48);
});
test("residual correction shrinks to model and excludes invalid stations", () => {
  const input = {
    point: { lat: 0, lon: 0 },
    model: { pm2_5: 10 },
    observations: [station()],
    now,
    configs: { pm2_5: { lengthScaleKm: 15, prior: 1, gain: 1 } },
  };
  assert.equal(estimate(input).concentrations.pm2_5, 20);
  assert.equal(
    estimate({ ...input, point: { lat: 10, lon: 10 } }).concentrations.pm2_5,
    10,
  );
  assert.equal(
    estimate({ ...input, observations: [station({ model_ugm3: undefined })] })
      .stations.length,
    0,
  );
  assert.equal(
    estimate({
      ...input,
      observations: [
        station({ ts: new Date(now - 3 * 3600000).toISOString() }),
      ],
    }).stations.length,
    0,
  );
  assert.equal(
    estimate({
      ...input,
      observations: [
        station({ modelTs: new Date(now - 3 * 3600000).toISOString() }),
      ],
    }).stations.length,
    0,
  );
  assert.equal(
    estimate({
      ...input,
      observations: [station({ value_ugm3: 0, model_ugm3: 100 })],
    }).concentrations.pm2_5,
    0,
  );
});
test("unvalidated wind directions do not change concentration estimates", () => {
  const north = station({ id: "north", lat: 0.05 }),
    south = station({ id: "south", lat: -0.05, value_ugm3: 0 });
  const input = {
    point: { lat: 0, lon: 0 },
    model: { pm2_5: 10 },
    observations: [north, south],
    now,
  };
  const upwind = estimate({ ...input, wind: { speed: 3, direction: 0 } });
  assert.equal(
    upwind.stations.find((s) => s.id === "north")!.weight,
    upwind.stations.find((s) => s.id === "south")!.weight,
  );
  const calm = estimate({ ...input, wind: { speed: 0, direction: 0 } });
  assert.equal(calm.stations[0].weight, calm.stations[1].weight);
});
test("density uses moist air physics only as a diagnostic", () => {
  const dry = airDensity({ temperature: 15, pressure: 1013.25, humidity: 0 });
  assert.ok(Math.abs(dry - 1.225) < 0.002);
  assert.ok(
    airDensity({ temperature: 15, pressure: 1013.25, humidity: 90 }) < dry,
  );
});
test("QC rejects stale, high-RH citizen, NaN and neighbor outliers", () => {
  const records = [
    station(),
    station({ id: "old", ts: "2026-11-09T00:00:00Z" }),
    station({ id: "nan", value_ugm3: NaN }),
    station({ id: "humid", quality: "citizen", humidity: 90 }),
    station({ id: "citizen1", quality: "citizen", value_ugm3: 999 }),
  ];
  const neighbors = [1, 2, 3].map((n) =>
    station({ id: `neighbor${n}`, lat: n * 0.002 }),
  );
  const cleaned = qualityControl([...records, ...neighbors], now);
  assert.deepEqual(
    cleaned.map((s) => s.id),
    ["s1", "neighbor1", "neighbor2", "neighbor3"],
  );
  const clustered = clusterCitizens([
    station({ quality: "citizen", id: "c1", value_ugm3: 2 }),
    station({ quality: "citizen", id: "c2", value_ugm3: 3 }),
    station({ quality: "citizen", id: "c3", value_ugm3: 100 }),
    station(),
  ]);
  assert.equal(clustered.length, 2);
  assert.equal(clustered[1].value_ugm3, 3);
});
test("adapters retain UTC, averaging, units and zero values", () => {
  const citizen = normalizeCitizen(
    [
      {
        sensor: { id: 1 },
        location: { id: 2, latitude: "1", longitude: "2" },
        timestamp: "2026-11-10 10:00:00",
        sensordatavalues: [{ value_type: "P2", value: "0" }],
      },
    ],
    60,
  );
  assert.equal(citizen[0].ts, "2026-11-10T10:00:00Z");
  assert.equal(citizen[0].value_ugm3, 0);
  assert.equal(citizen[0].averagingMinutes, 60);
  const ozone = normalizeOpenAQ(
    {
      id: 1,
      name: "Reference",
      isMonitor: true,
      coordinates: { latitude: 0, longitude: 0 },
      sensors: [{ id: 2, parameter: { name: "o3", units: "ppb" } }],
    },
    [
      {
        value: 100,
        sensorsId: 2,
        datetime: { utc: new Date(now).toISOString() },
      },
    ],
  );
  assert.ok(Math.abs(ozone[0].value_ugm3 - 196.319) < 0.01);
  assert.equal(ozone[0].averagingMinutes, null);
  assert.equal(
    normalizeAir({
      current: { time: now / 1000, pm2_5: 0, pm10: null },
      hourly: { time: [] },
    }).current.pm2_5,
    0,
  );
  assert.equal(
    normalizeAir({ current: { time: now / 1000, pm2_5: 0, pm10: null } })
      .current.pm10,
    undefined,
  );
});
test("spatial holdout excludes co-located monitors and reports model baseline", () => {
  const records = [station(), station({ id: "same-place", lat: 0.0001 })];
  const metrics = validateSnapshot(records).pm2_5!;
  assert.equal(metrics.count, 2);
  assert.equal(metrics.rmse, 20);
  assert.equal(metrics.modelRmse, 20);
  assert.equal(distanceKm({ lat: 0, lon: 0 }, { lat: 0, lon: 0 }), 0);
});
