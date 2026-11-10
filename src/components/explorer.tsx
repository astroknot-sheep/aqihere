"use client";

import dynamic from "next/dynamic";
import { useEffect, useState, type KeyboardEvent } from "react";
import {
  ArrowDownToLine,
  ArrowUpRight,
  ChevronRight,
  Copy,
  Crosshair,
  Github,
  Info,
  Layers,
  LoaderCircle,
  MapPin,
  Minus,
  Navigation,
  Plus,
  RefreshCw,
  Share2,
  X,
} from "lucide-react";
import { category, POLLUTANT_LABEL, SCALE } from "@/lib/aqi";
import { coordinates, validPoint } from "@/lib/geo";
import { useAirQuality } from "@/hooks/use-air-quality";
import {
  POLLUTANTS,
  type Point,
  type Pollutant,
  type Standard,
  type StationRecord,
} from "@/lib/types";
import {
  CurrentPanel,
  ForecastPanel,
  ScaleLegend,
  StationShape,
  StationsPanel,
  StreetPanel,
  type StreetRadius,
} from "./air-inspector";
import PlaceSearch, { PLACES } from "./search";
import { Modal } from "./modal";

const AirMap = dynamic(() => import("./air-map"), {
  ssr: false,
  loading: () => (
    <div className="map-loading" role="status">
      Loading map…
    </div>
  ),
});
const REPO = "https://github.com/astroknot-sheep/aqihere";
const TABS = [
  { id: "current", label: "Current" },
  { id: "stations", label: "Stations" },
  { id: "street", label: "Street" },
  { id: "forecast", label: "Forecast" },
] as const;
type Panel = (typeof TABS)[number]["id"];
const SOURCES = [
  {
    label: "CAMS via Open-Meteo",
    detail: "Regional atmospheric model · CC BY 4.0",
    url: "https://open-meteo.com/en/docs/air-quality-api",
  },
  {
    label: "Land Berlin · BLUME",
    detail: "Hourly reference measurements · dl-de-by-2.0",
    url: "https://daten.berlin.de/datensaetze/luftdaten-berlin",
  },
  {
    label: "Sensor.Community",
    detail: "Outdoor community sensors · ODbL",
    url: "https://sensor.community/en/",
  },
  {
    label: "OpenAQ",
    detail: "Optional monitoring feed · provider licences",
    url: "https://openaq.org/",
  },
  {
    label: "OpenStreetMap",
    detail: "Map tiles and geographic data",
    url: "https://www.openstreetmap.org/copyright",
  },
];

