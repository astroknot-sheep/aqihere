"use client";

import { useMemo, type CSSProperties } from "react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  ArrowUpRight,
  Clock3,
  Info,
  LoaderCircle,
  MapPin,
  Radio,
} from "lucide-react";
import { category, COLORS, POLLUTANT_LABEL, SCALE } from "@/lib/aqi";
import { airDensity } from "@/lib/estimate";
import { distanceKm } from "@/lib/geo";
import { measuredStationIndex, streetEvidence } from "@/lib/street";
import {
  POLLUTANTS,
  type Point,
  type Pollutant,
  type Standard,
  type StationRecord,
} from "@/lib/types";
import type { useAirQuality } from "@/hooks/use-air-quality";

type Air = ReturnType<typeof useAirQuality>;
export const STREET_RADII = [10, 25, 50, 100] as const;
export type StreetRadius = (typeof STREET_RADII)[number];
export const SOURCE_URL = {
  "berlin-blume": "https://luftdaten.berlin.de/",
  "sensor-community": "https://maps.sensor.community/",
  openaq: "https://explore.openaq.org/",
};
export function localTime(seconds: number, zone: string, day = false) {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: zone,
    ...(day ? { day: "numeric", month: "short" } : {}),
    hour: "2-digit",
    minute: "2-digit",
    timeZoneName: "short",
  }).format(seconds * 1000);
}
const NAMES: Record<Pollutant, string> = {
  pm2_5: "Fine particles",
  pm10: "Coarse particles",
  nitrogen_dioxide: "Nitrogen dioxide",
  ozone: "Ozone",
  sulphur_dioxide: "Sulphur dioxide",
  carbon_monoxide: "Carbon monoxide",
};
function number(value: number | undefined) {
  return value === undefined
    ? "—"
    : value.toLocaleString("en", { maximumFractionDigits: 1 });
}
export function StationShape({
  kind,
}: {
  kind: "point" | "reference" | "community";
}) {
  return <span className={`marker-shape marker-${kind}`} aria-hidden="true" />;
}
export function ScaleLegend({ standard }: { standard: Standard }) {
  const scale = SCALE[standard];
  return (
    <ol className="scale-legend" aria-label={`${scale.label} categories`}>
      {scale.names.map((name, i) => {
        const upper = scale.boundaries[i];
        const lower = i ? scale.boundaries[i - 1] + 1 : 0;
        const range =
          standard === "eu"
            ? String(upper)
            : i === 5
              ? `${lower}+`
              : `${lower}–${upper}`;
        return (
          <li key={name}>
            <span className="scale-color" style={{ background: COLORS[i] }} />
            <span>{name}</span>
            <strong>{range}</strong>
          </li>
        );
      })}
    </ol>
  );
}
export function CurrentPanel({
  air,
  standard,
  onSources,
}: {
  air: Air;
  standard: Standard;
  onSources: () => void;
}) {
  const state = category(air.index.value, standard);
  const contributors = new Set(air.result.stations.map((s) => s.id)).size;
  const zone = air.model?.timezone ?? "UTC";
  const wind = air.weather;
  const modelDescription = contributors
    ? `Estimate · ${contributors} contributing monitors`
    : "Estimate · CAMS model";
  const aggregation =
    standard === "us"
      ? "PM NowCast · rolling gas windows"
      : standard === "india"
        ? "24 h particles and gases · 8 h ozone and CO"
        : "Hourly concentrations · EEA bands";
  const scale = SCALE[standard];
  const position = ((state.index + 0.5) / scale.names.length) * 100;
  return (
    <>
      <section
        className="index-panel"
        aria-busy={air.loading}
        aria-live="polite"
        style={{ "--reading-color": state.color } as CSSProperties}
      >
        <span className="eyebrow">{scale.label} · Current</span>
        <div className="index-line">
          <strong className="index-number">
            {air.loading
              ? "—"
              : air.index.aboveRange
                ? "400+"
                : (air.index.value ?? "—")}
          </strong>
          <div>
            <strong>{air.loading ? "Loading" : state.label}</strong>
            {air.index.dominant && (
              <span>
                {POLLUTANT_LABEL[air.index.dominant]} drives the index
              </span>
            )}
          </div>
        </div>
        <div className="index-spectrum" aria-hidden="true">
          {COLORS.map((color) => (
            <span key={color} style={{ background: color }} />
          ))}
          {air.index.value !== null && <i style={{ left: `${position}%` }} />}
        </div>
        <div className="spectrum-endpoints" aria-hidden="true">
          <span>{scale.names[0]}</span>
          <span>{scale.names[scale.names.length - 1]}</span>
        </div>
        <div className="index-meta">
          <Clock3 size={14} />
          <span>
            {air.model
              ? localTime(air.indexTime, zone, true)
              : "Awaiting model data"}
          </span>
        </div>
        <button className="text-link source-button" onClick={onSources}>
          <Info size={15} />
          {modelDescription}
          <ArrowUpRight size={13} />
        </button>
        <p className="small-copy">{aggregation}</p>
      </section>
      <section className="inspector-section">
        <h2>Pollutants</h2>
        <table className="data-table">
          <caption className="sr-only">
            Estimated concentrations in micrograms per cubic metre
          </caption>
          <thead>
            <tr>
              <th scope="col">Pollutant</th>
              <th scope="col">
                Current
                <br />
                <small>µg/m³</small>
              </th>
              <th scope="col">
                Index input
                <br />
                <small>µg/m³</small>
              </th>
            </tr>
          </thead>
          <tbody>
            {POLLUTANTS.map((p) => (
              <tr
                key={p}
                className={p === air.index.dominant ? "dominant-row" : ""}
              >
                <th scope="row">
                  {POLLUTANT_LABEL[p]}
                  <small>{NAMES[p]}</small>
                </th>
                <td>{number(air.result.concentrations[p])}</td>
                <td>{number(air.average[p])}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="small-copy">
          {air.model && air.indexTime !== air.modelTime && (
            <>Current concentrations at {localTime(air.modelTime, zone)}. </>
          )}
          Index inputs use the averaging period for the selected standard.
        </p>
      </section>
      <section className="inspector-section">
        <h2>Weather</h2>
        <dl className="weather-grid">
          <div>
            <dt>Wind</dt>
            <dd>{wind ? `${(wind.windSpeed * 3.6).toFixed(1)} km/h` : "—"}</dd>
          </div>
          <div>
            <dt>Humidity</dt>
            <dd>{wind ? `${Math.round(wind.humidity)}%` : "—"}</dd>
          </div>
          <div>
            <dt>Air density</dt>
            <dd>{wind ? `${airDensity(wind).toFixed(2)} kg/m³` : "—"}</dd>
          </div>
        </dl>
      </section>
    </>
  );
}
export function StationReadings({
  readings,
  zone,
}: {
  readings: StationRecord[];
  zone: string;
}) {
  return (
    <table className="data-table station-table">
      <caption className="sr-only">Measured station concentrations</caption>
      <thead>
        <tr>
          <th scope="col">Pollutant</th>
          <th scope="col">µg/m³</th>
          <th scope="col">Period ending</th>
        </tr>
      </thead>
      <tbody>
        {readings.map((r) => (
          <tr key={r.pollutant}>
            <th scope="row">{POLLUTANT_LABEL[r.pollutant]}</th>
            <td>{number(r.value_ugm3)}</td>
            <td>
              {localTime(Date.parse(r.ts) / 1000, zone)}
              <small>
                {r.averagingMinutes
                  ? `${r.averagingMinutes} min mean`
                  : "Period unspecified"}
              </small>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
function StationLink({ station }: { station: StationRecord }) {
  return (
    <a
      className="text-link"
      href={SOURCE_URL[station.source]}
      target="_blank"
      rel="noreferrer"
    >
      {station.source === "berlin-blume"
        ? "Berlin BLUME"
        : station.source === "openaq"
          ? "OpenAQ"
          : "Sensor.Community"}
      <ArrowUpRight size={13} />
    </a>
  );
}
export function StationsPanel({
  air,
  point,
  radius,
  onRadius,
  onInspect,
}: {
  air: Air;
  point: Point;
  radius: number;
  onRadius: (n: number) => void;
  onInspect: (s: StationRecord) => void;
}) {
  const groups = useMemo(() => {
    const byId = new Map<string, StationRecord[]>();
    for (const r of air.observations)
      byId.set(r.id, [...(byId.get(r.id) ?? []), r]);
    return [...byId.values()].sort(
      (a, b) => distanceKm(point, a[0]) - distanceKm(point, b[0]),
    );
  }, [air.observations, point]);
  const zone = air.model?.timezone ?? "UTC";
  const used = new Set(air.result.stations.map((s) => s.id));
  return (
    <section className="inspector-section">
      <div className="section-heading">
        <h2>Nearby measurements</h2>
        <Radio size={17} />
      </div>
      <label className="range-label" htmlFor="station-radius">
        <span>Search radius</span>
        <strong>{radius} km</strong>
      </label>
      <input
        id="station-radius"
        className="radius-input"
        type="range"
        min={5}
        max={50}
        step={5}
        value={radius}
        onChange={(e) => onRadius(Number(e.target.value))}
      />
      <p className="small-copy">
        Open a monitor to see its readings and sampling periods.
      </p>
      {air.loading || air.stationsLoading ? (
        <p className="empty-state">
          <LoaderCircle className="spin" size={16} /> Checking monitors…
        </p>
      ) : groups.length === 0 ? (
        <p className="empty-state">No fresh measurements within {radius} km.</p>
      ) : (
        <div className="station-list">
          {groups.map((records) => {
            const station = records[0];
            return (
              <details className="station-entry" key={station.id}>
                <summary>
                  <StationShape
                    kind={
                      station.quality === "reference"
                        ? "reference"
                        : "community"
                    }
                  />
                  <span>
                    <strong>{station.name}</strong>
                    <small>
                      {station.siteType ??
                        (station.quality === "reference"
                          ? "Reference monitor"
                          : "Community sensor")}
                      {used.has(station.id) ? " · used in estimate" : ""}
                    </small>
                  </span>
                  <span>{distanceKm(point, station).toFixed(1)} km</span>
                </summary>
                <StationReadings readings={records} zone={zone} />
                <div className="station-actions">
                  <StationLink station={station} />
                  {station.coordinateQuality === "official" && (
                    <button
                      className="text-link"
                      onClick={() => onInspect(station)}
                    >
                      Inspect 100 m
                    </button>
                  )}
                </div>
              </details>
            );
          })}
        </div>
      )}
    </section>
  );
}
export function StreetPanel({
  air,
  point,
  radius,
  standard,
  onRadius,
  onInspect,
}: {
  air: Air;
  point: Point;
  radius: StreetRadius;
  standard: Standard;
  onRadius: (r: StreetRadius) => void;
  onInspect: (s: StationRecord) => void;
}) {
  const records = air.stationData?.streetObservations ?? [];
  const now = Date.now(),
    zone = air.model?.timezone ?? "UTC";
  const nearby = streetEvidence(point, radius, records, now);
  const closestReference = [...records]
    .filter(
      (s) =>
        s.coordinateQuality === "official" &&
        now - Date.parse(s.ts) >= 0 &&
        now - Date.parse(s.ts) <= 7200000,
    )
    .sort((a, b) => distanceKm(point, a) - distanceKm(point, b))[0];
  return (
    <section className="inspector-section street-panel">
      <div className="section-heading">
        <h2>Street measurements</h2>
        <MapPin size={17} />
      </div>
      <p className="small-copy">
        Find fresh outdoor readings at published monitor positions within the
        selected radius.
      </p>
      <div className="radius-options" role="group" aria-label="Street radius">
        {STREET_RADII.map((r) => (
          <button
            key={r}
            type="button"
            aria-pressed={radius === r}
            onClick={() => onRadius(r)}
          >
            {r} m
          </button>
        ))}
      </div>
      {air.loading ? (
        <p className="empty-state">Checking street coverage…</p>
      ) : nearby.length === 0 ? (
        <div className="empty-state street-empty">
          <strong>No eligible readings within {radius} m</strong>
          <p>
            The Current tab shows the regional estimate. A street estimate needs
            local measurements or a validated dispersion model.
          </p>
          {closestReference && (
            <button
              className="outline-button"
              onClick={() => onInspect(closestReference)}
            >
              Inspect {closestReference.name}
              <ArrowUpRight size={14} />
            </button>
          )}
        </div>
      ) : (
        nearby.map(({ station, distanceMeters, readings }) => {
          const index = measuredStationIndex(
            station.id,
            [...(air.stationData?.history ?? []), ...readings],
            standard,
            now,
          );
          const state = category(index?.value ?? null, standard);
          return (
            <article className="street-monitor" key={station.id}>
              <div className="section-heading">
                <h3>{station.name}</h3>
                <strong>
                  {distanceMeters < 1
                    ? "At the pin"
                    : `${Math.round(distanceMeters)} m away`}
                </strong>
              </div>
              <p className="small-copy">
                {station.coordinateQuality === "official"
                  ? "Official station position"
                  : "Operator-published position"}
                {station.siteType ? ` · ${station.siteType}` : ""}
              </p>
              {index && (
                <div
                  className="measured-index"
                  style={{ borderLeftColor: state.color }}
                >
                  <strong>
                    {index.aboveRange ? "400+" : index.value}{" "}
                    {SCALE[standard].label}
                  </strong>
                  <span>
                    {state.label} · {index.pollutantCount} measured{" "}
                    {index.pollutantCount === 1 ? "pollutant" : "pollutants"}
                  </span>
                  <span>
                    {localTime(index.time, zone, true)} at this monitor
                  </span>
                </div>
              )}
              <StationReadings readings={readings} zone={zone} />
              <StationLink station={station} />
            </article>
          );
        })
      )}
    </section>
  );
}
export function ForecastPanel({
  air,
  standard,
  compact = false,
}: {
  air: Air;
  standard: Standard;
  compact?: boolean;
}) {
  const zone = air.model?.timezone ?? "UTC";
  const available = air.forecast.filter((h) => h.value !== null);
  const high = available.reduce<(typeof available)[number] | undefined>(
    (best, h) => (!best || h.value! > best.value! ? h : best),
    undefined,
  );
  return (
    <section className={compact ? "forecast-dock" : "inspector-section"}>
      <div className="forecast-heading">
        <h2>Next 24 hours</h2>
        <p className="small-copy">CAMS forecast · {SCALE[standard].label}</p>
      </div>
      {available.length ? (
        <>
          <div className="forecast-chart">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart
                data={air.forecast}
                margin={{ top: 10, right: 10, left: -22, bottom: 0 }}
              >
                <CartesianGrid
                  vertical={false}
                  stroke="#dce2d7"
                  strokeDasharray="3 4"
                />
                <XAxis
                  dataKey="time"
                  tickFormatter={(t) =>
                    new Intl.DateTimeFormat("en-GB", {
                      hour: "2-digit",
                      minute: "2-digit",
                      timeZone: zone,
                    }).format(t * 1000)
                  }
                  ticks={air.forecast
                    .filter((_, i) => i % 6 === 0)
                    .map((h) => h.time)}
                  tick={{ fontSize: 11, fill: "#536354" }}
                  axisLine={false}
                  tickLine={false}
                />
                <YAxis
                  domain={standard === "eu" ? [1, 6] : [0, "auto"]}
                  tickCount={4}
                  tick={{ fontSize: 11, fill: "#536354" }}
                  axisLine={false}
                  tickLine={false}
                />
                <Tooltip
                  labelFormatter={(t) => localTime(Number(t), zone, true)}
                  formatter={(value) => [
                    standard === "india" && value === 401 ? "400+" : value,
                    SCALE[standard].label,
                  ]}
                />
                <Area
                  dataKey="value"
                  type="linear"
                  stroke="#49684e"
                  fill="#e4eddf"
                  strokeWidth={2}
                  isAnimationActive={false}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
          {!compact && high && (
            <p className="forecast-peak">
              Peak{" "}
              {standard === "india" && high.value === 401 ? "400+" : high.value}{" "}
              · {category(high.value, standard).label} ·{" "}
              {localTime(high.time, zone, true)}
            </p>
          )}
          {!compact && (
            <table className="data-table">
              <caption className="sr-only">
                Forecast at six-hour intervals
              </caption>
              <thead>
                <tr>
                  <th scope="col">Local time</th>
                  <th scope="col">{SCALE[standard].label}</th>
                  <th scope="col">Category</th>
                </tr>
              </thead>
              <tbody>
                {air.forecast
                  .filter((_, i) => i % 6 === 0)
                  .map((h) => (
                    <tr key={h.time}>
                      <th scope="row">{localTime(h.time, zone)}</th>
                      <td>{h.aboveRange ? "400+" : (h.value ?? "—")}</td>
                      <td>{category(h.value, standard).label}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          )}
        </>
      ) : (
        <p className="empty-state">
          {air.loading ? "Loading forecast…" : "Forecast unavailable."}
        </p>
      )}
    </section>
  );
}
