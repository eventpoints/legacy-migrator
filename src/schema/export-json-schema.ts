import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { zodToJsonSchema } from "zod-to-json-schema";
import { RequirementsDocument, SCHEMA_VERSION } from "./requirements.js";

/**
 * Emit the requirements format as a JSON Schema. Two uses:
 *  - documentation of the artifact contract
 *  - constraining LLM structured output during extraction
 */
const jsonSchema = zodToJsonSchema(RequirementsDocument, {
  name: "RequirementsDocument",
  $refStrategy: "none",
});

const outPath = resolve("schema/requirements.schema.json");
mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, JSON.stringify(jsonSchema, null, 2) + "\n");

console.log(`Wrote JSON Schema (v${SCHEMA_VERSION}) -> ${outPath}`);
