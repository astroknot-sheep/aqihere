"use client";
import dynamic from "next/dynamic";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  Activity,
  ArrowDown,
  ArrowDownToLine,
  ArrowRight,
  ArrowUpRight,
  Check,
  ChevronDown,
  ChevronRight,
  CircleHelp,
  Compass,
  Copy,
  Crosshair,
  Database,
  Droplets,
  Earth,
  ExternalLink,
  Eye,
  EyeOff,
  FlaskConical,
  Github,
  Info,
  Layers,
  Leaf,
  LoaderCircle,
  MapPin,
  Minus,
  Navigation,
  Plus,
  Radio,
  RefreshCw,
  Share2,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Waves,
  Wind,
  X,
} from "lucide-react";
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
  aqi,
  category,
  COLORS,
  POLLUTANT_LABEL,
  SCALE,
  subIndex,
} from "@/lib/aqi";
import { airDensity } from "@/lib/estimate";
import { coordinates, distanceKm, validPoint } from "@/lib/geo";
import { useAirQuality } from "@/hooks/use-air-quality";
import { POLLUTANTS, type Point, type Standard } from "@/lib/types";
import PlaceSearch from "./search";
import { Modal } from "./modal";

const AirMap = dynamic(() => import("./air-map"), {
  ssr: false,
  loading: () => (
    <div className="map-loading">
      <Earth size={32} />
      <span>Finding your place in the world…</span>
    </div>
  ),
});
const INITIAL: Point = {
  lat: 28.6139,
  lon: 77.209,
  name: "New Delhi",
  country: "India",
};
const DESCRIPTIONS = {
  pm2_5: "Fine particles",
  pm10: "Coarse particles",
  nitrogen_dioxide: "Nitrogen dioxide",
  ozone: "Ground-level ozone",
};
const REPO = "https://github.com/astroknot-sheep/aqihere";
const SOURCE_LINKS = [
  {
    title: "Open-Meteo & CAMS",
    detail: "Atmospheric model · CC BY 4.0",
    url: "https://open-meteo.com/en/docs/air-quality-api",
  },
  {
    title: "Sensor.Community",
    detail: "Community monitors · ODbL",
    url: "https://sensor.community/en/",
  },
  {
    title: "OpenAQ",
    detail: "Optional reference monitors · provider licenses",
    url: "https://openaq.org/",
  },
  {
    title: "OpenStreetMap",
    detail: "Map data and community-hosted tiles · ODbL",
    url: "https://www.openstreetmap.org/copyright",
  },
];
function IconLogo() {
  return (
    <span className="brand-icon">
      <MapPin size={23} strokeWidth={1.65} />
      <span />
    </span>
  );
}
function formatTime(time: number, zone?: string, compact = false) {
  return new Date(time * 1000).toLocaleTimeString("en", {
    hour: "numeric",
    ...(compact ? {} : { minute: "2-digit" }),
    hour12: true,
    timeZone: zone || "UTC",
  });
}

