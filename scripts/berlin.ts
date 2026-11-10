import { fetchJSON } from "../src/lib/fetch";
import { inBounds } from "../src/lib/geo";
import type {
  Pollutant,
  StationRecord,
  StationSnapshot,
} from "../src/lib/types";

const API = "https://luftdaten.berlin.de/api";
export const BERLIN_ATTRIBUTION =
  "Land Berlin, Berliner Luftgütemessnetz (BLUME), dl-de-by-2.0";
const components: Record<string, Pollutant> = {
  pm2: "pm2_5",
  pm10: "pm10",
  no2: "nitrogen_dioxide",
  o3: "ozone",
  so2: "sulphur_dioxide",
  co: "carbon_monoxide",
};
type BerlinStation = {
  code: string;
  name: string;
  lat: string;
  lng: string;
  stationgroups: string[];
  activeComponents: string[];
};
type BerlinReading = {
  datetime: string;
  station: string;
  core: string;
  period: string;
  value: number | null;
};

export async function fetchBerlinHistory(
  bounds: StationSnapshot["bounds"],
  now: number,
) {
  const stations = await fetchJSON<BerlinStation[]>(
    `${API}/stations?active=true`,
    { timeoutMs: 10000 },
  );
  const locations = new Map(
    stations
      .filter((s) =>
        inBounds({ lat: Number(s.lat), lon: Number(s.lng) }, bounds),
      )
      .map((s) => [s.code, s]),
  );
  const cores = Object.keys(components).filter((core) =>
    [...locations.values()].some((s) =>
      s.activeComponents.includes(`${core}_1h`),
    ),
  );
  const results = await Promise.allSettled(
    cores.map((core) =>
      fetchJSON<BerlinReading[]>(
        `${API}/cores/${core}/data?period=1h&timespan=lastday&stationgroup=all`,
        { timeoutMs: 12000 },
      ),
    ),
  );
  if (cores.length && results.every((r) => r.status === "rejected"))
    throw new Error("Berlin hourly measurements are unavailable");
  const records: StationRecord[] = [];
  for (const result of results) {
    if (result.status !== "fulfilled") continue;
    for (const m of result.value) {
      const s = locations.get(m.station),
        pollutant = components[m.core],
        time = Date.parse(m.datetime);
      if (
        !s ||
        !pollutant ||
        m.period !== "1h" ||
        typeof m.value !== "number" ||
        !Number.isFinite(m.value) ||
        m.value < 0 ||
        !Number.isFinite(time) ||
        time > now ||
        now - time > 26 * 3600000
      )
        continue;
      records.push({
        id: `blume-${s.code}`,
        name: s.name,
        source: "berlin-blume",
        lat: Number(s.lat),
        lon: Number(s.lng),
        pollutant,
        value_ugm3: m.value * (pollutant === "carbon_monoxide" ? 1000 : 1),
        ts: new Date(time).toISOString(),
        quality: "reference",
        averagingMinutes: 60,
        coordinateQuality: "official",
        siteType: s.stationgroups.includes("traffic")
          ? "roadside"
          : s.stationgroups.includes("suburb")
            ? "suburban background"
            : "urban background",
        attribution: BERLIN_ATTRIBUTION,
      });
    }
  }
  return records;
}
