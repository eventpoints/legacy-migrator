import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseRequirements } from "./requirements.js";

/**
 * Validate a requirements JSON file against the schema.
 * Usage: tsx src/schema/validate.ts <path-to-document.json>
 */
const arg = process.argv[2];
if (!arg) {
  console.error("usage: validate.ts <path-to-requirements.json>");
  process.exit(2);
}

const path = resolve(arg);
const raw = JSON.parse(readFileSync(path, "utf8"));

try {
  const doc = parseRequirements(raw);
  const slices = doc.slices.length;
  const features = doc.slices.reduce((n, s) => n + s.features.length, 0);
  const rules = doc.slices.reduce(
    (n, s) => n + s.features.reduce((m, f) => m + f.rules.length, 0),
    0,
  );
  console.log(`OK  ${path}`);
  console.log(`    ${slices} slice(s), ${features} feature(s), ${rules} rule(s)`);
} catch (err) {
  console.error(`INVALID  ${path}`);
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
}
