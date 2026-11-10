import {
  POLLUTANTS,
  type Concentrations,
  type ModelData,
  type Pollutant,
  type Standard,
} from "./types";
type Band = [number, number, number, number];
const US: Record<Pollutant, Band[]> = {
  pm2_5: [
    [0, 9, 0, 50],
    [9.1, 35.4, 51, 100],
    [35.5, 55.4, 101, 150],
    [55.5, 125.4, 151, 200],
    [125.5, 225.4, 201, 300],
    [225.5, 325.4, 301, 500],
  ],
  pm10: [
    [0, 54, 0, 50],
    [55, 154, 51, 100],
    [155, 254, 101, 150],
    [255, 354, 151, 200],
    [355, 424, 201, 300],
    [425, 604, 301, 500],
  ],
  nitrogen_dioxide: [
    [0, 53, 0, 50],
    [54, 100, 51, 100],
    [101, 360, 101, 150],
    [361, 649, 151, 200],
    [650, 1249, 201, 300],
    [1250, 2049, 301, 500],
  ],
  ozone: [
    [0, 54, 0, 50],
    [55, 70, 51, 100],
    [71, 85, 101, 150],
    [86, 105, 151, 200],
    [106, 200, 201, 300],
  ],
  sulphur_dioxide: [
    [0, 35, 0, 50],
    [36, 75, 51, 100],
    [76, 185, 101, 150],
    [186, 304, 151, 200],
  ],
  carbon_monoxide: [
    [0, 4.4, 0, 50],
    [4.5, 9.4, 51, 100],
    [9.5, 12.4, 101, 150],
    [12.5, 15.4, 151, 200],
    [15.5, 30.4, 201, 300],
    [30.5, 50.4, 301, 500],
  ],
};
// CPCB's terminal Severe band has no finite concentration endpoint. Never
// invent one: concentrations in that band are reported as an index >400.
const INDIA: Record<Pollutant, Band[]> = {
  pm2_5: [
    [0, 30, 0, 50],
    [31, 60, 51, 100],
    [61, 90, 101, 200],
    [91, 120, 201, 300],
    [121, 250, 301, 400],
  ],
  pm10: [
    [0, 50, 0, 50],
    [51, 100, 51, 100],
    [101, 250, 101, 200],
    [251, 350, 201, 300],
    [351, 430, 301, 400],
  ],
  nitrogen_dioxide: [
    [0, 40, 0, 50],
    [41, 80, 51, 100],
    [81, 180, 101, 200],
    [181, 280, 201, 300],
    [281, 400, 301, 400],
  ],
  ozone: [
    [0, 50, 0, 50],
    [51, 100, 51, 100],
    [101, 168, 101, 200],
    [169, 208, 201, 300],
    [209, 748, 301, 400],
  ],
  sulphur_dioxide: [
    [0, 40, 0, 50],
    [41, 80, 51, 100],
    [81, 380, 101, 200],
    [381, 800, 201, 300],
    [801, 1600, 301, 400],
  ],
  carbon_monoxide: [
    [0, 1, 0, 50],
    [1.1, 2, 51, 100],
    [2.1, 10, 101, 200],
    [10.1, 17, 201, 300],
    [17.1, 34, 301, 400],
  ],
};
const EU_LIMITS: Partial<Record<Pollutant, number[]>> = {
  pm2_5: [5, 15, 50, 90, 140],
  pm10: [15, 45, 120, 195, 270],
  nitrogen_dioxide: [10, 25, 60, 100, 150],
  ozone: [60, 100, 120, 160, 180],
  sulphur_dioxide: [20, 40, 125, 190, 275],
};
const truncate = (v: number, precision = 0) =>
  Math.floor((v + 1e-9) * 10 ** precision) / 10 ** precision;
function interpolate(v: number, bands: Band[]) {
  const b = bands.find((b) => v <= b[1]) ?? bands.at(-1)!;
  return Math.max(
    0,
    Math.round(
      ((b[3] - b[2]) / (b[1] - b[0])) * (Math.max(b[0], v) - b[0]) + b[2],
    ),
  );
}
export function subIndex(
  pollutant: Pollutant,
  concentration: number,
  standard: Standard,
): number | null {
  if (!Number.isFinite(concentration) || concentration < 0) return null;
  if (standard === "eu") {
    const limits = EU_LIMITS[pollutant];
    if (!limits) return null;
    const idx = limits.findIndex((v) => concentration <= v);
    return idx < 0 ? 6 : idx + 1;
  }
  let v = concentration;
  if (standard === "us") {
    const masses: Partial<Record<Pollutant, number>> = {
      nitrogen_dioxide: 46.0055,
      ozone: 48,
      sulphur_dioxide: 64.066,
      carbon_monoxide: 28.01,
    };
    if (masses[pollutant])
      v *=
        24.45 /
        masses[pollutant]! /
        (pollutant === "carbon_monoxide" ? 1000 : 1);
    v = truncate(
      v,
      pollutant === "pm2_5" || pollutant === "carbon_monoxide" ? 1 : 0,
    );
    if (pollutant === "ozone" && v > 200) return null;
    if (pollutant === "sulphur_dioxide" && v >= 305) return 200;
    return interpolate(v, US[pollutant]);
  }
  if (pollutant === "carbon_monoxide") v = Math.round((v / 1000) * 10) / 10;
  else v = Math.round(v);
  const bands = INDIA[pollutant];
  return v > bands.at(-1)![1] ? 401 : interpolate(v, bands);
}
export function aqi(
  concentrations: Concentrations,
  standard: Standard,
  oneHourOzone?: number,
  so2Daily?: number,
) {
  const indices = Object.entries(concentrations)
    .map(([p, value]) => ({
      pollutant: p as Pollutant,
      value: subIndex(p as Pollutant, value, standard),
    }))
    .filter(
      (x): x is { pollutant: Pollutant; value: number } => x.value !== null,
    );
  if (
    standard === "us" &&
    oneHourOzone !== undefined &&
    Number.isFinite(oneHourOzone)
  ) {
    const ppb = truncate((oneHourOzone * 24.45) / 48);
    if (ppb >= 125)
      indices.push({
        pollutant: "ozone",
        value: interpolate(ppb, [
          [125, 164, 101, 150],
          [165, 204, 151, 200],
          [205, 404, 201, 300],
          [405, 604, 301, 500],
        ]),
      });
  }
  if (
    standard === "us" &&
    so2Daily !== undefined &&
    Number.isFinite(so2Daily)
  ) {
    const ppb = truncate((so2Daily * 24.45) / 64.066);
    if (ppb >= 305)
      indices.push({
        pollutant: "sulphur_dioxide",
        value: interpolate(ppb, [
          [305, 604, 201, 300],
          [605, 1004, 301, 500],
        ]),
      });
  }
  if (!indices.length)
    return { value: null, dominant: null, indices, aboveRange: false };
  const max = indices.reduce((a, b) => (a.value >= b.value ? a : b));
  return {
    value: max.value,
    dominant: max.pollutant,
    indices,
    aboveRange: standard === "india" && max.value > 400,
  };
}
/** EPA PM NowCast: clock-hour gaps retain their original exponents and at
 * least two of the last three hours must be present. Zero pollution is valid. */
