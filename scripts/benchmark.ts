import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { calibrateWithHistory } from "../src/lib/calibration";
import type { StationSnapshot } from "../src/lib/types";
async function main() {
  const file = process.argv[2];
  if (!file)
    throw new Error("Usage: npm run benchmark -- snapshot.json [report.json]");
  const snapshot = JSON.parse(await readFile(file, "utf8")) as StationSnapshot;
  const result = calibrateWithHistory(
    snapshot.observations,
    snapshot.history ?? [],
    Date.parse(snapshot.generatedAt),
  );
  const report = {
    snapshotTime: snapshot.generatedAt,
    region: snapshot.region,
    datasetSha256: createHash("sha256")
      .update(JSON.stringify([snapshot.observations, snapshot.history ?? []]))
      .digest("hex"),
    stationCount: new Set(snapshot.observations.map((s) => s.id)).size,
    referenceStationCount: new Set(
      snapshot.observations
        .filter((s) => s.quality === "reference")
        .map((s) => s.id),
    ).size,
    method: result.method,
    metrics: result.validation,
    parameters: result.configs,
    limitations: [
      "Evaluation covers the Berlin reference network over the available hourly history.",
      "Comparisons use the same held-out measurements. The legacy comparison uses the new matched-window baselines and the same radius as the default regional view.",
      "Temporal metrics evaluate the configuration selected on earlier hours. Street coverage comes from station measurements.",
      "Source data: Land Berlin BLUME dl-de-by-2.0, Sensor.Community ODbL, and CAMS/Open-Meteo CC BY 4.0.",
    ],
  };
  if (process.argv[3])
    await writeFile(process.argv[3], JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
}
main().catch((e) => {
  console.error(e.message);
  process.exitCode = 1;
});
