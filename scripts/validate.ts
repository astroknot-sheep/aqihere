import { readFile, writeFile } from "node:fs/promises";
import { qualityControl, clusterCitizens } from "../src/lib/estimate";
import { validateSnapshot } from "../src/lib/validation";
import type { StationSnapshot } from "../src/lib/types";

async function main() {
  const file = process.argv[2];
  if (!file)
    throw new Error(
      "Usage: npm run validate -- path/to/stations.json [report.json]",
    );
  const snapshot = JSON.parse(await readFile(file, "utf8")) as StationSnapshot;
  const records = clusterCitizens(
    qualityControl(snapshot.observations, Date.parse(snapshot.generatedAt)),
  );
  const report = {
    generatedAt: snapshot.generatedAt,
    region: snapshot.region,
    method: "Leave one station out; exclude monitors within 1 km",
    metrics: validateSnapshot(records),
  };
  if (process.argv[3])
    await writeFile(process.argv[3], JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
}
main().catch((e) => {
  console.error(e.message);
  process.exitCode = 1;
});