export function nowCast(
  values: (number | null | undefined)[],
): number | undefined {
  const recent = values.slice(0, 12);
  const valid = (v: unknown): v is number =>
    typeof v === "number" && Number.isFinite(v) && v >= 0;
  if (recent.slice(0, 3).filter(valid).length < 2) return undefined;
  const numbers = recent.filter(valid),
    max = Math.max(...numbers),
    min = Math.min(...numbers);
  const factor = max === 0 ? 1 : Math.max(0.5, min / max);
  let numerator = 0,
    denominator = 0;
  recent.forEach((v, h) => {
    if (valid(v)) {
      const w = factor ** h;
      numerator += v * w;
      denominator += w;
    }
  });
  return numerator / denominator;
}
export function periodMean(
  hourly: ModelData["hourly"],
  at: number,
  pollutant: Pollutant,
  hours: number,
): number | undefined {
  const byTime = new Map(hourly.map((h) => [h.time, h.values[pollutant]]));
  const values = Array.from({ length: hours }, (_, i) =>
    byTime.get(at - i * 3600),
  ).filter(
    (v): v is number => typeof v === "number" && Number.isFinite(v) && v >= 0,
  );
  return values.length >= Math.ceil(hours * 0.75)
    ? values.reduce((a, b) => a + b, 0) / values.length
    : undefined;
}
export function averagedConcentrations(
  hourly: ModelData["hourly"],
  at: number,
  standard: Standard,
): Concentrations {
  const out: Concentrations = {},
    byTime = new Map(hourly.map((h) => [h.time, h.values]));
  for (const p of POLLUTANTS) {
    let v: number | undefined;
    if (standard === "us" && (p === "pm2_5" || p === "pm10"))
      v = nowCast(
        Array.from({ length: 12 }, (_, i) => byTime.get(at - i * 3600)?.[p]),
      );
    else {
      const hours =
        standard === "eu"
          ? 1
          : p === "ozone" || p === "carbon_monoxide"
            ? 8
            : standard === "us"
              ? 1
              : 24;
      v = periodMean(hourly, at, p, hours);
    }
    if (v !== undefined) out[p] = v;
  }
  return out;
}

export const SCALE = {
  us: {
    label: "US AQI",
    max: 500,
    boundaries: [50, 100, 150, 200, 300, 500],
    names: [
      "Good",
      "Moderate",
      "Unhealthy for some",
      "Unhealthy",
      "Very unhealthy",
      "Hazardous",
    ],
  },
  india: {
    label: "India AQI",
    max: 500,
    boundaries: [50, 100, 200, 300, 400, 500],
    names: ["Good", "Satisfactory", "Moderate", "Poor", "Very poor", "Severe"],
  },
  eu: {
    label: "EU band",
    max: 6,
    boundaries: [1, 2, 3, 4, 5, 6],
    names: ["Good", "Fair", "Moderate", "Poor", "Very poor", "Extremely poor"],
  },
};
export const COLORS = [
  "#4d966d",
  "#c9a844",
  "#d98841",
  "#cc6254",
  "#956a9e",
  "#8c455e",
];
export function category(value: number | null, standard: Standard) {
  const index =
    value === null
      ? 0
      : Math.min(
          5,
          SCALE[standard].boundaries.findIndex((n) => value <= n) === -1
            ? 5
            : SCALE[standard].boundaries.findIndex((n) => value <= n),
        );
  return {
    index,
    label: value === null ? "Unavailable" : SCALE[standard].names[index],
    color: value === null ? "#7d8c82" : COLORS[index],
  };
}
export const POLLUTANT_LABEL: Record<Pollutant, string> = {
  pm2_5: "PM₂.₅",
  pm10: "PM₁₀",
  nitrogen_dioxide: "NO₂",
  ozone: "O₃",
  sulphur_dioxide: "SO₂",
  carbon_monoxide: "CO",
};
