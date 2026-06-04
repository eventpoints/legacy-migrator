import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseRequirements } from "./requirements.js";
import { computeCoverage } from "./coverage.js";

/**
 * Demonstrate the coverage metric against the example document, using a
 * hand-supplied map of file line counts (in the real pipeline this comes from
 * the repo ingest stage). Shows how unclaimed ranges surface as the gap.
 */
const docPath = resolve("examples/orders.requirements.json");
const doc = parseRequirements(JSON.parse(readFileSync(docPath, "utf8")));

// Pretend these are the real line counts from the legacy repo.
const fileLineCounts: Record<string, number> = {
  "application/controllers/Orders.php": 420,
  "application/models/Order_model.php": 300,
  "application/helpers/shipping_helper.php": 80,
};

const report = computeCoverage(doc, fileLineCounts);

console.log(`Overall coverage: ${(report.overall * 100).toFixed(1)}%`);
console.log(`Claimed ${report.claimedLines} / ${report.totalLines} lines\n`);
for (const f of report.files) {
  console.log(`${(f.coverage * 100).toFixed(1).padStart(5)}%  ${f.file}`);
  for (const gap of f.unclaimedRanges) {
    console.log(`        gap: lines ${gap.startLine}-${gap.endLine}`);
  }
}
