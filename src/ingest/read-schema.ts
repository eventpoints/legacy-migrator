import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { introspectMysql, type MysqlConnectionOptions } from "./mysql.js";
import { DEFAULT_CONFIG_PATH, loadConfig } from "../config/config.js";

/**
 * Read a legacy MySQL schema and write it as a DbSchema artifact.
 *
 * Connection settings resolve in this order (first wins):
 *   CLI flags  >  config file  >  environment variables  >  defaults
 *
 * Usage:
 *   tsx src/ingest/read-schema.ts                       # use migrator.config.json
 *   tsx src/ingest/read-schema.ts --config other.json   # alternate config
 *   tsx src/ingest/read-schema.ts --database otherdb     # override one field
 *
 * Env fallbacks: MYSQL_HOST, MYSQL_PORT, MYSQL_USER, MYSQL_PASSWORD, MYSQL_DATABASE
 */

function parseFlags(argv: string[]): Record<string, string> {
  const flags: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next && !next.startsWith("--")) {
        flags[key] = next;
        i++;
      } else {
        flags[key] = "true";
      }
    }
  }
  return flags;
}

async function main() {
  const flags = parseFlags(process.argv.slice(2));
  const env = process.env;

  // Config file is optional here; CLI flags / env can fully specify a connection.
  let configDb: Partial<MysqlConnectionOptions> = {};
  let artifactsDir = "artifacts";
  const configPath = flags.config ?? DEFAULT_CONFIG_PATH;
  try {
    const config = loadConfig(configPath);
    configDb = config.database;
    artifactsDir = config.artifactsDir;
  } catch (err) {
    // Only fatal if the user explicitly pointed at a config that failed.
    if (flags.config) throw err;
  }

  const opts: MysqlConnectionOptions = {
    host: flags.host ?? configDb.host ?? env.MYSQL_HOST ?? "127.0.0.1",
    port: Number(flags.port ?? configDb.port ?? env.MYSQL_PORT ?? "4406"),
    user: flags.user ?? configDb.user ?? env.MYSQL_USER ?? "root",
    password:
      flags.password ?? configDb.password ?? env.MYSQL_PASSWORD ?? "",
    database: flags.database ?? configDb.database ?? env.MYSQL_DATABASE ?? "",
  };

  if (!opts.database) {
    console.error(
      "error: no database specified. Set it in migrator.config.json, " +
        "pass --database <name>, or set MYSQL_DATABASE.",
    );
    process.exit(2);
  }

  const outPath = resolve(
    flags.out ?? `${artifactsDir}/${opts.database}.dbschema.json`,
  );

  console.error(
    `Connecting to ${opts.user}@${opts.host}:${opts.port}/${opts.database} ...`,
  );

  const schema = await introspectMysql(opts);

  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, JSON.stringify(schema, null, 2) + "\n");

  const tableCount = schema.tables.length;
  const columnCount = schema.tables.reduce((n, t) => n + t.columns.length, 0);
  const declaredFks = schema.tables.reduce(
    (n, t) => n + t.foreignKeys.filter((f) => f.origin === "declared").length,
    0,
  );
  const inferredFks = schema.tables.reduce(
    (n, t) => n + t.foreignKeys.filter((f) => f.origin === "inferred").length,
    0,
  );

  console.error(`Server: MySQL ${schema.serverVersion ?? "unknown"}`);
  console.error(
    `Read ${tableCount} table(s), ${columnCount} column(s), ` +
      `${declaredFks} declared FK(s), ${inferredFks} inferred FK(s)`,
  );
  console.error(`Wrote ${outPath}`);
}

main().catch((err) => {
  console.error("introspection failed:");
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
