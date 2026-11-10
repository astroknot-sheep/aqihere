"use client";
import { useEffect, useMemo, useState } from "react";
import {
  averagedConcentrations,
  aqi,
  currentModelIndex,
  periodMean,
} from "@/lib/aqi";
import { calibrate } from "@/lib/calibration";
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
      let next: Data = {
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
      const stationData = next.stationData;
      if (
        stationData?.observations.length &&
        stationData.calibration?.algorithm !== "robust-residual-v2"
      ) {
        const nearby = stationData.observations
          .filter((s) => distanceKm(point, s) <= 50)
          .sort(
            (a, b) =>
              (a.quality === "reference" ? -1 : 1) -
                (b.quality === "reference" ? -1 : 1) ||
              distanceKm(point, a) - distanceKm(point, b),
          );
        const ids = new Set([...new Set(nearby.map((s) => s.id))].slice(0, 24));
        setStationsLoading(true);
        try {
          const annotated = await attachModelBaselines(
            nearby.filter((s) => ids.has(s.id)),
            controller.signal,
          );
          if (!controller.signal.aborted) {
            const calibration = calibrate(annotated, Date.now());
            next = {
              ...next,
              stationData: {
                ...stationData,
                observations: [
                  ...annotated,
                  ...stationData.observations.filter((s) => !ids.has(s.id)),
                ],
                calibration,
                validation: calibration.validation,
              },
            };
            setData(next);
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
      configs: data.stationData?.calibration?.configs ?? {},
    });
    const modelTime =
      data.model?.time ?? Math.floor(Date.now() / 1000 / 3600) * 3600;
    const history = data.stationData?.history ?? [];
    let correctedHistoryHours = 0;
    const hours = (data.model?.hourly ?? []).map((h) => {
      if (h.time === modelTime) return { ...h, values: result.concentrations };
      if (h.time > modelTime) return h;
      // Historical hours can use only observations that actually existed by
      // that hour. Current residuals are never backfilled into the past.
      const past = history.filter(
        (s) =>
          Date.parse(s.ts) <= h.time * 1000 &&
          h.time * 1000 - Date.parse(s.ts) <= 7200000,
      );
      if (!past.length) return h;
      const corrected = estimate({
        point,
        model: h.values,
        observations: past,
        now: h.time * 1000,
        radiusKm: radius,
        configs: data.stationData?.calibration?.configs ?? {},
      });
      if (corrected.stations.length && h.time > modelTime - 24 * 3600)
        correctedHistoryHours++;
      return { ...h, values: corrected.concentrations };
    });
    const { indexTime, average, index } = currentModelIndex(
      hours,
      modelTime,
      standard,
    );
    const forecast = (data.model?.hourly ?? [])
      .filter((h) => h.time >= modelTime && h.time <= modelTime + 24 * 3600)
      .map((h) => ({
        time: h.time,
        ...aqi(
          averagedConcentrations(data.model!.hourly, h.time, standard),
          standard,
          h.values.ozone,
          periodMean(data.model!.hourly, h.time, "sulphur_dioxide", 24),
        ),
      }));
    return {
      result,
      index,
      average,
      forecast,
      observations,
      modelTime,
      indexTime,
      correctedHistoryHours,
    };
  }, [data, point, radius, standard]);
  return { ...data, ...derived, loading, stationsLoading };
}
