# AQIHere.earth

A free, open-source air-quality map built with Next.js, React, TypeScript and Leaflet. [Open the map](https://aqihere.vercel.app/).

## Run locally

Use Node 24 and npm.

```bash
npm ci
npm run dev
```

Open `http://127.0.0.1:3000`. See `.env.example` for optional settings. Standalone snapshot scripts use process environment variables. OpenAQ keys belong in the snapshot runner's environment.

## Regional estimates

The map shows indicative US and Indian AQI and European air-quality bands. CAMS provides a regional field at approximately 11 km grid spacing in Europe and 45 km globally. PM₂.₅, PM₁₀, NO₂, O₃, SO₂ and CO are available where the source provides them. The EEA bands use five pollutants. The Indian index uses six of the eight CPCB pollutants and omits NH₃ and lead.

The US particulate calculation uses the EPA PM NowCast over the last 12 clock hours. Ozone and CO use 8-hour averages, and NO₂ and SO₂ use hourly values with the high-concentration rules. US ozone uses a rolling 8-hour mean and the high-concentration 1-hour sub-index. India uses rolling 24-hour PM, NO₂ and SO₂ and 8-hour O₃ and CO. The EEA bands use hourly values.

A monitor residual is the measured concentration minus the model average over the same sampling window. Corrections weight residuals by distance, source quality and freshness. When the reference history supports it, earlier hours are used to fit and select a correction and later hours are held out for evaluation. Every held-out monitor and observations within 1 km are excluded from its spatial prediction. Sparse areas use spatial folds and can retain CAMS if the correction fails validation. Forecasts use CAMS. Current corrections to past hours use measurements available at those hours.

The Sources panel reports the data tier, held-out sample count and errors. These tests measure performance at withheld stations over the available sample. Establishing accuracy between stations would require longer independent evaluation and validated inputs for dispersion at that scale.

## Street measurements

The Street tab searches 10, 25, 50 or 100 metres from the pin for recent outdoor observations with published station coordinates or community coordinates marked exact. The radius includes device position uncertainty when the pin comes from geolocation. The tab displays distance, site type, sampling window and concentrations at each instrument. Where an hourly reference series is available it also derives a station index from that instrument's measurements.

Berlin has hourly reference data from BLUME. Each result describes the monitor's location, with roadside and background stations labeled separately. Places without an eligible monitor in range can use the regional view. A street-level concentration field between instruments requires local emissions, street and building geometry, meteorology and independent validation. [Berlin open data](https://daten.berlin.de/datensaetze/luftdaten-berlin) · [Street dispersion research](https://acp.copernicus.org/articles/24/807/2024/)

## Station snapshots

The default snapshot covers the Berlin region. Set `SNAPSHOT_BBOX` (west, south, east, north) and `SNAPSHOT_REGION` as GitHub Actions variables to change coverage. The workflow runs on a ten-minute schedule subject to Actions delays. It collects the hourly Berlin reference feed, the Sensor.Community bulk feed and optional OpenAQ readings, prioritizes references among up to 96 modeled stations, and publishes snapshot, baseline-cache and validation JSON to the `snapshots` branch. Snapshots older than two hours fall back to live community stations or CAMS. CAMS baselines are reused for up to one hour to limit provider calls.

Set `STATION_SNAPSHOT_URL` on Vercel to the published snapshot URL. Set `ENABLE_SENSOR_COMMUNITY=false` on Vercel to disable live community lookups. Configure `OPENAQ_API_KEY` as a GitHub Actions secret to enable OpenAQ collection. Check provider usage and terms before increasing coverage.

```bash
npm run snapshot
npm run benchmark -- work/snapshots/stations.json work/snapshots/replay-report.json
npm test
npm run typecheck
npm run build
```

The pin's coordinates appear in a shared URL. Browser geolocation runs after the user requests it. Model and geocoding requests use Open-Meteo, station lookups go through the app server, and tiles use OpenStreetMap. See [NOTICE.md](NOTICE.md) for provider attribution and terms.
