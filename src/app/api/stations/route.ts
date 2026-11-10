import { normalizeCitizen } from "@/lib/adapters";
import { clusterCitizens, qualityControl } from "@/lib/estimate";
import { fetchJSON } from "@/lib/fetch";
import { inBounds, validPoint } from "@/lib/geo";
import type {
  SourceStatus,
  StationResponse,
  StationSnapshot,
} from "@/lib/types";

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const lat = Number(params.get("lat")),
    lon = Number(params.get("lon"));
  if (!params.has("lat") || !params.has("lon") || !validPoint(lat, lon))
    return Response.json(
      { error: "Valid latitude and longitude are required." },
      { status: 400 },
    );
  const statuses: SourceStatus[] = [];
  const now = Date.now();
  // The browser sends a 0.1-degree bucket. CDN caching survives cold starts.
  const center = {
    lat: Math.round(lat * 10) / 10,
    lon: Math.round(lon * 10) / 10,
  };
  const snapshotURL = process.env.STATION_SNAPSHOT_URL;
  if (snapshotURL) {
    const started = Date.now();
    try {
      const snapshot = await fetchJSON<StationSnapshot>(snapshotURL, {
        timeoutMs: 1800,
        next: { revalidate: 300 },
      } as RequestInit & { timeoutMs: number });
      const age = now - Date.parse(snapshot.generatedAt);
      if (
        snapshot.version === 1 &&
        Array.isArray(snapshot.observations) &&
        age >= -900000 &&
        age <= 2 * 3600000 &&
        inBounds(center, snapshot.bounds)
      ) {
        const observations = clusterCitizens(
          qualityControl(snapshot.observations, now),
        );
        if (observations.length)
          return respond({
            observations,
            tier: "snapshot",
            generatedAt: snapshot.generatedAt,
            statuses: [
              ...snapshot.statuses,
              {
                source: "Snapshot",
                status: "ok",
                latencyMs: Date.now() - started,
              },
            ],
            validation: snapshot.validation,
          });
      }
      statuses.push({
        source: "Snapshot",
        status: "unavailable",
        latencyMs: Date.now() - started,
        detail: "No fresh coverage at this location",
      });
    } catch {
      statuses.push({
        source: "Snapshot",
        status: "unavailable",
        latencyMs: Date.now() - started,
        detail: "Snapshot temporarily unavailable",
      });
    }
  }
  if (process.env.ENABLE_SENSOR_COMMUNITY !== "false") {
    const started = Date.now();
    try {
      const dx = Math.min(
        10,
        0.6 / Math.max(0.1, Math.cos((center.lat * Math.PI) / 180)),
      );
      const box = [
        Math.max(-85, center.lat - 0.6),
        Math.max(-180, center.lon - dx),
        Math.min(85, center.lat + 0.6),
        Math.min(180, center.lon + dx),
      ].join(",");
      const data = await fetchJSON<Parameters<typeof normalizeCitizen>[0]>(
        `https://data.sensor.community/airrohr/v1/filter/box=${box}`,
        {
          headers: {
            "User-Agent":
              "AQIHere/1.0 (https://github.com/astroknot-sheep/aqihere)",
          },
          timeoutMs: 2500,
          next: { revalidate: 300 },
        } as RequestInit & { timeoutMs: number },
      );
      const observations = clusterCitizens(
        qualityControl(normalizeCitizen(data), now),
      );
      statuses.push({
        source: "Sensor.Community",
        status: "ok",
        latencyMs: Date.now() - started,
        detail: `${new Set(observations.map((s) => s.id)).size} fresh monitors in area`,
      });
      return respond({
        observations,
        tier: observations.length ? "live" : "model",
        generatedAt: new Date(now).toISOString(),
        statuses,
        validation: {},
      });
    } catch {
      statuses.push({
        source: "Sensor.Community",
        status: "unavailable",
        latencyMs: Date.now() - started,
        detail: "Live station lookup timed out or failed",
      });
    }
  } else
    statuses.push({
      source: "Sensor.Community",
      status: "disabled",
      latencyMs: 0,
    });
  return respond({
    observations: [],
    tier: "model",
    generatedAt: null,
    statuses,
    validation: {},
  });
}
function respond(data: StationResponse) {
  console.info(
    JSON.stringify({
      event: "station_lookup",
      tier: data.tier,
      count: data.observations.length,
      sources: data.statuses,
    }),
  );
  return Response.json(data, {
    headers: {
      "Cache-Control":
        "public, max-age=60, s-maxage=300, stale-while-revalidate=300",
    },
  });
}
