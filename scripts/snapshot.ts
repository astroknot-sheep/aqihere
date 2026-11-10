import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  normalizeCitizen,
  normalizeOpenAQ,
  type OpenAQLatest,
  type OpenAQLocation,
} from "../src/lib/adapters";
import { clusterCitizens, qualityControl } from "../src/lib/estimate";
import { fetchJSON } from "../src/lib/fetch";
import { distanceKm, inBounds } from "../src/lib/geo";
import { attachModelBaselines, type BaselineCache } from "../src/lib/model";
import { calibrateWithHistory } from "../src/lib/calibration";
import { mergeHistory } from "../src/lib/history";
import { fetchBerlinHistory } from "./berlin";
import type {
  SourceStatus,
  StationRecord,
  StationSnapshot,
} from "../src/lib/types";

async function main() {
  const bounds = (process.env.SNAPSHOT_BBOX ?? "12.9,52.25,13.9,52.8")
    .split(",")
    .map(Number) as StationSnapshot["bounds"];
  if (
    bounds.length !== 4 ||
    !bounds.every(Number.isFinite) ||
    bounds[0] >= bounds[2] ||
    bounds[1] >= bounds[3] ||
    bounds[0] < -180 ||
    bounds[2] > 180 ||
    bounds[1] < -85 ||
    bounds[3] > 85
  )
    throw new Error(
      "SNAPSHOT_BBOX must be west,south,east,north within map bounds",
    );
  const statuses: SourceStatus[] = [];
  const userAgent = "AQIHere/1.1 (https://github.com/astroknot-sheep/aqihere)";
  const now = Date.now();
  const baseURL =
    process.env.SNAPSHOT_PREVIOUS_BASE_URL ??
    "https://raw.githubusercontent.com/astroknot-sheep/aqihere/snapshots/data";
  const previousPromise = fetchJSON<StationSnapshot>(
    `${baseURL}/stations.json`,
    { timeoutMs: 8000 },
  ).catch(() => null);
  const cachePromise = fetchJSON<BaselineCache>(
    `${baseURL}/baseline-cache.json`,
    { timeoutMs: 8000 },
  ).catch(() => ({ version: 2 as const, entries: [] }));
  const berlinPromise = (async () => {
    if (
      bounds[0] > 13.8 ||
      bounds[1] > 52.7 ||
      bounds[2] < 13.05 ||
      bounds[3] < 52.3
    )
      return [];
    const started = Date.now();
    try {
      const data = await fetchBerlinHistory(bounds, now);
      statuses.push({
        source: "Berlin BLUME",
        status: data.length ? "ok" : "unavailable",
        latencyMs: Date.now() - started,
        detail: `${data.length} completed hourly reference readings`,
      });
      return data;
    } catch {
      statuses.push({
        source: "Berlin BLUME",
        status: "unavailable",
        latencyMs: Date.now() - started,
        detail: "Reference feed unavailable",
      });
      return [];
    }
  })();
  const sources = await Promise.allSettled([
    (async (): Promise<StationRecord[]> => {
      const start = Date.now();
      if (process.env.ENABLE_SENSOR_COMMUNITY === "false") {
        statuses.push({
          source: "Sensor.Community",
          status: "disabled",
          latencyMs: 0,
        });
        return [];
      }
      try {
        // One bulk fetch per run, never one call per monitor or user.
        const raw = await fetchJSON<Parameters<typeof normalizeCitizen>[0]>(
          "https://data.sensor.community/static/v2/data.1h.json",
          { headers: { "User-Agent": userAgent }, timeoutMs: 45000 },
        );
        const records = normalizeCitizen(raw, 60).filter((s) =>
          inBounds(s, bounds),
        );
        statuses.push({
          source: "Sensor.Community",
          status: "ok",
          latencyMs: Date.now() - start,
          detail: `${records.length} regional observations`,
        });
        return records;
      } catch (error) {
        statuses.push({
          source: "Sensor.Community",
          status: "unavailable",
          latencyMs: Date.now() - start,
          detail: error instanceof Error ? error.message : "Fetch failed",
        });
        return [];
      }
    })(),
    (async (): Promise<StationRecord[]> => {
      const start = Date.now(),
        key = process.env.OPENAQ_API_KEY;
      if (!key || process.env.ENABLE_OPENAQ === "false") {
        statuses.push({
          source: "OpenAQ",
          status: "disabled",
          latencyMs: 0,
          detail: "No API key configured, or source disabled",
        });
        return [];
      }
      try {
        const headers = { "X-API-Key": key, "User-Agent": userAgent };
        // Bounding box avoids OpenAQ's 25 km radius cap. A small launch region
        // intentionally caps fan-out at 12 locations (13 calls per run).
        const locations = await fetchJSON<{ results: OpenAQLocation[] }>(
          `https://api.openaq.org/v3/locations?bbox=${bounds.join(",")}&limit=100`,
          { headers, timeoutMs: 15000 },
        );
        const selected = locations.results
          .filter(
            (l) =>
              !l.isMobile &&
              l.sensors.some((s) =>
                ["pm25", "pm10", "no2", "o3", "so2", "co"].includes(
                  s.parameter.name,
                ),
              ),
          )
          .slice(0, 12);
        const records: StationRecord[] = [];
        let failures = 0;
        // Serial calls remain comfortably under the 60 requests/minute quota.
        for (const location of selected) {
          try {
            const latest = await fetchJSON<{ results: OpenAQLatest[] }>(
              `https://api.openaq.org/v3/locations/${location.id}/latest`,
              { headers, timeoutMs: 10000 },
            );
            records.push(...normalizeOpenAQ(location, latest.results));
          } catch {
            failures++;
          }
        }
        statuses.push({
          source: "OpenAQ",
          status:
            failures === selected.length && selected.length
              ? "unavailable"
              : "ok",
          latencyMs: Date.now() - start,
          detail: `${selected.length} locations, ${failures} failed; provider averaging periods retained as unspecified`,
        });
        return records;
      } catch (error) {
        statuses.push({
          source: "OpenAQ",
          status: "unavailable",
          latencyMs: Date.now() - start,
          detail: error instanceof Error ? error.message : "Fetch failed",
        });
        return [];
      }
    })(),
  ]);
  const berlin = await berlinPromise;
  const clean = qualityControl(
    [
      ...sources.flatMap((r) => (r.status === "fulfilled" ? r.value : [])),
      ...berlin,
    ],
    now,
  );
  const streetObservations = clean.filter(
    (s) =>
      s.coordinateQuality === "official" ||
      s.coordinateQuality === "declared-exact",
  );
  let records = clusterCitizens(clean);
  // Preserve references first, then cap citizens for a compact regional file.
  const center = {
    lat: (bounds[1] + bounds[3]) / 2,
    lon: (bounds[0] + bounds[2]) / 2,
  };
  records.sort(
    (a, b) =>
      (a.quality === "reference" ? 0 : 1) -
        (b.quality === "reference" ? 0 : 1) ||
      distanceKm(a, center) - distanceKm(b, center),
  );
  const ids = [...new Set(records.map((r) => r.id))].slice(0, 96);
  records = records.filter((r) => ids.includes(r.id));
  const annotated: StationRecord[] = [];
  const [previous, baselineCache] = await Promise.all([
    previousPromise,
    cachePromise,
  ]);
  if (baselineCache.version !== 2) {
    baselineCache.version = 2;
    baselineCache.entries = [];
  }
  for (let i = 0; i < ids.length; i += 12) {
    const batch = records.filter((r) => ids.slice(i, i + 12).includes(r.id));
    try {
      annotated.push(
        ...(await attachModelBaselines(batch, undefined, baselineCache)),
      );
    } catch {
      annotated.push(...batch);
    }
  }
  let berlinAnnotated = berlin;
  try {
    berlinAnnotated = await attachModelBaselines(
      berlin,
      undefined,
      baselineCache,
    );
  } catch {
    /* Measured station history is still usable. */
  }
  const history = mergeHistory(
    previous?.history?.filter((s) => inBounds(s, bounds)) ?? [],
    [...berlinAnnotated, ...annotated],
    now,
  );
  const calibration = calibrateWithHistory(annotated, history, now);
  const validation = calibration.validation;
  const snapshot: StationSnapshot = {
    version: 1,
    generatedAt: new Date(now).toISOString(),
    region: process.env.SNAPSHOT_REGION ?? "Berlin region",
    bounds,
    observations: annotated,
    validation,
    statuses,
    history,
    calibration,
    streetObservations,
  };
  const directory = path.resolve(
    process.env.SNAPSHOT_OUTPUT_DIR ?? "work/snapshots",
  );
  await mkdir(directory, { recursive: true });
  await writeFile(
    path.join(directory, "stations.json"),
    JSON.stringify(snapshot),
  );
  baselineCache.entries = baselineCache.entries
    .filter((e) => now - e.fetchedAt < 2 * 3600000)
    .slice(-120);
  await writeFile(
    path.join(directory, "baseline-cache.json"),
    JSON.stringify(baselineCache),
  );
  await writeFile(
    path.join(directory, "validation.json"),
    JSON.stringify(
      {
        generatedAt: snapshot.generatedAt,
        region: snapshot.region,
        method: calibration.method,
        metrics: validation,
        configs: calibration.configs,
        historyHours: new Set(
          history.map((s) => Math.floor(Date.parse(s.ts) / 3600000)),
        ).size,
      },
      null,
      2,
    ),
  );
  console.log(
    JSON.stringify(
      {
        region: snapshot.region,
        stations: new Set(annotated.map((r) => r.id)).size,
        observations: annotated.length,
        statuses,
        validation,
        output: directory,
      },
      null,
      2,
    ),
  );
  if (statuses.every((s) => s.status !== "ok"))
    throw new Error(
      "All sources unavailable; keeping previous published snapshot",
    );
}
main().catch((error) => {
  console.error(error instanceof Error ? error.message : "Snapshot failed");
  process.exitCode = 1;
});
