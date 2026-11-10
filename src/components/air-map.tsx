"use client";
import { useEffect, useMemo, useRef } from "react";
import {
  Circle,
  MapContainer,
  Marker,
  TileLayer,
  Tooltip,
  useMap,
  useMapEvents,
} from "react-leaflet";
import L from "leaflet";
import { POLLUTANT_LABEL } from "@/lib/aqi";
import type { Point, Standard, StationRecord } from "@/lib/types";

type Props = {
  point: Point;
  onPoint: (point: Point) => void;
  radius: number;
  stations: StationRecord[];
  standard: Standard;
  color: string;
  showStations: boolean;
  terrain: boolean;
  mapAction: { type: "in" | "out" | "center"; id: number } | null;
};
function Events({
  point,
  onPoint,
  mapAction,
}: Pick<Props, "point" | "onPoint" | "mapAction">) {
  const map = useMap();
  const last = useRef(point);
  useMapEvents({
    click(e) {
      onPoint({
        lat: Math.max(-85, Math.min(85, e.latlng.lat)),
        lon: ((((e.latlng.lng + 180) % 360) + 360) % 360) - 180,
      });
    },
  });
  useEffect(() => {
    if (last.current.lat !== point.lat || last.current.lon !== point.lon) {
      if (!map.getBounds().pad(-0.12).contains([point.lat, point.lon]))
        map.flyTo([point.lat, point.lon], Math.max(10, map.getZoom()), {
          duration: 1.1,
        });
      last.current = point;
    }
  }, [map, point]);
  useEffect(() => {
    if (mapAction?.type === "in") map.zoomIn();
    if (mapAction?.type === "out") map.zoomOut();
    if (mapAction?.type === "center")
      map.flyTo([point.lat, point.lon], 11, { duration: 0.8 });
    // Point changes are handled above; actions are unique user events.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapAction, map]);
  useEffect(() => {
    const observer = new ResizeObserver(() => map.invalidateSize());
    observer.observe(map.getContainer());
    return () => observer.disconnect();
  }, [map]);
  return null;
}
export default function AirMap(props: Props) {
  const {
    point,
    onPoint,
    radius,
    stations,
    standard,
    color,
    showStations,
    terrain,
    mapAction,
  } = props;
  const pin = useMemo(
    () =>
      L.divIcon({
        className: "selected-pin-wrapper",
        html: `<div class="pin-halo"></div><div class="selected-pin" style="background:${color}"><svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M20 10c0 6-8 11-8 11S4 16 4 10a8 8 0 1 1 16 0Z"/><circle cx="12" cy="10" r="2.5"/></svg></div><span class="pin-tip"></span>`,
        iconSize: [52, 62],
        iconAnchor: [26, 58],
      }),
    [color],
  );
  const markers = useMemo(
    () => [...new Map(stations.map((s) => [s.id, s])).values()],
    [stations],
  );
  return (
    <MapContainer
      center={[point.lat, point.lon]}
      zoom={11}
      minZoom={3}
      maxZoom={18}
      zoomControl={false}
      attributionControl
      className={`air-map ${terrain ? "map-detailed" : "map-muted"}`}
      worldCopyJump
    >
      <TileLayer
        url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
      />
      <Events point={point} onPoint={onPoint} mapAction={mapAction} />
      <Circle
        center={[point.lat, point.lon]}
        radius={radius * 1000}
        pathOptions={{
          color: "#749a7a",
          weight: 1,
          dashArray: "4 7",
          opacity: 0.55,
          fillColor: "#82a78b",
          fillOpacity: 0.035,
        }}
        interactive={false}
      />
      {showStations &&
        markers.map((s) => {
          // Markers indicate actual measured concentrations. A five-minute reading
          // must not be colored as though it were a regulatory daily AQI.
          const c = s.quality === "reference" ? "#547e68" : "#91a77c";
          const icon = L.divIcon({
            className: "station-marker-wrapper",
            html: `<div class="station-dot" style="--station-color:${c}"></div>`,
            iconSize: [20, 20],
            iconAnchor: [10, 10],
          });
          return (
            <Marker
              key={s.id}
              title={s.name}
              position={[s.lat, s.lon]}
              icon={icon}
            >
              <Tooltip direction="top">
                <strong>{s.name}</strong>
                <br />
                {POLLUTANT_LABEL[s.pollutant]} {s.value_ugm3.toFixed(1)} µg/m³
                <br />
                Measured ·{" "}
                {s.averagingMinutes
                  ? `${s.averagingMinutes} min average`
                  : "provider averaging period"}
              </Tooltip>
            </Marker>
          );
        })}
      <Marker
        title="Selected pin. Drag to move."
        position={[point.lat, point.lon]}
        icon={pin}
        draggable
        eventHandlers={{
          dragend(e) {
            const p = e.target.getLatLng();
            onPoint({
              lat: Math.max(-85, Math.min(85, p.lat)),
              lon: ((((p.lng + 180) % 360) + 360) % 360) - 180,
            });
          },
        }}
      />
    </MapContainer>
  );
}
