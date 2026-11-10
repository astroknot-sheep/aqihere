"use client";

import { useEffect, useMemo, useRef } from "react";
import {
  Circle,
  MapContainer,
  Marker,
  Popup,
  ScaleControl,
  TileLayer,
  useMap,
  useMapEvents,
} from "react-leaflet";
import L from "leaflet";
import type { Point, StationRecord } from "@/lib/types";
import { StationReadings } from "./air-inspector";

type Props = {
  point: Point;
  onPoint: (point: Point) => void;
  onInspect: (station: StationRecord) => void;
  radius: number;
  streetRadius: number | null;
  stations: StationRecord[];
  zone: string;
  showStations: boolean;
  terrain: boolean;
  mapAction: { type: "in" | "out" | "center"; id: number } | null;
};
function mapPoint(latlng: L.LatLng): Point {
  return {
    lat: Math.max(-85, Math.min(85, latlng.lat)),
    lon: ((((latlng.lng + 180) % 360) + 360) % 360) - 180,
  };
}
const MAX_MAP_ZOOM = 19;

function fitStreet(map: L.Map, point: Point, radius: number) {
  map.fitBounds(L.latLng(point.lat, point.lon).toBounds(radius * 2), {
    padding: [48, 48],
    maxZoom: MAX_MAP_ZOOM,
    animate: false,
  });
}
function Controls({
  point,
  onPoint,
  mapAction,
  streetRadius,
}: Pick<Props, "point" | "onPoint" | "mapAction" | "streetRadius">) {
  const map = useMap();
  const last = useRef(point);
  const savedZoom = useRef<number | null>(null);
  useMapEvents({
    click(e) {
      onPoint(mapPoint(e.latlng));
    },
  });
  useEffect(() => {
    if (streetRadius !== null) {
      savedZoom.current ??= map.getZoom();
      fitStreet(map, point, streetRadius);
    } else if (savedZoom.current !== null) {
      map.setView([point.lat, point.lon], savedZoom.current, {
        animate: false,
      });
      savedZoom.current = null;
    } else if (
      (last.current.lat !== point.lat || last.current.lon !== point.lon) &&
      !map.getBounds().pad(-0.12).contains([point.lat, point.lon])
    ) {
      map.setView([point.lat, point.lon], Math.max(10, map.getZoom()));
    }
    last.current = point;
  }, [map, point, streetRadius]);
  const actionRef = useRef<number | null>(null);
  useEffect(() => {
    if (!mapAction || actionRef.current === mapAction.id) return;
    actionRef.current = mapAction.id;
    if (mapAction.type === "in") map.zoomIn();
    else if (mapAction.type === "out") map.zoomOut();
    else if (streetRadius !== null) fitStreet(map, point, streetRadius);
    else map.setView([point.lat, point.lon], 11);
  }, [map, mapAction, point, streetRadius]);
  useEffect(() => {
    const observer = new ResizeObserver(() => map.invalidateSize());
    observer.observe(map.getContainer());
    return () => observer.disconnect();
  }, [map]);
  return null;
}
const selectedIcon = L.divIcon({
  className: "point-marker",
  html: '<span class="marker-shape marker-point"></span>',
  iconSize: [32, 32],
  iconAnchor: [16, 16],
  popupAnchor: [0, -16],
});
const referenceIcon = L.divIcon({
  className: "station-marker",
  html: '<span class="marker-shape marker-reference"></span>',
  iconSize: [24, 24],
  iconAnchor: [12, 12],
  popupAnchor: [0, -12],
});
const communityIcon = L.divIcon({
  className: "station-marker",
  html: '<span class="marker-shape marker-community"></span>',
  iconSize: [24, 24],
  iconAnchor: [12, 12],
  popupAnchor: [0, -12],
});
export default function AirMap({
  point,
  onPoint,
  onInspect,
  radius,
  streetRadius,
  stations,
  zone,
  showStations,
  terrain,
  mapAction,
}: Props) {
  const groups = useMemo(() => {
    const byId = new Map<string, StationRecord[]>();
    for (const s of stations) byId.set(s.id, [...(byId.get(s.id) ?? []), s]);
    return [...byId.values()];
  }, [stations]);
  return (
    <MapContainer
      center={[point.lat, point.lon]}
      zoom={11}
      minZoom={3}
      maxZoom={MAX_MAP_ZOOM}
      zoomControl={false}
      className={`air-map ${terrain ? "map-detailed" : "map-muted"}`}
      worldCopyJump
    >
      <TileLayer
        maxZoom={MAX_MAP_ZOOM}
        url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
      />
      <ScaleControl imperial={false} position="bottomleft" />
      <Controls
        point={point}
        onPoint={onPoint}
        mapAction={mapAction}
        streetRadius={streetRadius}
      />
      <Circle
        center={[point.lat, point.lon]}
        radius={streetRadius ?? radius * 1000}
        interactive={false}
        pathOptions={{
          color: "#1d4ed8",
          weight: streetRadius ? 2 : 1,
          dashArray: streetRadius ? undefined : "5 5",
          fillOpacity: streetRadius ? 0.08 : 0.025,
          opacity: 0.75,
        }}
      />
      {showStations &&
        groups.map((readings) => {
          const station = readings[0];
          const qualified =
            station.coordinateQuality === "official" ||
            station.coordinateQuality === "declared-exact";
          return (
            <Marker
              key={station.id}
              position={[station.lat, station.lon]}
              title={station.name}
              icon={
                station.quality === "reference" ? referenceIcon : communityIcon
              }
            >
              <Popup minWidth={240} maxWidth={320}>
                <div className="station-popup">
                  <strong>{station.name}</strong>
                  <p>
                    {station.siteType ??
                      (station.quality === "reference"
                        ? "Reference monitor"
                        : "Community sensor")}
                  </p>
                  {station.coordinateQuality === "approximate" && (
                    <p>Approximate public position</p>
                  )}
                  <StationReadings readings={readings} zone={zone} />
                  {qualified && (
                    <button
                      className="text-link"
                      onClick={() => onInspect(station)}
                    >
                      Inspect this station within 100 m
                    </button>
                  )}
                </div>
              </Popup>
            </Marker>
          );
        })}
      <Marker
        position={[point.lat, point.lon]}
        title="Selected point. Drag to move."
        icon={selectedIcon}
        zIndexOffset={1000}
        draggable
        eventHandlers={{
          dragend(e) {
            onPoint(mapPoint(e.target.getLatLng()));
          },
        }}
      />
    </MapContainer>
  );
}
