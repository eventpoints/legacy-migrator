import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { z } from "zod";

/**
 * Pipeline configuration.
 *
 * Lives in `migrator.config.json` at the project root (gitignored — it can hold
 * credentials). A committed `migrator.config.example.json` documents the shape.
 *
 * Any string value may reference an environment variable with `${VAR}`, so you
 * can keep secrets out of the file:
 *
 *   "password": "${MYSQL_PASSWORD}"
 */

export const DatabaseConfig = z.object({
  host: z.string().default("127.0.0.1"),
  port: z.number().int().positive().default(4406),
  user: z.string(),
  password: z.string().default(""),
  database: z.string(),
});
export type DatabaseConfig = z.infer<typeof DatabaseConfig>;

export const RepoConfig = z.object({
  /** Local path to the legacy codebase, or a git URL to clone. */
  path: z.string().optional(),
});
export type RepoConfig = z.infer<typeof RepoConfig>;

export const MigratorConfig = z.object({
  database: DatabaseConfig,
  repo: RepoConfig.optional(),
  /** Where artifacts (schema dumps, requirements docs, reports) are written. */
  artifactsDir: z.string().default("artifacts"),
});
export type MigratorConfig = z.infer<typeof MigratorConfig>;

export const DEFAULT_CONFIG_PATH = "migrator.config.json";

/** Recursively replace ${VAR} in any string value with process.env[VAR]. */
function interpolateEnv(value: unknown): unknown {
  if (typeof value === "string") {
    return value.replace(/\$\{([A-Z0-9_]+)\}/gi, (_, name: string) => {
      const v = process.env[name];
      if (v === undefined) {
        throw new Error(
          `config references environment variable \${${name}} which is not set`,
        );
      }
      return v;
    });
  }
  if (Array.isArray(value)) return value.map(interpolateEnv);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [k, interpolateEnv(v)]),
    );
  }
  return value;
}

/** Load, env-interpolate, and validate the config file. */
export function loadConfig(path = DEFAULT_CONFIG_PATH): MigratorConfig {
  const full = resolve(path);
  if (!existsSync(full)) {
    throw new Error(
      `config file not found: ${full}\n` +
        `Copy migrator.config.example.json to ${DEFAULT_CONFIG_PATH} and fill it in.`,
    );
  }
  const raw = JSON.parse(readFileSync(full, "utf8"));
  const interpolated = interpolateEnv(raw);
  return MigratorConfig.parse(interpolated);
}
