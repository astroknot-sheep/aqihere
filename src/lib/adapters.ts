import type { Pollutant, StationRecord } from "./types";

type CitizenSensor = {
  sensor?: { id: number; sensor_type?: { name: string } };
  location?: {
    id: number;
    latitude: string;
    longitude: string;
    indoor?: number | string | boolean;
    exact_location?: number | string | boolean;
  };
  timestamp: string;
  sensordatavalues: { value_type: string; value: string }[];
};
export function normalizeCitizen(
  raw: CitizenSensor[],
  averagingMinutes = 5,
): StationRecord[] {
  if (!Array.isArray(raw)) return [];
  const humidityByLocation = new Map<number, number>();
  for (const s of raw) {
    const humidity = s.sensordatavalues?.find(
      (v) => v.value_type === "humidity",
    );
    if (humidity && s.location)
      humidityByLocation.set(s.location.id, Number(humidity.value));
  }
  return raw.flatMap((s) => {
    if (
      !s.location ||
      !s.sensor ||
      [1, "1", true].includes(s.location.indoor ?? false)
    )
      return [];
    const ts = s.timestamp.includes("T")
      ? s.timestamp
      : s.timestamp.replace(" ", "T");
    const timestamp = /Z$|[+-]\d\d:\d\d$/.test(ts) ? ts : `${ts}Z`;
    return (s.sensordatavalues ?? []).flatMap((v) => {
      const pollutant: Pollutant | null =
        v.value_type === "P2" ? "pm2_5" : v.value_type === "P1" ? "pm10" : null;
      if (!pollutant) return [];
      return [
        {
          id: `sc-${s.sensor!.id}`,
          name: `Community sensor ${s.sensor!.id}`,
          source: "sensor-community" as const,
          lat: Number(s.location!.latitude),
          lon: Number(s.location!.longitude),
          pollutant,
          value_ugm3: Number(v.value),
          ts: timestamp,
          quality: "citizen" as const,
          averagingMinutes,
          humidity: humidityByLocation.get(s.location!.id),
          attribution: "Sensor.Community (ODbL)",
          coordinateQuality: [1, "1", true].includes(
            s.location!.exact_location ?? false,
          )
            ? ("declared-exact" as const)
            : ("approximate" as const),
        },
      ];
    });
  });
}
export type OpenAQLocation = {
  id: number;
  name: string;
  isMonitor: boolean;
  isMobile?: boolean;
  coordinates: { latitude: number; longitude: number };
  sensors: { id: number; parameter: { name: string; units: string } }[];
  licenses?: { name: string; attribution?: { name: string; url?: string } }[];
};
export type OpenAQLatest = {
  value: number;
  sensorsId: number;
  datetime: { utc: string };
  coordinates?: { latitude: number; longitude: number };
};
export function normalizeOpenAQ(
  location: OpenAQLocation,
  latest: OpenAQLatest[],
): StationRecord[] {
  if (location.isMobile) return [];
  return latest.flatMap((m) => {
    const sensor = location.sensors.find((s) => s.id === m.sensorsId);
    if (!sensor) return [];
    const pollutants: Record<string, Pollutant> = {
      pm25: "pm2_5",
      pm10: "pm10",
      no2: "nitrogen_dioxide",
      o3: "ozone",
      so2: "sulphur_dioxide",
      co: "carbon_monoxide",
    };
    const pollutant = pollutants[sensor.parameter.name];
    if (!pollutant) return [];
    let value = m.value;
    const unit = sensor.parameter.units.toLowerCase().replace("μ", "µ");
    if (unit === "ppm" || unit === "ppb") {
      const mass =
        pollutant === "ozone"
          ? 48
          : pollutant === "nitrogen_dioxide"
            ? 46.0055
            : pollutant === "sulphur_dioxide"
              ? 64.066
              : pollutant === "carbon_monoxide"
                ? 28.01
                : null;
      if (!mass) return [];
      value *= (mass / 24.45) * (unit === "ppm" ? 1000 : 1);
    } else if (["mg/m³", "mg/m3"].includes(unit)) value *= 1000;
    else if (!["µg/m³", "ug/m3", "µg/m3"].includes(unit)) return [];
    const coord = m.coordinates ?? location.coordinates;
    return [
      {
        id: `oa-${location.id}`,
        name: location.name,
        source: "openaq" as const,
        lat: coord.latitude,
        lon: coord.longitude,
        pollutant,
        value_ugm3: value,
        ts: m.datetime.utc,
        quality: location.isMonitor
          ? ("reference" as const)
          : ("citizen" as const),
        averagingMinutes: null,
        attribution:
          (location.licenses ?? [])
            .map(
              (l) => `${l.attribution?.name ?? "OpenAQ provider"} (${l.name})`,
            )
            .join("; ") || "OpenAQ and original provider",
      },
    ];
  });
}
