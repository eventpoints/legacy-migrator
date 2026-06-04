import { z } from "zod";

/**
 * The requirements artifact is the backbone of the whole pipeline.
 *
 * It is the explicit, human-reviewable specification extracted from the legacy
 * codebase. Every downstream stage (new schema design, code generation, test
 * generation, data mapping) derives from this document — never directly from
 * the legacy code. Corrections happen here, on the artifact a human can reason
 * about, not across hundreds of generated files.
 *
 * Two properties are load-bearing and enforced by this schema:
 *
 *   1. TRACEABILITY. Every rule links DOWN to the exact legacy source locations
 *      it was derived from (`sourceRefs`). Inverting these links lets us measure
 *      what fraction of the legacy code is "claimed" by some requirement — the
 *      unclaimed remainder is our completeness gap (errors of omission), the one
 *      class of extraction error that human review cannot catch on its own.
 *
 *   2. TESTABILITY. Rules are behavioral specs in Given/When/Then form so they
 *      compile (nearly mechanically) into characterisation tests.
 */

/** A pointer back into the legacy codebase. The unit of traceability. */
export const SourceRef = z
  .object({
    /** Repo-relative path, e.g. "application/controllers/Orders.php". */
    file: z.string().min(1),
    /** Enclosing symbol (function/method/class), if known. */
    symbol: z.string().optional(),
    startLine: z.number().int().positive(),
    endLine: z.number().int().positive(),
  })
  .refine((r) => r.endLine >= r.startLine, {
    message: "endLine must be >= startLine",
  });
export type SourceRef = z.infer<typeof SourceRef>;

export const AccessMode = z.enum(["read", "write", "read-write"]);
export type AccessMode = z.infer<typeof AccessMode>;

/**
 * A table/column the rule reads or writes. This is what lets the SAME document
 * drive the new-schema design and the data-mapping stage, instead of those
 * being independent guesses.
 */
export const DataTouchpoint = z.object({
  table: z.string().min(1),
  columns: z.array(z.string()).default([]),
  access: AccessMode,
  note: z.string().optional(),
});
export type DataTouchpoint = z.infer<typeof DataTouchpoint>;

/**
 * Review lifecycle of a node.
 *  - extracted: produced by the AI, not yet seen by a human
 *  - reviewed:  a human confirmed it as-is
 *  - corrected: a human edited it (errors of commission fixed here)
 *  - rejected:  a human marked it as a hallucination / not a real requirement
 */
export const ReviewStatus = z.enum([
  "extracted",
  "reviewed",
  "corrected",
  "rejected",
]);
export type ReviewStatus = z.infer<typeof ReviewStatus>;

/** A single, testable behavioral rule. The leaf of the hierarchy. */
export const Rule = z.object({
  /** Stable dotted id, e.g. "orders.checkout.free-shipping". */
  id: z.string().min(1),
  name: z.string().min(1),
  /** Preconditions. */
  given: z.array(z.string()).default([]),
  /** The triggering action/event. */
  when: z.string().min(1),
  /** Expected outcomes — at least one, or the rule asserts nothing. */
  then: z.array(z.string()).min(1),
  dataTouchpoints: z.array(DataTouchpoint).default([]),
  /** Traceability: a rule with no source is not extracted, it is invented. */
  sourceRefs: z.array(SourceRef).min(1),
  /** Extractor's self-rated confidence, 0..1. Low confidence => review first. */
  confidence: z.number().min(0).max(1),
  status: ReviewStatus.default("extracted"),
  notes: z.string().optional(),
});
export type Rule = z.infer<typeof Rule>;

/** A feature within a slice — a coherent capability the app offers. */
export const Feature = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  description: z.string().default(""),
  /** Routes, CLI commands, cron jobs, queue consumers — how it is invoked. */
  entrypoints: z.array(z.string()).default([]),
  rules: z.array(Rule).default([]),
  sourceRefs: z.array(SourceRef).default([]),
  status: ReviewStatus.default("extracted"),
});
export type Feature = z.infer<typeof Feature>;

/** A vertical slice — a business domain / bounded context. Top of the tree. */
export const Slice = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  description: z.string().default(""),
  features: z.array(Feature).default([]),
  sourceRefs: z.array(SourceRef).default([]),
  status: ReviewStatus.default("extracted"),
});
export type Slice = z.infer<typeof Slice>;

export const RepoMeta = z.object({
  url: z.string().optional(),
  /** Commit SHA the extraction was run against — pins traceability in time. */
  commit: z.string().optional(),
  language: z.string().optional(),
  /** ISO 8601 timestamp. */
  analyzedAt: z.string(),
});
export type RepoMeta = z.infer<typeof RepoMeta>;

export const SCHEMA_VERSION = "0.1.0" as const;

/** The root artifact. One document describes one legacy application. */
export const RequirementsDocument = z.object({
  schemaVersion: z.literal(SCHEMA_VERSION),
  repo: RepoMeta,
  slices: z.array(Slice).default([]),
});
export type RequirementsDocument = z.infer<typeof RequirementsDocument>;

/** Parse + validate unknown input (e.g. raw LLM output) into a typed document. */
export function parseRequirements(input: unknown): RequirementsDocument {
  return RequirementsDocument.parse(input);
}
