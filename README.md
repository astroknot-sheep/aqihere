# AQIHere.earth

**The air around you, understood.** A free, open-source, map-first air-quality explorer built with Next.js 15, React 19, TypeScript, Leaflet, Tailwind CSS, Radix Dialog and Recharts. MIT application code; upstream data retain their own licenses.

AQIHere.earth is the brand name. A custom `.earth` domain is not registered by this project. Vercel provides the actual hosting URL.

## Run locally

Use Node 24 and npm.

```bash
npm ci
npm run dev
```

Open `http://127.0.0.1:3000`. The app works without keys. It fetches Open-Meteo air-quality and weather data **directly from the browser**, geocodes place searches, and uses a CDN-cached Sensor.Community bounding-box fallback for stations.

Optional configuration is in `.env.example`. Copy to `.env.local` for Next.js. Standalone snapshot scripts read environment variables from the process, not automatically from `.env.local`. Never expose the OpenAQ key through `NEXT_PUBLIC_` variables.

## Included

- Click or drag a map pin, search places or coordinates, or explicitly request browser geolocation.
- US AQI, Indian AQI, and revised European category bands; concentration interpolation happens before index calculation.
- Rolling model concentration windows: US 24h PM, 8h O3 plus high-ozone 1h sub-index, 1h NO2; India 24h PM/NO2 and 8h O3; EU hourly.
- Current pollutant concentrations, wind, humidity, moist-air density, AOD and elevation diagnostics.
- Fresh nearby monitor measurements, reference/citizen labels, distance, age, averaging period and correction participation.
- Snapshot → live citizen fallback → CAMS-only fallback, source switches and source diagnostics.
- 24-hour model forecast, shareable pin links, CSV export, desktop map and mobile detail sheet.
- Pure residual estimator, quality control, leave-one-station-out validation, automated snapshot collection and CI.

## Scientific scope

The result is an **indicative four-pollutant index**. It omits SO2 and CO, is not an official AQI, and is not a direct measurement at a pin. The map can be precise while the model grid is regional (~11 km Europe, ~45 km globally).

For each usable observation, `residual = observed concentration − model concentration at that station and observation hour`. The estimator applies an exponentially decaying residual field, shrunk by a zero-residual CAMS prior. Default length scale: 15 km. Source quality, freshness and a bounded wind factor adjust residual weights. Wind is meteorological FROM direction; its influence fades in calm conditions. These parameters are explicitly heuristic, not locally calibrated.

Only the **current model hour** is adjusted by fresh readings. Historical hours remain modeled; current PM correction therefore affects only one sample of a 24h PM index. Forecasts remain CAMS-only. This avoids silently projecting a current sensor residual across historical or future hours. Changing radius can change current concentrations without greatly changing the rolling daily index.

Citizen data are clustered by approximately 1 km cells, represented by a median observation, downweighted relative to references, checked for implausible values, stale timestamps and neighbor outliers. RH ≥85% is excluded **only when co-located RH exists**; no undocumented humidity correction is invented. Live readings are 5 min observations; scheduled citizen snapshots use 1h averages. OpenAQ latest records have unspecified provider averaging periods and are labeled accordingly.

Density and AOD are displayed, not used as accuracy multipliers. Confidence percentages and prediction intervals are deliberately absent. A holdout report compares residual correction against raw CAMS; it does not establish external accuracy or a calibrated uncertainty band. The validation excludes all monitors within 1 km of a held-out monitor to reduce spatial leakage. Independent reference validation over multiple dates is still needed.

## Station snapshots

The default launch snapshot is **Berlin region** (`west,south,east,north = 12.9,52.25,13.9,52.8`). The opening map is New Delhi; places outside snapshot coverage use live citizen stations or CAMS. Change the launch region via GitHub repository variables `SNAPSHOT_BBOX` and `SNAPSHOT_REGION`.

The scheduled GitHub Actions workflow runs about every ten minutes, subject to Actions scheduling delays. It:

1. Downloads Sensor.Community's bulk 1h feed once.
2. Optionally discovers up to 12 OpenAQ locations using a bounding box and fetches their latest values. Configure the free key as the repository Actions secret `OPENAQ_API_KEY`; do not put it in Vercel or client code.
3. Normalizes units to µg/m³, filters and clusters readings, caps the region at 32 monitor IDs and fetches their matching CAMS baselines in batches of 12.
4. Runs spatial holdout validation, publishes `data/stations.json` and `data/validation.json` to the `snapshots` branch, and preserves the previous published snapshot if every source fails.

The cap keeps the worst-case station model baseline workload around 4,608 coordinate requests/day at 144 scheduled runs, before provider accounting factors. OpenAQ uses at most 13 calls/run (1,872/day). Quotas can change; inspect usage before expanding the region. Snapshots older than 2h are rejected. Snapshot and live fetches have independent timeouts; a source failure never substitutes fabricated readings.

Point Vercel's `STATION_SNAPSHOT_URL` at:

```text
https://raw.githubusercontent.com/astroknot-sheep/aqihere/snapshots/data/stations.json
```

You can also host that compact file on GitHub Pages. A separately paid Blob store is unnecessary. The `snapshots` branch is excluded from Vercel Git deployments in `vercel.json`.

Run manually:

```bash
npm run snapshot
npm run validate -- work/snapshots/stations.json work/snapshots/replay-report.json
```

The API route rounds lookup centers to 0.1° and includes an approximately 60 km margin. Only sensor discovery is bucketed: the **pin stays exact** for distance calculation and model requests (the provider itself resolves to a grid). API responses use `s-maxage=300, stale-while-revalidate=300`, upstream Next fetch caching uses 300s, and a bounded browser memory cache deduplicates model results for 5 min by ~0.01° buckets. There is no promise of durable server memory caching. Source status and latency are logged server-side; CDN cache headers are supplied by Vercel.

## Checks and deployment

```bash
npm test
npm run typecheck
npm run build
```

CI runs tests and a production build. The calculation tests cover current EPA PM breakpoints, EEA revision, Indian endpoints, gas unit conversion, rolling windows and missing data, bounded residual correction, meteorological wind direction, density, sensor QC and spatial holdout leakage.

Import this repository into Vercel with the Next.js framework preset and Node 24. No required environment variables. Add the optional snapshot URL for precomputed station coverage. Set `ENABLE_SENSOR_COMMUNITY=false` to disable live station lookups. In Actions, set `ENABLE_OPENAQ=false` or omit its key to disable OpenAQ. The first snapshot can be triggered from GitHub Actions → Refresh regional station snapshot → Run workflow.

Public API input is validated. No personal location is collected automatically or persisted; clicking Locate me explicitly invokes the browser's location permission. Model and geocoding requests go to Open-Meteo, station lookups go through the app server, map tile requests go to OpenStreetMap. Shared URLs contain the chosen coordinates. There are no accounts, analytics, paid services, database or tracking cookies.

See [NOTICE.md](NOTICE.md) for required attribution, provider licenses, non-commercial API/hosting terms and tile usage constraints.
