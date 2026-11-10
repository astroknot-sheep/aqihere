"use client";
import { useEffect, useRef, useState } from "react";
import { ArrowUpRight, LoaderCircle, MapPin, Search, X } from "lucide-react";
import { fetchJSON } from "@/lib/fetch";
import { validPoint } from "@/lib/geo";
import type { Point } from "@/lib/types";
export const PLACES: Point[] = [
  { lat: 28.6139, lon: 77.209, name: "New Delhi", country: "India" },
  { lat: 52.52, lon: 13.405, name: "Berlin", country: "Germany" },
  { lat: 51.5074, lon: -0.1278, name: "London", country: "United Kingdom" },
  { lat: 40.7128, lon: -74.006, name: "New York", country: "United States" },
];
type Result = {
  id: number;
  latitude: number;
  longitude: number;
  name: string;
  country?: string;
  admin1?: string;
};
export default function PlaceSearch({
  onSelect,
}: {
  onSelect: (point: Point) => void;
}) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [results, setResults] = useState<Point[]>(PLACES);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [active, setActive] = useState(-1);
  const ref = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const shortcut = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        input.current?.focus();
      }
    };
    document.addEventListener("mousedown", handler);
    document.addEventListener("keydown", shortcut);
    return () => {
      document.removeEventListener("mousedown", handler);
      document.removeEventListener("keydown", shortcut);
    };
  }, []);
  useEffect(() => {
    setActive(-1);
    setError("");
    if (!query.trim()) {
      setResults(PLACES);
      setLoading(false);
      return;
    }
    const coords = query.split(",").map(Number);
    if (coords.length === 2 && validPoint(coords[0], coords[1])) {
      setResults([
        { lat: coords[0], lon: coords[1], name: "Custom coordinates" },
      ]);
      setLoading(false);
      return;
    }
    if (query.trim().length < 2) {
      setResults([]);
      setLoading(false);
      return;
    }
    const controller = new AbortController();
    setLoading(true);
    setResults([]);
    const timer = setTimeout(async () => {
      try {
        const data = await fetchJSON<{ results?: Result[] }>(
          `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(query.trim())}&count=6&language=en&format=json`,
          { signal: controller.signal },
        );
        if (!controller.signal.aborted)
          setResults(
            (data.results ?? []).map((r) => ({
              lat: r.latitude,
              lon: r.longitude,
              name: r.name,
              country: [r.admin1, r.country].filter(Boolean).join(", "),
            })),
          );
      } catch {
        if (!controller.signal.aborted) {
          setResults([]);
          setError(
            "Search is unavailable. Enter latitude, longitude or select a point on the map.",
          );
        }
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }, 350);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query]);
  const select = (p: Point) => {
    onSelect(p);
    setQuery("");
    setOpen(false);
    input.current?.blur();
  };
  return (
    <div className="place-search" ref={ref}>
      <div className={`search-input ${open ? "is-open" : ""}`}>
        <Search size={19} strokeWidth={1.7} />
        <input
          ref={input}
          aria-label="Search a city or coordinates"
          placeholder="Search a city or coordinates"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          role="combobox"
          aria-expanded={open}
          aria-controls="search-results"
          aria-autocomplete="list"
          aria-activedescendant={
            active >= 0 ? `search-result-${active}` : undefined
          }
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              setOpen(false);
              input.current?.blur();
            }
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setActive((i) => Math.min(i + 1, results.length - 1));
            }
            if (e.key === "ArrowUp") {
              e.preventDefault();
              setActive((i) => Math.max(0, i - 1));
            }
            if (e.key === "Enter" && results.length) {
              e.preventDefault();
              select(results[Math.max(0, active)]);
            }
          }}
        />
        {loading ? (
          <LoaderCircle size={16} className="spin" />
        ) : query ? (
          <button
            className="bare-button"
            aria-label="Clear search"
            onClick={() => {
              setQuery("");
              input.current?.focus();
            }}
          >
            <X size={16} />
          </button>
        ) : (
          <kbd>⌘ K</kbd>
        )}
      </div>
      {open && (
        <div
          className="search-results"
          id="search-results"
          role="listbox"
          aria-label="Places"
        >
          <span className="eyebrow">
            {query ? "SEARCH RESULTS" : "SUGGESTED LOCATIONS"}
          </span>
          {results.map((r, i) => (
            <button
              key={`${r.lat}:${r.lon}`}
              id={`search-result-${i}`}
              role="option"
              aria-selected={active === i}
              className={active === i ? "active" : ""}
              onClick={() => select(r)}
            >
              <MapPin size={17} />
              <span>
                <strong>{r.name}</strong>
                <small>
                  {r.country ?? `${r.lat.toFixed(4)}, ${r.lon.toFixed(4)}`}
                </small>
              </span>
              <ArrowUpRight size={16} />
            </button>
          ))}
          {!results.length && !loading && (
            <p>
              {error || "No places found. Try another name or coordinates."}
            </p>
          )}
          {loading && !results.length && <p>Searching…</p>}
        </div>
      )}
    </div>
  );
}
