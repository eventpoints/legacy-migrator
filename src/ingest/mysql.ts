import mysql from "mysql2/promise";
import {
  DB_SCHEMA_VERSION,
  type DbColumn,
  type DbForeignKey,
  type DbIndex,
  type DbSchema,
  type DbTable,
} from "../schema/dbschema.js";

export interface MysqlConnectionOptions {
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
}

type Row = Record<string, unknown>;

const str = (v: unknown): string => (v == null ? "" : String(v));
const strOrNull = (v: unknown): string | null => (v == null ? null : String(v));
const intOrNull = (v: unknown): number | null =>
  v == null ? null : Number(v);

/**
 * Read the full structural schema of one MySQL database from INFORMATION_SCHEMA.
 * Readonly access is sufficient. No data rows are read.
 */
export async function introspectMysql(
  opts: MysqlConnectionOptions,
): Promise<DbSchema> {
  const conn = await mysql.createConnection({
    host: opts.host,
    port: opts.port,
    user: opts.user,
    password: opts.password,
    database: opts.database,
    // we only read metadata; keep it strict and quiet
    multipleStatements: false,
  });

  try {
    const db = opts.database;

    const [versionRows] = await conn.query<mysql.RowDataPacket[]>(
      "SELECT VERSION() AS v",
    );
    const serverVersion = strOrNull(versionRows[0]?.v) ?? null;

    const tableRows = await select(
      conn,
      `SELECT TABLE_NAME, ENGINE, TABLE_COLLATION, TABLE_ROWS, TABLE_COMMENT
         FROM information_schema.TABLES
        WHERE TABLE_SCHEMA = ? AND TABLE_TYPE = 'BASE TABLE'
        ORDER BY TABLE_NAME`,
      [db],
    );

    const columnRows = await select(
      conn,
      `SELECT TABLE_NAME, COLUMN_NAME, ORDINAL_POSITION, DATA_TYPE, COLUMN_TYPE,
              IS_NULLABLE, COLUMN_DEFAULT, COLUMN_KEY, EXTRA,
              CHARACTER_MAXIMUM_LENGTH, NUMERIC_PRECISION, NUMERIC_SCALE,
              COLUMN_COMMENT
         FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = ?
        ORDER BY TABLE_NAME, ORDINAL_POSITION`,
      [db],
    );

    const statRows = await select(
      conn,
      `SELECT TABLE_NAME, INDEX_NAME, NON_UNIQUE, SEQ_IN_INDEX, COLUMN_NAME,
              INDEX_TYPE
         FROM information_schema.STATISTICS
        WHERE TABLE_SCHEMA = ?
        ORDER BY TABLE_NAME, INDEX_NAME, SEQ_IN_INDEX`,
      [db],
    );

    const fkRows = await select(
      conn,
      `SELECT k.CONSTRAINT_NAME, k.TABLE_NAME, k.COLUMN_NAME, k.ORDINAL_POSITION,
              k.REFERENCED_TABLE_NAME, k.REFERENCED_COLUMN_NAME,
              r.UPDATE_RULE, r.DELETE_RULE
         FROM information_schema.KEY_COLUMN_USAGE k
         JOIN information_schema.REFERENTIAL_CONSTRAINTS r
           ON r.CONSTRAINT_SCHEMA = k.TABLE_SCHEMA
          AND r.CONSTRAINT_NAME = k.CONSTRAINT_NAME
        WHERE k.TABLE_SCHEMA = ? AND k.REFERENCED_TABLE_NAME IS NOT NULL
        ORDER BY k.TABLE_NAME, k.CONSTRAINT_NAME, k.ORDINAL_POSITION`,
      [db],
    );

    const columnsByTable = groupBy(columnRows, (r) => str(r.TABLE_NAME));
    const statsByTable = groupBy(statRows, (r) => str(r.TABLE_NAME));
    const fksByTable = groupBy(fkRows, (r) => str(r.TABLE_NAME));

    const tableNames = tableRows.map((r) => str(r.TABLE_NAME));

    const tables: DbTable[] = tableRows.map((t) => {
      const name = str(t.TABLE_NAME);
      const columns = buildColumns(columnsByTable.get(name) ?? []);
      const { indexes, primaryKey } = buildIndexes(
        statsByTable.get(name) ?? [],
      );
      const declaredFks = buildForeignKeys(fksByTable.get(name) ?? []);
      const inferredFks = inferForeignKeys(
        name,
        columns,
        tableNames,
        declaredFks,
      );

      return {
        name,
        engine: strOrNull(t.ENGINE),
        collation: strOrNull(t.TABLE_COLLATION),
        estimatedRows: intOrNull(t.TABLE_ROWS),
        comment: str(t.TABLE_COMMENT),
        columns,
        primaryKey,
        indexes,
        foreignKeys: [...declaredFks, ...inferredFks],
      };
    });

    const schema: DbSchema = {
      schemaVersion: DB_SCHEMA_VERSION,
      database: db,
      serverVersion,
      introspectedAt: new Date().toISOString(),
      tables,
    };
    return schema;
  } finally {
    await conn.end();
  }
}

