# Data and service credits

- Air-quality model: Copernicus Atmosphere Monitoring Service (CAMS), European Union, delivered by Open-Meteo. Data: [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). [Dataset credits and terms](https://open-meteo.com/en/docs/air-quality-api#citation).
- Weather and elevation: [Open-Meteo](https://open-meteo.com/), with its upstream model providers. The free hosted API is for non-commercial use under its [terms](https://open-meteo.com/en/terms). The app's MIT license does not override these terms.
- Citizen measurements: [Sensor.Community](https://sensor.community/en/), [Open Database License (ODbL)](https://opendatacommons.org/licenses/odbl/). Published station snapshots containing Sensor.Community measurements remain subject to ODbL; they are not relicensed as MIT. [API guidance](https://github.com/opendata-stuttgart/meta/wiki/APIs).
- Berlin reference measurements: Land Berlin, Berliner Luftgütemessnetz (BLUME), [Luftdaten Berlin](https://daten.berlin.de/datensaetze/luftdaten-berlin), [Datenlizenz Deutschland – Namensnennung – Version 2.0](https://www.govdata.de/dl-de/by-2-0). AQIHere normalizes and filters the source data and derives station indices.
- Additional reference measurements, when enabled: [OpenAQ](https://openaq.org/) and original providers, under station-specific licenses. Provider attribution is retained in each normalized record. [OpenAQ terms](https://docs.openaq.org/about/terms).
- Map data: © [OpenStreetMap contributors](https://www.openstreetmap.org/copyright), ODbL. Tiles are provided by the OpenStreetMap Foundation's community infrastructure and must follow its [tile usage policy](https://operations.osmfoundation.org/policies/tiles/). No offline bulk download or prefetch is implemented. Set a different tile provider when traffic exceeds community policy.
- Geocoding: Open-Meteo's [geocoding service](https://open-meteo.com/en/docs/geocoding-api), based on GeoNames.
- US AQI: US EPA [breakpoints](https://aqs.epa.gov/aqsweb/documents/codetables/aqi_breakpoints.html), including 2024 PM2.5 changes, and [AQI technical guidance](https://document.airnow.gov/technical-assistance-document-for-the-reporting-of-daily-air-quailty.pdf).
- Indian AQI: CPCB [National Air Quality Index](https://www.airquality.cpcb.gov.in/ccr_docs/About_AQI.pdf).
- European bands: EEA [European Air Quality Index](https://airindex.eea.europa.eu/AQI/), revised 2025 bands. Categories are shown as ordinal bands 1–6, not an invented numeric 0–100 index.

Vercel Hobby and the Open-Meteo free endpoint are intended for personal, non-commercial projects. No paid resource is required by this app; provider quotas and hosting terms still apply.