export default function Explorer() {
  const [point, setPoint] = useState<Point>(PLACES[0]);
  const [standard, setStandard] = useState<Standard>("us");
  const [radius, setRadius] = useState(25);
  const [streetRadius, setStreetRadius] = useState<StreetRadius>(100);
  const [panel, setPanel] = useState<Panel>("current");
  const [mobileDetails, setMobileDetails] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const [showStations, setShowStations] = useState(true);
  const [terrain, setTerrain] = useState(false);
  const [revision, setRevision] = useState(0);
  const [locating, setLocating] = useState(false);
  const [dialog, setDialog] = useState<"methods" | "sources" | "share" | null>(
    null,
  );
  const [toast, setToast] = useState("");
  const [shareUrl, setShareUrl] = useState("");
  const [urlLoaded, setUrlLoaded] = useState(false);
  const [mapAction, setMapAction] = useState<{
    type: "in" | "out" | "center";
    id: number;
  } | null>(null);
  const air = useAirQuality(point, radius, standard, revision);
  const stationCount = new Set(air.observations.map((s) => s.id)).size;
  const state = category(air.index.value, standard);
  const index = air.index.aboveRange ? "400+" : (air.index.value ?? "—");

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
    if (params.has("lat") && params.has("lon") && validPoint(lat, lon)) {
      setPoint(
        PLACES.find((p) => p.lat === lat && p.lon === lon) ?? {
          lat,
          lon,
          name: "Selected location",
        },
      );
    }
    const scale = params.get("scale");
    if (scale === "us" || scale === "india" || scale === "eu")
      setStandard(scale);
    const distance = Number(params.get("radius"));
    if (distance >= 5 && distance <= 50) setRadius(distance);
    const street = Number(params.get("street"));
    if (street === 10 || street === 25 || street === 50 || street === 100) {
      setStreetRadius(street);
      setPanel("street");
    }
    setUrlLoaded(true);
  }, []);
  useEffect(() => {
    if (!urlLoaded) return;
    const url = new URL(window.location.href);
    const params = new URLSearchParams({
      lat: point.lat.toFixed(6),
      lon: point.lon.toFixed(6),
      scale: standard,
      radius: String(radius),
    });
    if (panel === "street") params.set("street", String(streetRadius));
    url.search = params.toString();
    window.history.replaceState({}, "", url);
    setShareUrl(url.toString());
  }, [point, standard, radius, panel, streetRadius, urlLoaded]);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(""), 5000);
    return () => clearTimeout(timer);
  }, [toast]);
  function select(point: Point) {
    setPoint(point);
    setRevision(0);
  }
  function inspectStation(station: StationRecord) {
    select({ lat: station.lat, lon: station.lon, name: station.name });
    setStreetRadius(100);
    setPanel("street");
    setMobileDetails(true);
  }
  function moveMap(type: "in" | "out" | "center") {
    setMapAction({ type, id: Date.now() });
  }
  function locate() {
    if (!navigator.geolocation) {
      setToast(
        "Location services are unavailable. Enter coordinates or choose a map point.",
      );
      return;
    }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => {
        select({
          lat: coords.latitude,
          lon: coords.longitude,
          name: "Your location",
          accuracyMeters: coords.accuracy,
        });
        moveMap("center");
        setLocating(false);
      },
      () => {
        setLocating(false);
        setToast(
          "Location was unavailable. Choose a map point or search for an address.",
        );
      },
      { timeout: 10000, maximumAge: 30000, enableHighAccuracy: true },
    );
  }
  function tabKey(event: KeyboardEvent<HTMLButtonElement>, i: number) {
    const next =
      event.key === "Home"
        ? 0
        : event.key === "End"
          ? TABS.length - 1
          : event.key === "ArrowRight"
            ? (i + 1) % TABS.length
            : event.key === "ArrowLeft"
              ? (i + TABS.length - 1) % TABS.length
              : null;
    if (next === null) return;
    event.preventDefault();
    setPanel(TABS[next].id);
    document.getElementById(`tab-${TABS[next].id}`)?.focus();
  }
  function download() {
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
        air.index.value === null ? "" : index,
        p,
        air.result.concentrations[p] ?? "",
        air.average[p] ?? "",
        new Set(air.result.stations.map((s) => s.id)).size,
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
    const link = document.createElement("a");
    link.href = url;
    link.download = "aqihere.csv";
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    setToast("CSV exported.");
  }

  return (
    <div className="app-shell">
      <header className="site-header">
        <a className="brand" href="/" aria-label="AQIHere home">
          <MapPin size={23} />
          <strong>AQIHere</strong>
          <span className="brand-context">Air quality map</span>
        </a>
        <nav aria-label="Map and data controls">
          <label className="standard-select">
            <span className="sr-only">AQI standard</span>
            <select
              value={standard}
              onChange={(e) => setStandard(e.target.value as Standard)}
            >
              <option value="us">US AQI</option>
              <option value="india">India AQI</option>
              <option value="eu">EU bands</option>
            </select>
          </label>
          <button
            className="header-button"
            onClick={() => setDialog("methods")}
          >
            <Info size={17} />
            <span>Methods</span>
          </button>
          <a
            className="icon-button github-link"
            href={REPO}
            target="_blank"
            rel="noreferrer"
            aria-label="Source code on GitHub"
          >
            <Github size={19} />
          </a>
        </nav>
      </header>
      <main
        className={`workspace ${mobileDetails ? "mobile-details" : "mobile-map"}`}
      >
        <aside
          className="inspector"
          aria-label="Selected location data"
          inert={isMobile && !mobileDetails}
        >
          <div className="inspector-heading">
            <div className="section-heading">
              <span className="eyebrow">Selected location</span>
              <button
                className="outline-button mobile-back"
                onClick={() => setMobileDetails(false)}
              >
                Map
                <ChevronRight size={16} />
              </button>
            </div>
            <h1>{point.name ?? "Dropped pin"}</h1>
            {point.country && <p className="muted">{point.country}</p>}
            <div className="location-meta">
              <span>{coordinates(point, panel === "street" ? 6 : 4)}</span>
              <div>
                <button
                  className="icon-button"
                  aria-label="Share selected point"
                  onClick={() => setDialog("share")}
                >
                  <Share2 size={16} />
                </button>
                <button
                  className="icon-button"
                  aria-label="Refresh readings"
                  disabled={air.loading}
                  onClick={() => setRevision((n) => n + 1)}
                >
                  <RefreshCw size={16} />
                </button>
              </div>
            </div>
            {point.accuracyMeters !== undefined && (
              <p className="small-copy">
                Device position accuracy ±{Math.round(point.accuracyMeters)} m
              </p>
            )}
          </div>
          <div className="panel-tabs" role="tablist" aria-label="Location data">
            {TABS.map((tab, i) => (
              <button
                key={tab.id}
                id={`tab-${tab.id}`}
                role="tab"
                type="button"
                aria-controls={`panel-${tab.id}`}
                aria-selected={panel === tab.id}
                tabIndex={panel === tab.id ? 0 : -1}
                onKeyDown={(e) => tabKey(e, i)}
                onClick={() => setPanel(tab.id)}
              >
                {tab.label}
                {tab.id === "stations" && stationCount > 0 && (
                  <small>{stationCount}</small>
                )}
              </button>
            ))}
          </div>
          <div
            className="inspector-scroll"
            role="tabpanel"
            id={`panel-${panel}`}
            aria-labelledby={`tab-${panel}`}
            tabIndex={0}
          >
            {air.errors.length > 0 && (
              <p className="data-warning" role="status">
                <Info size={16} />
                {air.errors[0]}
              </p>
            )}
            {panel === "current" && (
              <CurrentPanel
                air={air}
                standard={standard}
                onSources={() => setDialog("sources")}
              />
            )}
            {panel === "stations" && (
              <StationsPanel
                air={air}
                point={point}
                radius={radius}
                onRadius={setRadius}
                onInspect={inspectStation}
              />
            )}
            {panel === "street" && (
              <StreetPanel
                air={air}
                point={point}
                radius={streetRadius}
                standard={standard}
                onRadius={setStreetRadius}
                onInspect={inspectStation}
              />
            )}
            {panel === "forecast" && (
              <ForecastPanel air={air} standard={standard} />
            )}
          </div>
          <footer className="inspector-footer">
            <button className="text-link" onClick={() => setDialog("sources")}>
              Data sources
            </button>
            <button
              className="text-link"
              onClick={download}
              disabled={!air.model}
            >
              <ArrowDownToLine size={15} />
              CSV
            </button>
          </footer>
        </aside>
        <section
          className="map-section"
          aria-label="Air quality map"
          inert={isMobile && mobileDetails}
        >
          <AirMap
            point={point}
            onPoint={select}
            onInspect={inspectStation}
            radius={radius}
            stations={air.observations}
            streetRadius={panel === "street" ? streetRadius : null}
            showStations={showStations}
            terrain={terrain}
            mapAction={mapAction}
            zone={air.model?.timezone ?? "UTC"}
          />
          <div className="map-toolbar">
            <PlaceSearch onSelect={select} />
            <div className="map-actions">
              <button
                className="icon-button"
                aria-label="Use my location"
                title="Use my location"
                disabled={locating}
                onClick={locate}
              >
                {locating ? (
                  <LoaderCircle size={19} className="spin" />
                ) : (
                  <Crosshair size={19} />
                )}
              </button>
              <details className="layers-menu">
                <summary
                  className="icon-button"
                  aria-label="Map layers"
                  title="Map layers"
                >
                  <Layers size={19} />
                </summary>
                <div className="layers-panel">
                  <strong>Map layers</strong>
                  <label>
                    <input
                      type="checkbox"
                      checked={showStations}
                      onChange={(e) => setShowStations(e.target.checked)}
                    />{" "}
                    Monitoring stations
                  </label>
                  <label>
                    <input
                      type="checkbox"
                      checked={terrain}
                      onChange={(e) => setTerrain(e.target.checked)}
                    />{" "}
                    Detailed streets
                  </label>
                </div>
              </details>
            </div>
          </div>
          <div className="map-scale-note">
            {panel === "street"
              ? `${streetRadius} m inspection radius`
              : `${radius} km monitor search`}
            <span> · Click the map to move the pin</span>
          </div>
          <div className="map-zoom" aria-label="Map navigation">
            <button
              className="icon-button"
              aria-label="Zoom in"
              onClick={() => moveMap("in")}
            >
              <Plus size={20} />
            </button>
            <button
              className="icon-button"
              aria-label="Zoom out"
              onClick={() => moveMap("out")}
            >
              <Minus size={20} />
            </button>
            <button
              className="icon-button"
              aria-label="Center selected point"
              onClick={() => moveMap("center")}
            >
              <Navigation size={18} />
            </button>
          </div>
          <details className="map-legend">
            <summary>Map legend</summary>
            <div className="legend-body">
              <ul className="marker-legend">
                <li>
                  <StationShape kind="point" />
                  Selected point
                </li>
                <li>
                  <StationShape kind="reference" />
                  Reference monitor
                </li>
                <li>
                  <StationShape kind="community" />
                  Community sensor
                </li>
              </ul>
              <h2>{SCALE[standard].label} categories</h2>
              <ScaleLegend standard={standard} />
            </div>
          </details>
          <div className="mobile-summary">
            <button
              className="mobile-current"
              onClick={() => {
                setPanel("current");
                setMobileDetails(true);
              }}
            >
              <strong style={{ borderLeftColor: state.color }}>
                {air.loading ? "—" : index}
              </strong>
              <span>
                <b>{point.name ?? "Dropped pin"}</b>
                <small>
                  {air.loading
                    ? "Loading"
                    : `${state.label} · ${SCALE[standard].label}`}
                </small>
              </span>
              <ChevronRight size={18} />
            </button>
            <button
              className="mobile-street"
              onClick={() => {
                setPanel("street");
                setMobileDetails(true);
              }}
            >
              <MapPin size={17} />
              Street
            </button>
          </div>
        </section>
      </main>
      {toast && (
        <div className="toast" role="status">
          {toast}
          <button
            className="icon-button"
            aria-label="Dismiss message"
            onClick={() => setToast("")}
          >
            <X size={16} />
          </button>
        </div>
      )}
      <Modal
        open={dialog === "methods"}
        onOpenChange={(open) => !open && setDialog(null)}
        title="Methods"
        description="How readings and estimates are calculated."
      >
        <div className="method-content">
          <h3>Regional estimate</h3>
          <p>
            CAMS supplies the background field. Available grid spacing is about
            11 km in Europe and 45 km globally. Monitor readings are matched to
            the same averaging window. The selected correction uses distance and
            freshness. Where the reference record is long enough, it is tested
            on later hours at withheld monitors.
          </p>
          <h3>Street measurements</h3>
          <p>
            The Street tab searches 10–100 m around the pin. It uses published
            positions, reports distance and sampling time, and derives a station
            index from that station’s completed hourly history. Reliable
            estimates between monitors require a validated dispersion model with
            local emissions, wind and building geometry.
          </p>
          <h3>Index periods</h3>
          <p>
            US particulate estimates use EPA PM NowCast. Ozone and CO use 8-hour
            windows, and NO₂ and SO₂ use hourly inputs with the EPA
            high-concentration rules. India uses rolling 24-hour particles, NO₂
            and SO₂, plus 8-hour ozone and CO. EU bands use hourly
            concentrations.
          </p>
          <div className="method-links">
            <a
              className="text-link"
              href="https://document.airnow.gov/technical-assistance-document-for-the-reporting-of-daily-air-quailty.pdf"
              target="_blank"
              rel="noreferrer"
            >
              EPA AQI methods
              <ArrowUpRight size={13} />
            </a>
            <a
              className="text-link"
              href="https://airindex.eea.europa.eu/AQI/"
              target="_blank"
              rel="noreferrer"
            >
              EEA index
              <ArrowUpRight size={13} />
            </a>
            <a
              className="text-link"
              href="https://acp.copernicus.org/articles/24/807/2024/"
              target="_blank"
              rel="noreferrer"
            >
              Street dispersion research
              <ArrowUpRight size={13} />
            </a>
          </div>
        </div>
      </Modal>
      <Modal
        open={dialog === "sources"}
        onOpenChange={(open) => !open && setDialog(null)}
        title="Data sources and validation"
        description="Coverage and recent validation for the selected location."
      >
        <div className="method-content">
          <h3>Regional data</h3>
          <p>
            {air.stationData?.tier === "snapshot"
              ? "Scheduled station snapshot"
              : air.stationData?.tier === "live"
                ? "Live community station lookup"
                : "CAMS model"}
            . {air.correctedHistoryHours} of the prior 24 hours have usable
            station support.
          </p>
          {air.stationData?.statuses.length ? (
            <ul className="source-status">
              {air.stationData.statuses.map((s, i) => (
                <li key={`${s.source}-${i}`}>
                  <strong>{s.source}</strong>
                  <span>{s.status === "ok" ? "Available" : s.status}</span>
                </li>
              ))}
            </ul>
          ) : null}
          <h3>Spatial validation</h3>
          <p>
            {air.stationData?.calibration?.method ??
              "Regional validation is unavailable for this point."}
          </p>
          {Object.entries(air.stationData?.validation ?? {}).length > 0 && (
            <table className="data-table">
              <caption className="sr-only">
                Spatial holdout errors in micrograms per cubic metre
              </caption>
              <thead>
                <tr>
                  <th scope="col">Pollutant</th>
                  <th scope="col">Holdout RMSE</th>
                  <th scope="col">CAMS RMSE</th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(air.stationData?.validation ?? {}).map(
                  ([p, m]) => (
                    <tr key={p}>
                      <th scope="row">
                        {POLLUTANT_LABEL[p as Pollutant]}
                        <small>
                          {m.count} targets
                          {m.referenceCount
                            ? ` · ${m.referenceCount} reference`
                            : ""}
                          {m.holdoutHours ? ` · ${m.holdoutHours} hours` : ""}
                        </small>
                      </th>
                      <td>{m.rmse.toFixed(1)}</td>
                      <td>{m.modelRmse.toFixed(1)}</td>
                    </tr>
                  ),
                )}
              </tbody>
            </table>
          )}
          <h3>Providers</h3>
          <ul className="source-links">
            {SOURCES.map((s) => (
              <li key={s.label}>
                <a
                  className="text-link"
                  href={s.url}
                  target="_blank"
                  rel="noreferrer"
                >
                  {s.label}
                  <ArrowUpRight size={13} />
                </a>
                <span>{s.detail}</span>
              </li>
            ))}
          </ul>
        </div>
      </Modal>
      <Modal
        open={dialog === "share"}
        onOpenChange={(open) => !open && setDialog(null)}
        title="Share location"
        description="The link preserves the coordinates and selected index standard."
      >
        <div className="share-input">
          <input
            aria-label="Location link"
            readOnly
            value={shareUrl}
            onFocus={(e) => e.target.select()}
          />
          <button
            className="outline-button"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(shareUrl);
                setToast("Link copied.");
              } catch {
                setToast("Select the link and copy it.");
              }
            }}
          >
            <Copy size={16} />
            Copy
          </button>
        </div>
        <button className="text-link" onClick={download} disabled={!air.model}>
          <ArrowDownToLine size={16} />
          Export current readings
        </button>
      </Modal>
    </div>
  );
}
