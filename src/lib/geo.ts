import type { Point } from "./types";
const rad = (n: number) => (n * Math.PI) / 180;
export function distanceKm(a: Point, b: Point) {
  const dLat = rad(b.lat - a.lat),
    dLon = rad(b.lon - a.lon);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return (
    6371.0088 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(Math.max(0, 1 - h)))
  );
}
export function bearing(a: Point, b: Point) {
  const d = rad(b.lon - a.lon);
  return (
    ((Math.atan2(
      Math.sin(d) * Math.cos(rad(b.lat)),
      Math.cos(rad(a.lat)) * Math.sin(rad(b.lat)) -
        Math.sin(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.cos(d),
    ) *
      180) /
      Math.PI +
      360) %
    360
  );
}
export function validPoint(lat: number, lon: number) {
  return (
    Number.isFinite(lat) &&
    Number.isFinite(lon) &&
    Math.abs(lat) <= 85 &&
    Math.abs(lon) <= 180
  );
}
export function inBounds(p: Point, b: [number, number, number, number]) {
  return p.lon >= b[0] && p.lat >= b[1] && p.lon <= b[2] && p.lat <= b[3];
}
export function coordinates(p: Point) {
  return `${Math.abs(p.lat).toFixed(4)}° ${p.lat < 0 ? "S" : "N"}, ${Math.abs(p.lon).toFixed(4)}° ${p.lon < 0 ? "W" : "E"}`;
}
