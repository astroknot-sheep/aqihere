import type { Concentrations, ModelData, Pollutant, Standard } from "./types";
type Band = [number, number, number, number];
// EPA 2024 PM2.5 breakpoints. US gases use ppb at the EPA reference
// conditions (25 C, 1 atm), not weather-dependent ambient conversion.
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
};
const INDIA: Record<Pollutant, Band[]> = {
  pm2_5: [
    [0, 30, 0, 50],
    [31, 60, 51, 100],
    [61, 90, 101, 200],
    [91, 120, 201, 300],
    [121, 250, 301, 400],
    [251, 500, 401, 500],
  ],
  pm10: [
    [0, 50, 0, 50],
    [51, 100, 51, 100],
    [101, 250, 101, 200],
    [251, 350, 201, 300],
    [351, 430, 301, 400],
    [431, 600, 401, 500],
  ],
  nitrogen_dioxide: [
    [0, 40, 0, 50],
    [41, 80, 51, 100],
    [81, 180, 101, 200],
    [181, 280, 201, 300],
    [281, 400, 301, 400],
    [401, 1000, 401, 500],
  ],
  ozone: [
    [0, 50, 0, 50],
    [51, 100, 51, 100],
    [101, 168, 101, 200],
    [169, 208, 201, 300],
    [209, 748, 301, 400],
    [749, 1000, 401, 500],
  ],
};
// EEA 2025 revision: six ordinal categories, all pollutants hourly.
// The EEA publishes category bands, not a 0–100 numerical AQI.
const EU_LIMITS: Record<Pollutant, number[]> = {
  pm2_5: [5, 15, 50, 90, 140],
  pm10: [15, 45, 120, 195, 270],
  nitrogen_dioxide: [10, 25, 60, 100, 150],
  ozone: [60, 100, 120, 160, 180],
};
export function subIndex(
  pollutant: Pollutant,
  concentration: number,
  standard: Standard,
): number | null {
  if (!Number.isFinite(concentration) || concentration < 0) return null;
  if (standard === "eu") {
    const bounds = EU_LIMITS[pollutant];
    const idx = bounds.findIndex((v) => Math.round(concentration) <= v);
    return idx < 0 ? 6 : idx + 1;
  }
  let value = concentration;
  if (standard === "us") {
    if (pollutant === "nitrogen_dioxide") value *= 24.45 / 46.0055;
    if (pollutant === "ozone") value *= 24.45 / 48;
    value =
      pollutant === "pm2_5"
        ? Math.floor((value + 1e-9) * 10) / 10
        : Math.floor(value + 1e-9);
  } else value = Math.round(value);
  const bands = standard === "us" ? US[pollutant] : INDIA[pollutant];
  // Above the supported 8h ozone range the 1h index is required.
  if (standard === "us" && pollutant === "ozone" && value > 200) return null;
  const band = bands.find((b) => value <= b[1]) ?? bands.at(-1)!;
  return Math.max(
    0,
    Math.min(
      500,
      Math.round(
        ((band[3] - band[2]) / (band[1] - band[0])) *
          (Math.max(band[0], value) - band[0]) +
          band[2],
      ),
    ),
  );
}
export function aqi(
  concentrations: Concentrations,
  standard: Standard,
  oneHourOzone?: number,
) {
  const indices = Object.entries(concentrations)
    .map(([p, value]) => ({
      pollutant: p as Pollutant,
      value: subIndex(p as Pollutant, value, standard),
    }))
    .filter((x) => x.value !== null);
  if (
    standard === "us" &&
    oneHourOzone !== undefined &&
    Number.isFinite(oneHourOzone)
  ) {
    const ppb = Math.floor((oneHourOzone * 24.45) / 48 + 1e-9);
    const oneHourBands: Band[] = [
      [125, 164, 101, 150],
      [165, 204, 151, 200],
      [205, 404, 201, 300],
      [405, 504, 301, 400],
      [505, 604, 401, 500],
    ];
    if (ppb >= 125) {
      const b = oneHourBands.find((b) => ppb <= b[1]) ?? oneHourBands.at(-1)!;
      indices.push({
        pollutant: "ozone",
        value: Math.min(
          500,
          Math.round(((b[3] - b[2]) / (b[1] - b[0])) * (ppb - b[0]) + b[2]),
        ),
      });
    }
  }
  if (!indices.length) return { value: null, dominant: null, indices };
  const max = indices.reduce((a, b) => (a.value! >= b.value! ? a : b));
  return { value: max.value, dominant: max.pollutant, indices };
}
export function averagedConcentrations(
  hourly: ModelData["hourly"],
  at: number,
  standard: Standard,
): Concentrations {
  const out: Concentrations = {};
  for (const p of ["pm2_5", "pm10", "nitrogen_dioxide", "ozone"] as const) {
    const hours =
      standard === "eu"
        ? 1
        : p === "ozone"
          ? 8
          : p === "nitrogen_dioxide" && standard === "us"
            ? 1
            : 24;
    const values = hourly
      .filter((h) => h.time <= at && h.time > at - hours * 3600)
      .map((h) => h.values[p])
      .filter((x): x is number => typeof x === "number" && Number.isFinite(x));
    if (values.length >= Math.ceil(hours * 0.75))
      out[p] = values.reduce((a, b) => a + b, 0) / values.length;
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
};
