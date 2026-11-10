export const POLLUTANTS = [
  "pm2_5",
  "pm10",
  "nitrogen_dioxide",
  "ozone",
  "sulphur_dioxide",
  "carbon_monoxide",
] as const;
export type Pollutant = (typeof POLLUTANTS)[number];
export type Concentrations = Partial<Record<Pollutant, number>>;
export type Point = {
  lat: number;
  lon: number;
  name?: string;
  country?: string;
  accuracyMeters?: number;
};
export type StationRecord = {
  id: string;
  name: string;
  source: "openaq" | "sensor-community" | "berlin-blume";
  lat: number;
  lon: number;
  pollutant: Pollutant;
  value_ugm3: number;
  ts: string;
  quality: "reference" | "citizen";
  averagingMinutes: number | null;
  humidity?: number;
  model_ugm3?: number;
  modelTs?: string;
  modelAveragingMinutes?: number;
  attribution?: string;
  coordinateQuality?: "official" | "declared-exact" | "approximate";
  siteType?: "roadside" | "urban background" | "suburban background";
};
export type SourceStatus = {
  source: string;
  status: "ok" | "unavailable" | "disabled";
  latencyMs: number;
  detail?: string;
};
export type ValidationMetric = {
  count: number;
  rmse: number;
  mae: number;
  bias: number;
  modelRmse: number;
  legacyRmse?: number;
  modelMae?: number;
  method?: string;
  referenceCount?: number;
  holdoutHours?: number;
};
export type EstimatorConfig = {
  lengthScaleKm: number;
  prior: number;
  gain: number;
  referenceOnly?: boolean;
  strategy?: "weighted";
};
export type Calibration = {
  algorithm: "robust-residual-v2";
  generatedAt: string;
  configs: Partial<Record<Pollutant, EstimatorConfig>>;
  validation: Partial<Record<Pollutant, ValidationMetric>>;
  method: string;
};
export type StationSnapshot = {
  version: 1;
  generatedAt: string;
  region: string;
  bounds: [number, number, number, number];
  observations: StationRecord[];
  validation: Partial<Record<Pollutant, ValidationMetric>>;
  statuses: SourceStatus[];
  history?: StationRecord[];
  calibration?: Calibration;
  streetObservations?: StationRecord[];
};
export type StationResponse = {
  observations: StationRecord[];
  tier: "snapshot" | "live" | "model";
  generatedAt: string | null;
  statuses: SourceStatus[];
  validation: StationSnapshot["validation"];
  history?: StationRecord[];
  calibration?: Calibration;
  streetObservations?: StationRecord[];
};
export type Weather = {
  temperature: number;
  humidity: number;
  pressure: number;
  windSpeed: number;
  windDirection: number;
  elevation: number | null;
};
export type ModelData = {
  time: number;
  timezone: string;
  current: Concentrations;
  aod: number | null;
  elevation: number | null;
  hourly: { time: number; values: Concentrations }[];
};
export type Standard = "us" | "india" | "eu";
export type EstimateResult = {
  concentrations: Concentrations;
  corrections: Concentrations;
  stations: (StationRecord & { distance: number; weight: number })[];
  support: "model" | "limited" | "local";
  parameters?: Partial<Record<Pollutant, EstimatorConfig>>;
};