export default function Explorer() {
  const [point, setPoint] = useState<Point>(INITIAL);
  const [radius, setRadius] = useState(25);
  const [standard, setStandard] = useState<Standard>("us");
  const [revision, setRevision] = useState(0);
  const [tab, setTab] = useState<"overview" | "stations">("overview");
  const [modal, setModal] = useState<"method" | "sources" | "share" | null>(
    null,
  );
  const [showStations, setShowStations] = useState(true);
  const [terrain, setTerrain] = useState(false);
  const [settings, setSettings] = useState(false);
  const [mapAction, setMapAction] = useState<{
    type: "in" | "out" | "center";
    id: number;
  } | null>(null);
  const [locating, setLocating] = useState(false);
  const [toast, setToast] = useState("");
  const [copied, setCopied] = useState(false);
  const [shareUrl, setShareUrl] = useState("");
  const [isMobile, setIsMobile] = useState(false);
  const [mobileView, setMobileView] = useState<"map" | "details">("map");
  const settingsRef = useRef<HTMLDivElement>(null);
  const air = useAirQuality(point, radius, standard, revision);
  const status = category(air.index.value, standard);
  const stationCount = new Set(air.result.stations.map((s) => s.id)).size;
  const stations = useMemo(
    () =>
      [...new Map(air.observations.map((s) => [s.id, s])).values()].sort(
        (a, b) => distanceKm(point, a) - distanceKm(point, b),
      ),
    [air.observations, point],
  );
  const density = air.weather ? airDensity(air.weather) : null;
  const nearest = stations[0] ? distanceKm(point, stations[0]) : null;
  const zone = air.model?.timezone ?? "UTC";
  const avgNote =
    standard === "eu"
      ? "Hourly concentrations · EEA 2025 bands"
      : standard === "india"
        ? "24h PM & NO₂ · 8h O₃ · indicative"
        : "24h PM · 8h O₃ · 1h NO₂ · indicative";
  useEffect(() => {
    const query = window.matchMedia("(max-width: 760px)");
    const update = () => setIsMobile(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const lat = Number(params.get("lat")),
      lon = Number(params.get("lon"));
    if (params.has("lat") && params.has("lon") && validPoint(lat, lon))
      setPoint({ lat, lon, name: "Shared location" });
    const scale = params.get("scale");
    if (scale === "us" || scale === "india" || scale === "eu")
      setStandard(scale);
    const r = Number(params.get("radius"));
    if (r >= 5 && r <= 50) setRadius(r);
  }, []);
  useEffect(() => {
    const url = new URL(window.location.href);
    url.search = new URLSearchParams({
      lat: point.lat.toFixed(4),
      lon: point.lon.toFixed(4),
      scale: standard,
      radius: String(radius),
    }).toString();
    window.history.replaceState({}, "", url);
    setShareUrl(url.toString());
  }, [point, standard, radius]);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(""), 4500);
    return () => clearTimeout(timer);
  }, [toast]);
  useEffect(() => {
    const close = (e: MouseEvent) => {
      if (
        settingsRef.current &&
        !settingsRef.current.contains(e.target as Node)
      )
        setSettings(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);
  const select = (p: Point) => {
    setPoint(p);
    setRevision(0);
  };
  const geoLocate = () => {
    if (!navigator.geolocation) {
      setToast(
        "Your browser doesn’t support location. Search for a place instead.",
      );
      return;
    }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (p) => {
        select({
          lat: p.coords.latitude,
          lon: p.coords.longitude,
          name: "Your location",
        });
        setMapAction({ type: "center", id: Date.now() });
        setLocating(false);
      },
      () => {
        setLocating(false);
        setToast(
          "Location couldn’t be accessed. You can search for your city or drop a pin.",
        );
      },
      { timeout: 10000, maximumAge: 60000, enableHighAccuracy: false },
    );
  };
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      setToast("Select and copy the link from the share window.");
    }
  };
  const download = () => {
    if (!air.model) return;
    const rows = [
      [
        "latitude",
        "longitude",
        "model_time_utc",
        "standard",
        "indicative_index",
        "pollutant",
        "current_ugm3",
        "index_period_ugm3",
        "station_count",
        "tier",
      ],
      ...POLLUTANTS.map((p) => [
        point.lat,
        point.lon,
        new Date(air.modelTime * 1000).toISOString(),
        standard,
        air.index.value ?? "",
        p,
        air.result.concentrations[p] ?? "",
        air.average[p] ?? "",
        stationCount,
        air.stationData?.tier ?? "model",
      ]),
    ];
    const csv = rows
      .map((row) =>
        row.map((v) => `"${String(v).replaceAll('"', '""')}"`).join(","),
      )
      .join("\n");
    const url = URL.createObjectURL(
      new Blob([csv], { type: "text/csv;charset=utf-8" }),
    );
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `aqihere-${point.lat.toFixed(3)}-${point.lon.toFixed(3)}.csv`;
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    setToast("Your air-quality data was exported.");
  };
  const sourceSummary = stationCount
    ? `${stationCount} nearby ${stationCount === 1 ? "monitor" : "monitors"} informed this estimate.`
    : "CAMS atmospheric model. No usable nearby station correction.";
  return (
    <div className="app-shell">
      <header className="site-header">
        <a className="brand" href="/" aria-label="AQIHere home">
          <IconLogo />
          <span>
            aqihere<span className="brand-extension">.earth</span>
          </span>
        </a>
        <div className="header-tagline">
          <span className="tiny-line" /> The air around you, understood.
        </div>
        <nav aria-label="Main navigation">
          <button className="text-button" onClick={() => setModal("method")}>
            How it works <ArrowUpRight size={15} />
          </button>
          <a
            className="github-link"
            href={REPO}
            target="_blank"
            rel="noreferrer"
            aria-label="View open-source project on GitHub"
          >
            <Github size={19} />
          </a>
          <span className="header-separator" />
          <span className="free-badge">
            <span className="live-dot" /> Free & open
          </span>
        </nav>
      </header>
      <main className={`workspace mobile-${mobileView}`}>
        <aside
          className="sidebar"
          inert={isMobile && mobileView === "map"}
          aria-hidden={isMobile && mobileView === "map"}
          aria-label="Air quality at selected location"
        >
          <div className="sidebar-scroll">
            <div className="sidebar-eyebrow">
              <span className="eyebrow">
                <Compass size={13} /> AIR QUALITY EXPLORER
              </span>
              <button
                className="bare-button mobile-close"
                aria-label="Show map"
                onClick={() => setMobileView("map")}
              >
                <X size={19} />
              </button>
              <span className="desktop-only">01 / YOUR LOCATION</span>
            </div>
            <div className="location-heading">
              <h1>{point.name ?? "Dropped pin"}</h1>
              <p>
                <MapPin size={13} />
                {point.country ?? "Your selected spot on Earth"}
              </p>
            </div>
            <div className="coordinate-row">
              <span>{coordinates(point)}</span>
              <button
                className="bare-button"
                aria-label="Share this location"
                onClick={() => setModal("share")}
              >
                <Share2 size={15} />
              </button>
            </div>
            <div
              className="panel-tabs"
              role="tablist"
              aria-label="Air-quality details"
            >
              <button
                role="tab"
                aria-selected={tab === "overview"}
                aria-controls="overview-panel"
                id="overview-tab"
                className={tab === "overview" ? "active" : ""}
                onClick={() => setTab("overview")}
              >
                Overview
              </button>
              <button
                role="tab"
                aria-selected={tab === "stations"}
                aria-controls="stations-panel"
                id="stations-tab"
                className={tab === "stations" ? "active" : ""}
                onClick={() => setTab("stations")}
              >
                Nearby stations <span>{stations.length}</span>
              </button>
            </div>
            {air.errors.length > 0 && (
              <div
                className={`data-warning ${!air.model ? "data-error" : ""}`}
                role="status"
              >
                <Info size={15} />
                <span>{air.errors[0]}</span>
                <button
                  className="bare-button"
                  aria-label="Retry data sources"
                  onClick={() => setRevision((r) => r + 1)}
                >
                  <RefreshCw size={15} />
                </button>
              </div>
            )}
            {tab === "overview" ? (
              <div
                role="tabpanel"
                id="overview-panel"
                aria-labelledby="overview-tab"
              >
                <section
                  className={`aqi-card ${air.loading ? "is-loading" : ""}`}
                  style={{ "--aqi-color": status.color } as React.CSSProperties}
                  aria-busy={air.loading}
                  aria-live="polite"
                >
                  <div className="card-topline">
                    <span className="eyebrow">AIR QUALITY INDEX</span>
                    <label className="standard-select">
                      <span className="sr-only">AQI standard</span>
                      <select
                        value={standard}
                        onChange={(e) =>
                          setStandard(e.target.value as Standard)
                        }
                      >
                        <option value="us">US AQI</option>
                        <option value="india">India AQI</option>
                        <option value="eu">EU band</option>
                      </select>
                      <ChevronDown size={12} />
                    </label>
                  </div>
                  <div className="aqi-reading">
                    <div className="aqi-number">
                      {air.loading ? (
                        <span className="number-placeholder">···</span>
                      ) : (
                        (air.index.value ?? "—")
                      )}
                      {standard === "eu" && air.index.value !== null && (
                        <small>/6</small>
                      )}
                    </div>
                    <div className="aqi-word">
                      <span className="category-pill">
                        <span />
                        {air.loading ? "Checking the air" : status.label}
                      </span>
                      <span>
                        {air.loading
                          ? "A clearer picture is on its way"
                          : air.index.dominant
                            ? `${POLLUTANT_LABEL[air.index.dominant]} is the main contributor`
                            : "Try refreshing this location"}
                      </span>
                    </div>
                  </div>
                  <div className="aqi-spectrum">
                    <div>
                      {COLORS.map((c) => (
                        <span key={c} style={{ background: c }} />
                      ))}
                    </div>
                    <span
                      className="spectrum-pointer"
                      style={{
                        left: `${air.index.value === null ? 0 : Math.min(98, Math.max(2, ((status.index + 0.5) / 6) * 100))}%`,
                      }}
                    />
                  </div>
                  <div className="spectrum-labels">
                    <span>Good</span>
                    <span>
                      {standard === "india"
                        ? "Severe"
                        : standard === "eu"
                          ? "Extremely poor"
                          : "Hazardous"}
                    </span>
                  </div>
                  <div className="estimate-badge">
                    <Sparkles size={13} />
                    <span>
                      {air.loading
                        ? "Gathering open data"
                        : stationCount
                          ? "Station-informed estimate"
                          : "Model estimate"}
                    </span>
                    <button
                      className="bare-button"
                      aria-label="About this estimate"
                      onClick={() => setModal("method")}
                    >
                      <CircleHelp size={13} />
                    </button>
                  </div>
                </section>
                <p className="averaging-note">
                  {avgNote}
                  <br />
                  Four-pollutant estimate; not an official station AQI.
                </p>
                <section className="pollutants-section">
                  <div className="section-heading">
                    <h2>What’s in the air</h2>
                    <span>Current · µg/m³</span>
                  </div>
                  <div className="pollutant-list">
                    {POLLUTANTS.map((p, i) => {
                      const value = air.result.concentrations[p];
                      const color = category(
                        subIndex(p, value ?? NaN, standard),
                        standard,
                      ).color;
                      return (
                        <div key={p} className="pollutant-row">
                          <span className={`pollutant-symbol symbol-${i}`}>
                            {POLLUTANT_LABEL[p]}
                          </span>
                          <div className="pollutant-name">
                            <strong>{DESCRIPTIONS[p]}</strong>
                            <span>
                              {p === air.index.dominant
                                ? "Main contributor to index"
                                : "Current concentration"}
                            </span>
                          </div>
                          <strong className="pollutant-value">
                            {air.loading ? "—" : (value?.toFixed(1) ?? "—")}
                          </strong>
                          <span
                            className="pollutant-indicator"
                            style={{ background: color }}
                          />
                        </div>
                      );
                    })}
                  </div>
                </section>
                <section className="conditions-section">
                  <div className="section-heading">
                    <h2>The local atmosphere</h2>
                    <Wind size={15} />
                  </div>
                  <div className="condition-grid">
                    <div>
                      <Navigation
                        size={18}
                        style={{
                          transform: `rotate(${(air.weather?.windDirection ?? 0) + 180 - 45}deg)`,
                        }}
                      />
                      <strong>
                        {air.weather
                          ? (air.weather.windSpeed * 3.6).toFixed(1)
                          : "—"}
                        <small> km/h</small>
                      </strong>
                      <span>Wind speed</span>
                    </div>
                    <div>
                      <Droplets size={18} />
                      <strong>
                        {air.weather ? Math.round(air.weather.humidity) : "—"}
                        <small> %</small>
                      </strong>
                      <span>Humidity</span>
                    </div>
                    <div>
                      <Waves size={18} />
                      <strong>
                        {density?.toFixed(2) ?? "—"}
                        <small> kg/m³</small>
                      </strong>
                      <span>Air density</span>
                    </div>
                  </div>
                </section>
                <button
                  className="transparency-card"
                  onClick={() => setModal("sources")}
                >
                  <span className="transparency-icon">
                    <ShieldCheck size={21} strokeWidth={1.6} />
                  </span>
                  <span>
                    <strong>Open data. The full picture.</strong>
                    <small>
                      {air.loading
                        ? "Checking model and station coverage…"
                        : sourceSummary}
                    </small>
                    <em>
                      See the sources <ArrowUpRight size={12} />
                    </em>
                  </span>
                </button>
              </div>
            ) : (
              <section
                role="tabpanel"
                id="stations-panel"
                aria-labelledby="stations-tab"
                className="stations-panel"
              >
                <div className="section-heading">
                  <h2>Monitors around your pin</h2>
                  <Radio size={16} />
                </div>
                <p className="muted-copy">
                  Measurements belong to each monitor’s location. Your pin’s air
                  quality is still an estimate.
                </p>
                <div className="radius-setting">
                  <label htmlFor="station-radius">
                    Search radius <strong>{radius} km</strong>
                  </label>
                  <input
                    id="station-radius"
                    type="range"
                    min="5"
                    max="50"
                    step="5"
                    value={radius}
                    onChange={(e) => setRadius(Number(e.target.value))}
                  />
                  <div>
                    <span>5 km</span>
                    <span>50 km</span>
                  </div>
                </div>
                {air.loading || air.stationsLoading ? (
                  <div className="empty-stations">
                    <LoaderCircle size={28} className="spin" />
                    <h3>Looking for nearby monitors</h3>
                    <p>
                      Checking fresh station data and matching model values.
                    </p>
                  </div>
                ) : !stations.length ? (
                  <div className="empty-stations">
                    <span className="empty-icon">
                      <Radio size={30} strokeWidth={1.2} />
                    </span>
                    <h3>A little off the sensor grid.</h3>
                    <p>
                      No fresh monitors were found within {radius} km. CAMS
                      still gives you an atmospheric model estimate here.
                    </p>
                    <button
                      className="small-outline"
                      onClick={() =>
                        select({
                          lat: 52.52,
                          lon: 13.405,
                          name: "Berlin",
                          country: "Germany",
                        })
                      }
                    >
                      Explore Berlin <ArrowUpRight size={14} />
                    </button>
                  </div>
                ) : (
                  <div className="station-list">
                    {stations.map((s) => {
                      const used = air.result.stations.some(
                        (u) => u.id === s.id,
                      );
                      const age = Math.max(
                        0,
                        Math.round((Date.now() - Date.parse(s.ts)) / 60000),
                      );
                      const values = air.observations.filter(
                        (v) => v.id === s.id,
                      );
                      return (
                        <article className="station-card" key={s.id}>
                          <div>
                            <span
                              className={`station-source ${s.quality === "reference" ? "reference" : ""}`}
                            >
                              <Radio size={11} />
                              {s.quality === "reference"
                                ? "Reference"
                                : "Community"}
                            </span>
                            <span>
                              {distanceKm(point, s).toFixed(1)} km away
                            </span>
                          </div>
                          <h3>{s.name}</h3>
                          <div className="station-values">
                            {values.map((v) => (
                              <span key={v.pollutant}>
                                {POLLUTANT_LABEL[v.pollutant]}{" "}
                                <strong>{v.value_ugm3.toFixed(1)}</strong>
                              </span>
                            ))}
                            <small>µg/m³</small>
                          </div>
                          <p>
                            {s.averagingMinutes
                              ? `${s.averagingMinutes} min average`
                              : "Provider averaging period unspecified"}{" "}
                            · {age} min ago
                          </p>
                          <footer>
                            <span className={used ? "used" : ""}>
                              {used ? <Check size={12} /> : <Info size={12} />}
                              {used
                                ? "Used for residual correction"
                                : "Shown as context; baseline unavailable"}
                            </span>
                            <a
                              href={
                                s.source === "openaq"
                                  ? `https://explore.openaq.org/locations/${s.id.replace("oa-", "")}`
                                  : "https://maps.sensor.community/"
                              }
                              target="_blank"
                              rel="noreferrer"
                              aria-label={`View ${s.name} at source`}
                            >
                              <ExternalLink size={13} />
                            </a>
                          </footer>
                        </article>
                      );
                    })}
                  </div>
                )}
                <div className="station-explainer">
                  <Info size={15} />
                  <p>
                    Fresh means under 2 hours old. High-humidity and implausible
                    citizen-sensor readings are filtered where the required data
                    exist.
                  </p>
                </div>
              </section>
            )}
            <div className="sidebar-footer">
              <span className={`live-dot ${air.loading ? "pulsing" : ""}`} />
              <span>
                {air.loading
                  ? "Loading current conditions"
                  : air.model
                    ? `Model valid at ${formatTime(air.modelTime, zone)}`
                    : "Data unavailable"}
              </span>
              <button
                className="bare-button"
                aria-label="Refresh air quality"
                disabled={air.loading}
                onClick={() => setRevision((r) => r + 1)}
              >
                <RefreshCw size={13} className={air.loading ? "spin" : ""} />
              </button>
            </div>
          </div>
          <footer className="project-footer">
            <Leaf size={13} /> Made for a more breathable world.
            <button onClick={() => setModal("sources")}>
              Credits <ArrowUpRight size={10} />
            </button>
          </footer>
        </aside>
        <section
          className="map-section"
          inert={isMobile && mobileView === "details"}
          aria-hidden={isMobile && mobileView === "details"}
          aria-label="Interactive air-quality map"
        >
          <AirMap
            point={point}
            onPoint={select}
            radius={radius}
            stations={air.observations}
            standard={standard}
            color={status.color}
            showStations={showStations}
            terrain={terrain}
            mapAction={mapAction}
          />
          <div className="map-topbar">
            <PlaceSearch onSelect={select} />
            <div className="map-top-actions">
              <button
                className="location-button"
                onClick={geoLocate}
                disabled={locating}
                aria-label="Use my location"
              >
                {locating ? (
                  <LoaderCircle size={18} className="spin" />
                ) : (
                  <Crosshair size={19} />
                )}
                <span>Locate me</span>
              </button>
              <div ref={settingsRef} className="settings-wrapper">
                <button
                  className={`icon-button settings-trigger ${settings ? "active" : ""}`}
                  aria-label="Map settings"
                  aria-expanded={settings}
                  onClick={() => setSettings((s) => !s)}
                >
                  <SlidersHorizontal size={18} />
                </button>
                {settings && (
                  <div className="map-settings">
                    <div className="section-heading">
                      <h2>Make it your map</h2>
                      <button
                        className="bare-button"
                        aria-label="Close map settings"
                        onClick={() => setSettings(false)}
                      >
                        <X size={15} />
                      </button>
                    </div>
                    <label className="toggle-row">
                      <span>
                        <Radio size={16} />
                        Nearby monitors
                      </span>
                      <input
                        type="checkbox"
                        checked={showStations}
                        onChange={(e) => setShowStations(e.target.checked)}
                      />
                      <span className="toggle-visual" />
                    </label>
                    <label className="toggle-row">
                      <span>
                        <Layers size={16} />
                        Detailed street map
                      </span>
                      <input
                        type="checkbox"
                        checked={terrain}
                        onChange={(e) => setTerrain(e.target.checked)}
                      />
                      <span className="toggle-visual" />
                    </label>
                    <div className="radius-setting">
                      <label htmlFor="map-radius">
                        Station radius <strong>{radius} km</strong>
                      </label>
                      <input
                        id="map-radius"
                        type="range"
                        min="5"
                        max="50"
                        step="5"
                        value={radius}
                        onChange={(e) => setRadius(Number(e.target.value))}
                      />
                    </div>
                    <label className="settings-standard">
                      Index standard
                      <select
                        value={standard}
                        onChange={(e) =>
                          setStandard(e.target.value as Standard)
                        }
                      >
                        <option value="us">US AQI</option>
                        <option value="india">India AQI</option>
                        <option value="eu">European bands</option>
                      </select>
                    </label>
                  </div>
                )}
              </div>
            </div>
          </div>
          <div className="map-instruction">
            <span>
              <MapPin size={14} />
            </span>{" "}
            A world of air. <strong>Drop a pin to explore.</strong>
          </div>
          <div className="coverage-tag">
            <Earth size={13} />
            <span>GLOBAL COVERAGE</span>
          </div>
          <div className="map-zoom">
            <button
              aria-label="Zoom in"
              onClick={() => setMapAction({ type: "in", id: Date.now() })}
            >
              <Plus size={18} />
            </button>
            <button
              aria-label="Zoom out"
              onClick={() => setMapAction({ type: "out", id: Date.now() })}
            >
              <Minus size={18} />
            </button>
            <span />
            <button
              aria-label="Center map on selected pin"
              onClick={() => setMapAction({ type: "center", id: Date.now() })}
            >
              <Navigation size={17} />
            </button>
          </div>
          <div className="map-bottom">
            <div className="map-bottom-meta">
              <button
                className="basemap-button"
                onClick={() => setTerrain((t) => !t)}
              >
                <span
                  className={`basemap-thumbnail ${terrain ? "detailed" : ""}`}
                >
                  <Layers size={18} />
                </span>
                <span>
                  {terrain ? "Street map" : "Light map"}
                  <ChevronDown size={12} />
                </span>
              </button>
              <div className="map-legend">
                <span className="legend-title">{SCALE[standard].label}</span>
                <div>
                  {COLORS.map((c, i) => (
                    <span
                      key={c}
                      title={SCALE[standard].names[i]}
                      style={{ background: c }}
                    />
                  ))}
                </div>
                <span>
                  Good <ArrowRight size={10} />{" "}
                  {standard === "india"
                    ? "Severe"
                    : standard === "eu"
                      ? "Extremely poor"
                      : "Hazardous"}
                </span>
              </div>
              <span className="map-measurement-note">
                <span className="legend-station-dot" />
                Station dots show measured concentrations
              </span>
            </div>
            <section className="forecast-card">
              <div className="forecast-heading">
                <div>
                  <span className="eyebrow">A LOOK AHEAD</span>
                  <h2>
                    Your next 24 hours
                    <span> · {point.name ?? "This location"}</span>
                  </h2>
                </div>
                <div className="forecast-actions">
                  <span>
                    <span className="forecast-line" />
                    CAMS forecast
                  </span>
                  <button
                    className="icon-button"
                    onClick={download}
                    disabled={!air.model}
                    aria-label="Export current air-quality data as CSV"
                  >
                    <ArrowDownToLine size={17} />
                  </button>
                </div>
              </div>
              <div className="forecast-chart">
                {air.forecast.length ? (
                  <ResponsiveContainer
                    width="100%"
                    height="100%"
                    minHeight={92}
                  >
                    <AreaChart
                      data={air.forecast}
                      margin={{ top: 8, right: 12, left: -20, bottom: 0 }}
                    >
                      <defs>
                        <linearGradient
                          id="forecast-fill"
                          x1="0"
                          y1="0"
                          x2="0"
                          y2="1"
                        >
                          <stop
                            offset="0%"
                            stopColor="#628b6b"
                            stopOpacity={0.2}
                          />
                          <stop
                            offset="100%"
                            stopColor="#628b6b"
                            stopOpacity={0.015}
                          />
                        </linearGradient>
                      </defs>
                      <CartesianGrid
                        stroke="#e3e7de"
                        vertical={false}
                        strokeDasharray="2 4"
                      />
                      <XAxis
                        dataKey="time"
                        tickFormatter={(t) =>
                          formatTime(t, zone, true)
                            .replace(" ", "")
                            .toLowerCase()
                        }
                        ticks={air.forecast
                          .filter((_, i) => i % 6 === 0)
                          .map((h) => h.time)}
                        axisLine={false}
                        tickLine={false}
                        tick={{ fontSize: 10, fill: "#8b948b" }}
                        minTickGap={35}
                        dy={8}
                      />
                      <YAxis
                        domain={standard === "eu" ? [1, 6] : [0, "auto"]}
                        tickCount={3}
                        axisLine={false}
                        tickLine={false}
                        tick={{ fontSize: 10, fill: "#8b948b" }}
                        allowDecimals={false}
                      />
                      <Tooltip
                        content={({ active, payload }) =>
                          active && payload?.length ? (
                            <div className="chart-tooltip">
                              <span>
                                {formatTime(payload[0].payload.time, zone)}
                              </span>
                              <strong>
                                {payload[0].value} {SCALE[standard].label}
                              </strong>
                              <small>Model forecast</small>
                            </div>
                          ) : null
                        }
                      />
                      <Area
                        type="monotone"
                        dataKey="value"
                        stroke="#628b6b"
                        strokeWidth={2}
                        fill="url(#forecast-fill)"
                        isAnimationActive={false}
                        connectNulls={false}
                      />
                    </AreaChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="chart-empty">
                    {air.loading ? (
                      <>
                        <LoaderCircle size={17} className="spin" />
                        Preparing your forecast…
                      </>
                    ) : (
                      "Forecast unavailable for this location."
                    )}
                  </div>
                )}
              </div>
              <div className="forecast-caption">
                <span>
                  <Info size={11} />
                  Model forecast · local time ({zone.replaceAll("_", " ")})
                </span>
                <span>Open data. Clearer decisions.</span>
              </div>
            </section>
          </div>
          <button
            className="mobile-summary"
            onClick={() => setMobileView("details")}
          >
            <span className="mobile-aqi" style={{ color: status.color }}>
              {air.loading ? "···" : (air.index.value ?? "—")}
            </span>
            <span>
              <strong>{point.name ?? "Dropped pin"}</strong>
              <small>
                {air.loading
                  ? "Checking the air…"
                  : `${status.label} · ${SCALE[standard].label}`}
              </small>
            </span>
            <span className="mobile-details-label">
              Details <ChevronRight size={17} />
            </span>
          </button>
        </section>
      </main>
      {toast && (
        <div className="toast" role="status">
          <Info size={16} />
          {toast}
          <button
            aria-label="Dismiss notification"
            className="bare-button"
            onClick={() => setToast("")}
          >
            <X size={15} />
          </button>
        </div>
      )}
      <Modal
        open={modal === "method"}
        onOpenChange={(o) => !o && setModal(null)}
        title="A clearer picture of the air."
        description="Open data, a transparent method, and room for uncertainty."
      >
        <div className="method-steps">
          <article>
            <span>01</span>
            <div>
              <h3>Start with the atmosphere.</h3>
              <p>
                CAMS, delivered by Open-Meteo, provides a model at every pin.
                Its grid is about 11 km in Europe and 45 km globally. A pin is
                precise; the underlying model is regional.
              </p>
            </div>
          </article>
          <article>
            <span>02</span>
            <div>
              <h3>Let nearby monitors add context.</h3>
              <p>
                Fresh readings are compared with the model at each station’s
                observation hour. Distance, freshness, source quality and a
                modest wind factor determine how much their residuals adjust
                current concentrations. Without matched readings, the model
                stays unchanged.
              </p>
            </div>
          </article>
          <article>
            <span>03</span>
            <div>
              <h3>Calculate the index last.</h3>
              <p>
                US and Indian particulate indices use rolling 24-hour model
                concentrations, with 8-hour ozone. Only the current hour can
                receive a fresh station correction. US NO₂ uses 1 hour; India
                uses 24. EU bands use hourly concentrations and the EEA’s 2025
                revision.
              </p>
            </div>
          </article>
        </div>
        <div className="method-callout">
          <FlaskConical size={22} />
          <div>
            <strong>Honest about what we know.</strong>
            <p>
              This is an indicative index for four pollutants, not an official
              AQI or a measurement at your pin. SO₂ and CO are not included. US
              ozone includes the 1-hour sub-index when its concentration reaches
              the applicable range. Density and AOD are diagnostics. No accuracy
              improvement or calibrated uncertainty is claimed without
              validation.
            </p>
          </div>
        </div>
        <div className="method-links">
          <a
            href="https://aqs.epa.gov/aqsweb/documents/codetables/aqi_breakpoints.html"
            target="_blank"
            rel="noreferrer"
          >
            EPA breakpoints <ArrowUpRight size={12} />
          </a>
          <a
            href="https://airindex.eea.europa.eu/AQI/"
            target="_blank"
            rel="noreferrer"
          >
            EEA methodology <ArrowUpRight size={12} />
          </a>
          <a
            href="https://www.airquality.cpcb.gov.in/ccr_docs/About_AQI.pdf"
            target="_blank"
            rel="noreferrer"
          >
            CPCB methodology <ArrowUpRight size={12} />
          </a>
          <a href={REPO} target="_blank" rel="noreferrer">
            Explore the code <ArrowUpRight size={12} />
          </a>
        </div>
      </Modal>
      <Modal
        open={modal === "sources"}
        onOpenChange={(o) => !o && setModal(null)}
        title="Every estimate has a story."
        description="Here is the data behind your selected location."
      >
        <div className="source-current">
          <div>
            <Database size={18} />
            <strong>
              {stationCount
                ? "Station-informed estimate"
                : "CAMS model estimate"}
            </strong>
          </div>
          <p>{sourceSummary}</p>
          <span>
            {stationCount} contributing monitors
            {nearest !== null
              ? ` · nearest measurement ${nearest.toFixed(1)} km away`
              : ""}{" "}
            ·{" "}
            {air.stationData?.tier === "snapshot"
              ? "Scheduled snapshot"
              : air.stationData?.tier === "live"
                ? "Live fallback"
                : "Model fallback"}
          </span>
        </div>
        <div className="source-status-list">
          <div>
            <span>
              <span className={`live-dot ${!air.model ? "inactive" : ""}`} />
              Air-quality model
            </span>
            <strong>{air.model ? "Available" : "Unavailable"}</strong>
          </div>
          <div>
            <span>
              <span className={`live-dot ${!air.weather ? "inactive" : ""}`} />
              Weather model
            </span>
            <strong>{air.weather ? "Available" : "Unavailable"}</strong>
          </div>
          {air.stationData?.statuses.map((s, i) => (
            <div key={`${s.source}:${i}`}>
              <span>
                <span
                  className={`live-dot ${s.status !== "ok" ? "inactive" : ""}`}
                />
                {s.source}
              </span>
              <strong title={s.detail}>
                {s.status === "ok" ? `${s.latencyMs} ms` : s.status}
              </strong>
            </div>
          ))}
        </div>
        <div className="diagnostics">
          <span>
            Aerosol optical depth{" "}
            <strong>{air.model?.aod?.toFixed(2) ?? "—"}</strong>
          </span>
          <span>
            Model elevation{" "}
            <strong>
              {air.model?.elevation ?? air.weather?.elevation ?? "—"} m
            </strong>
          </span>
        </div>
        <div className="validation-note">
          <Activity size={17} />
          <div>
            <strong>Uncertainty is not yet calibrated here.</strong>
            <p>
              {air.stationData?.validation.pm2_5
                ? `Snapshot PM₂.₅ spatial holdout: RMSE ${air.stationData.validation.pm2_5.rmse.toFixed(1)} µg/m³, ${air.stationData.validation.pm2_5.count} monitors; model-only RMSE ${air.stationData.validation.pm2_5.modelRmse.toFixed(1)} µg/m³. This is a diagnostic, not a prediction interval.`
                : "No regional validation result is available for this pin. A station count is coverage information, not an accuracy percentage."}
            </p>
          </div>
        </div>
        <h3 className="sources-credit-heading">Standing on open data</h3>
        <div className="source-links">
          {SOURCE_LINKS.map((s) => (
            <a key={s.title} href={s.url} target="_blank" rel="noreferrer">
              <span>
                <strong>{s.title}</strong>
                <small>{s.detail}</small>
              </span>
              <ArrowUpRight size={17} />
            </a>
          ))}
        </div>
        <p className="license-note">
          CAMS data © European Union, via Copernicus Atmosphere Monitoring
          Service and Open-Meteo, CC BY 4.0. Open-Meteo’s free API is for
          non-commercial use. Sensor.Community data are ODbL. Station-specific
          OpenAQ provider credits are preserved in the snapshot.
        </p>
      </Modal>
      <Modal
        open={modal === "share"}
        onOpenChange={(o) => !o && setModal(null)}
        title="Share a little clarity."
        description="Send this pin, index standard and search radius to someone."
      >
        <div className="share-preview">
          <MapPin size={23} />
          <div>
            <strong>{point.name ?? "Your selected location"}</strong>
            <span>{coordinates(point)}</span>
          </div>
          <span className="share-index" style={{ color: status.color }}>
            {air.index.value ?? "—"}
          </span>
        </div>
        <label className="share-label" htmlFor="share-link">
          Link to this location
        </label>
        <div className="share-input">
          <input
            id="share-link"
            readOnly
            value={shareUrl}
            onFocus={(e) => e.target.select()}
          />
          <button className="primary-button" onClick={copy}>
            {copied ? <Check size={16} /> : <Copy size={16} />}{" "}
            {copied ? "Copied" : "Copy"}
          </button>
        </div>
        <p className="share-note">
          The link loads fresh data when opened. It doesn’t preserve the current
          readings.
        </p>
        <button
          className="export-button"
          onClick={download}
          disabled={!air.model}
        >
          <ArrowDownToLine size={17} />
          <span>Export current readings as CSV</span>
          <ArrowUpRight size={16} />
        </button>
      </Modal>
    </div>
  );
}