async function select(
  conn: mysql.Connection,
  sql: string,
  params: unknown[],
): Promise<Row[]> {
  const [rows] = await conn.query<mysql.RowDataPacket[]>(sql, params);
  return rows as Row[];
}

function groupBy<T>(rows: T[], key: (r: T) => string): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const row of rows) {
    const k = key(row);
    const list = map.get(k) ?? [];
    list.push(row);
    map.set(k, list);
  }
  return map;
}

function buildColumns(rows: Row[]): DbColumn[] {
  return rows.map((r) => ({
    name: str(r.COLUMN_NAME),
    position: Number(r.ORDINAL_POSITION),
    dataType: str(r.DATA_TYPE),
    columnType: str(r.COLUMN_TYPE),
    nullable: str(r.IS_NULLABLE) === "YES",
    default: strOrNull(r.COLUMN_DEFAULT),
    key: str(r.COLUMN_KEY),
    extra: str(r.EXTRA),
    charMaxLength: intOrNull(r.CHARACTER_MAXIMUM_LENGTH),
    numericPrecision: intOrNull(r.NUMERIC_PRECISION),
    numericScale: intOrNull(r.NUMERIC_SCALE),
    comment: str(r.COLUMN_COMMENT),
  }));
}

function buildIndexes(rows: Row[]): {
  indexes: DbIndex[];
  primaryKey: string[];
} {
  const byIndex = groupBy(rows, (r) => str(r.INDEX_NAME));
  const indexes: DbIndex[] = [];
  let primaryKey: string[] = [];

  for (const [indexName, idxRows] of byIndex) {
    const ordered = [...idxRows].sort(
      (a, b) => Number(a.SEQ_IN_INDEX) - Number(b.SEQ_IN_INDEX),
    );
    const columns = ordered.map((r) => str(r.COLUMN_NAME));
    const unique = Number(ordered[0]?.NON_UNIQUE) === 0;

    if (indexName === "PRIMARY") {
      primaryKey = columns;
    }
    indexes.push({
      name: indexName,
      unique,
      type: str(ordered[0]?.INDEX_TYPE),
      columns,
    });
  }

  return { indexes, primaryKey };
}

function buildForeignKeys(rows: Row[]): DbForeignKey[] {
  const byConstraint = groupBy(rows, (r) => str(r.CONSTRAINT_NAME));
  const fks: DbForeignKey[] = [];

  for (const [name, fkRows] of byConstraint) {
    const ordered = [...fkRows].sort(
      (a, b) => Number(a.ORDINAL_POSITION) - Number(b.ORDINAL_POSITION),
    );
    fks.push({
      name,
      columns: ordered.map((r) => str(r.COLUMN_NAME)),
      referencedTable: str(ordered[0]?.REFERENCED_TABLE_NAME),
      referencedColumns: ordered.map((r) => str(r.REFERENCED_COLUMN_NAME)),
      onUpdate: strOrNull(ordered[0]?.UPDATE_RULE),
      onDelete: strOrNull(ordered[0]?.DELETE_RULE),
      origin: "declared",
    });
  }

  return fks;
}

/**
 * Heuristically infer foreign keys that the schema does not declare — common in
 * legacy databases. Strategy: a single-column `<x>_id` or `<x>Id` whose `<x>`
 * (singular or pluralised) matches a real table name, and which is not already
 * covered by a declared FK. These are hypotheses, flagged origin "inferred".
 */
function inferForeignKeys(
  table: string,
  columns: DbColumn[],
  tableNames: string[],
  declared: DbForeignKey[],
): DbForeignKey[] {
  const declaredCols = new Set(declared.flatMap((fk) => fk.columns));
  const tableSet = new Set(tableNames.map((t) => t.toLowerCase()));
  const inferred: DbForeignKey[] = [];

  for (const col of columns) {
    if (declaredCols.has(col.name)) continue;

    const m = col.name.match(/^(.*?)[_]?(?:id|Id|ID)$/);
    if (!m || !m[1]) continue;
    const base = m[1].replace(/_$/, "").toLowerCase();
    if (!base) continue;

    const candidates = [base, `${base}s`, `${base}es`];
    const target = candidates.find((c) => tableSet.has(c));
    if (!target || target === table.toLowerCase()) continue;

    const actualTable = tableNames.find((t) => t.toLowerCase() === target)!;
    inferred.push({
      name: `inferred_${table}_${col.name}`,
      columns: [col.name],
      referencedTable: actualTable,
      referencedColumns: ["id"],
      onUpdate: null,
      onDelete: null,
      origin: "inferred",
    });
  }

  return inferred;
}
