"use client";
import { useEffect, useMemo, useState } from "react";
import { averagedConcentrations, aqi } from "@/lib/aqi";
import { clusterCitizens, estimate, qualityControl } from "@/lib/estimate";
import { fetchJSON } from "@/lib/fetch";
import { distanceKm } from "@/lib/geo";
import { attachModelBaselines, fetchAir, fetchWeather } from "@/lib/model";
import type {
  ModelData,
  Point,
  Standard,
  StationResponse,
  Weather,
} from "@/lib/types";

type Data = {
  model: ModelData | null;
  weather: Weather | null;
  stationData: StationResponse | null;
  errors: string[];
};
const EMPTY: Data = {
  model: null,
  weather: null,
  stationData: null,
  errors: [],
};
const cache = new Map<string, { at: number; data: Data }>();
export function useAirQuality(
  point: Point,
  radius: number,
  standard: Standard,
  revision: number,
) {
  const [data, setData] = useState<Data>(EMPTY);
  const [loading, setLoading] = useState(true);
  const [stationsLoading, setStationsLoading] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    const key = `${point.lat.toFixed(2)},${point.lon.toFixed(2)}`;
    const cached = cache.get(key);
    setData(EMPTY);
    setLoading(true);
    setStationsLoading(false);
    const timer = setTimeout(async () => {
      if (cached && Date.now() - cached.at < 300000 && !revision) {
        setData(cached.data);
        setLoading(false);
        return;
      }
      const results = await Promise.allSettled([
        fetchAir(point, controller.signal),
        fetchWeather(point, controller.signal),
        fetchJSON<StationResponse>(
          `/api/stations?lat=${(Math.round(point.lat * 10) / 10).toFixed(1)}&lon=${(Math.round(point.lon * 10) / 10).toFixed(1)}`,
          { signal: controller.signal, timeoutMs: 6000 },
        ),
      ]);
      if (controller.signal.aborted) return;
      const [air, weather, stations] = results;
      const next: Data = {
        model: air.status === "fulfilled" ? air.value : null,
        weather: weather.status === "fulfilled" ? weather.value : null,
        stationData: stations.status === "fulfilled" ? stations.value : null,
        errors: [
          air.status === "rejected"
            ? "Air-quality data could not be loaded. Please try again."
            : "",
          weather.status === "rejected"
            ? "Weather is temporarily unavailable."
            : "",
          stations.status === "rejected"
            ? "Station lookup is temporarily unavailable. Showing the model."
            : "",
        ].filter(Boolean),
      };
      setData(next);
      setLoading(false);
      if (next.stationData?.observations.length) {
        const nearby = next.stationData.observations
          .filter((s) => distanceKm(point, s) <= 50)
          .sort(
            (a, b) =>
              (a.quality === "reference" ? -1 : 1) -
                (b.quality === "reference" ? -1 : 1) ||
              distanceKm(point, a) - distanceKm(point, b),
          );
        setStationsLoading(true);
        try {
          const annotated = await attachModelBaselines(
            nearby,
            controller.signal,
          );
          if (!controller.signal.aborted) {
            next.stationData = { ...next.stationData, observations: annotated };
            setData({ ...next });
          }
        } catch {
          // Measurements remain visible. Unmatched stations never enter residual correction.
        } finally {
          if (!controller.signal.aborted) setStationsLoading(false);
        }
      }
      if (!controller.signal.aborted && next.model) {
        cache.set(key, { at: Date.now(), data: next });
        if (cache.size > 80) cache.delete(cache.keys().next().value!);
      }
    }, 300);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [point.lat, point.lon, revision]);
  const derived = useMemo(() => {
    const observations = clusterCitizens(
      qualityControl(data.stationData?.observations ?? [], Date.now()),
    ).filter((s) => distanceKm(point, s) <= radius);
    const result = estimate({
      point,
      model: data.model?.current ?? {},
      observations,
      now: Date.now(),
      radiusKm: radius,
      wind: data.weather
        ? {
            speed: data.weather.windSpeed,
            direction: data.weather.windDirection,
          }
        : undefined,
    });
    const modelTime =
      data.model?.time ?? Math.floor(Date.now() / 1000 / 3600) * 3600;
    const hours = (data.model?.hourly ?? []).map((h) =>
      h.time === modelTime ? { ...h, values: result.concentrations } : h,
    );
    const average = averagedConcentrations(hours, modelTime, standard);
    const index = aqi(average, standard, result.concentrations.ozone);
    const forecast = (data.model?.hourly ?? [])
      .filter((h) => h.time >= modelTime && h.time <= modelTime + 24 * 3600)
      .map((h) => ({
        time: h.time,
        ...aqi(
          averagedConcentrations(data.model!.hourly, h.time, standard),
          standard,
          h.values.ozone,
        ),
      }));
    return { result, index, average, forecast, observations, modelTime };
  }, [data, point, radius, standard]);
  return { ...data, ...derived, loading, stationsLoading };
}
