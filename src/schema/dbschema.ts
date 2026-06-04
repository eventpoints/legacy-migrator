import { z } from "zod";

/**
 * The introspected legacy database schema.
 *
 * This is a faithful, structural snapshot of the live schema as read from
 * INFORMATION_SCHEMA — tables, columns, keys, indexes, and foreign keys
 * (both explicit and heuristically inferred). It is deterministic input: no
 * AI is involved in producing it.
 *
 * It feeds two later stages:
 *  - new-schema design (what the modern, normalized target should look like)
 *  - data-mapping / migration (how legacy rows map to the new structure)
 *
 * Readonly access is sufficient to produce everything here.
 */

export const DbColumn = z.object({
  name: z.string(),
  position: z.number().int().positive(),
  /** Coarse type, e.g. "int", "varchar", "datetime". */
  dataType: z.string(),
  /** Full declared type, e.g. "int(11) unsigned", "varchar(255)", "tinyint(1)". */
  columnType: z.string(),
  nullable: z.boolean(),
  default: z.string().nullable(),
  /** INFORMATION_SCHEMA COLUMN_KEY: "PRI" | "UNI" | "MUL" | "". */
  key: z.string(),
  /** e.g. "auto_increment", "on update CURRENT_TIMESTAMP". */
  extra: z.string(),
  charMaxLength: z.number().int().nullable(),
  numericPrecision: z.number().int().nullable(),
  numericScale: z.number().int().nullable(),
  comment: z.string(),
});
export type DbColumn = z.infer<typeof DbColumn>;

export const DbIndex = z.object({
  name: z.string(),
  unique: z.boolean(),
  /** Index type, e.g. "BTREE", "FULLTEXT". */
  type: z.string(),
  /** Columns in index order. */
  columns: z.array(z.string()),
});
export type DbIndex = z.infer<typeof DbIndex>;

export const DbForeignKey = z.object({
  name: z.string(),
  columns: z.array(z.string()),
  referencedTable: z.string(),
  referencedColumns: z.array(z.string()),
  onUpdate: z.string().nullable(),
  onDelete: z.string().nullable(),
  /**
   * "declared"  — a real FK constraint in the schema
   * "inferred"  — no constraint exists; guessed from naming conventions.
   *               Legacy schemas frequently omit real FK constraints, so these
   *               matter, but they are a hypothesis to verify, not a fact.
   */
  origin: z.enum(["declared", "inferred"]),
});
export type DbForeignKey = z.infer<typeof DbForeignKey>;

export const DbTable = z.object({
  name: z.string(),
  engine: z.string().nullable(),
  collation: z.string().nullable(),
  /** INFORMATION_SCHEMA estimate — not exact for InnoDB. */
  estimatedRows: z.number().int().nullable(),
  comment: z.string(),
  columns: z.array(DbColumn),
  /** Primary key column names in order, if any. */
  primaryKey: z.array(z.string()),
  indexes: z.array(DbIndex),
  foreignKeys: z.array(DbForeignKey),
});
export type DbTable = z.infer<typeof DbTable>;

export const DB_SCHEMA_VERSION = "0.1.0" as const;

export const DbSchema = z.object({
  schemaVersion: z.literal(DB_SCHEMA_VERSION),
  database: z.string(),
  /** Server version string, e.g. "8.0.32". */
  serverVersion: z.string().nullable(),
  introspectedAt: z.string(),
  tables: z.array(DbTable),
});
export type DbSchema = z.infer<typeof DbSchema>;
