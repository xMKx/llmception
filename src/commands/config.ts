import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { loadConfig } from "../config/schema.js";

export interface ConfigOpts {
  set?: string;
}

export async function configAction(opts: ConfigOpts): Promise<void> {
  const cwd = process.cwd();

  if (opts.set) {
    // --set expects "key value" but Commander gives us the first arg;
    // the remaining args come from Commander's variadic processing.
    // We handle this in the CLI wiring by consuming extra args.
    console.error('Use: llmception config --set <key> <value>');
    console.error('Example: llmception config --set maxDepth 5');
    process.exitCode = 1;
    return;
  }

  // Show current configuration
  const config = await loadConfig(cwd);
  console.log(JSON.stringify(config, null, 2));
}

export async function configSetAction(key: string, value: string): Promise<void> {
  const cwd = process.cwd();
  const configPath = join(cwd, ".llmception.json");

  // Read existing project config
  let existing: Record<string, unknown> = {};
  try {
    const content = await readFile(configPath, "utf-8");
    existing = JSON.parse(content) as Record<string, unknown>;
  } catch {
    // File doesn't exist yet
  }

  // Parse value (try number, boolean, then string)
  let parsed: unknown = value;
  if (value === "true") parsed = true;
  else if (value === "false") parsed = false;
  else {
    const num = Number(value);
    if (!Number.isNaN(num) && value.trim() !== "") parsed = num;
  }

  // Handle dotted keys (e.g. budget.totalUsd)
  const parts = key.split(".");
  if (parts.length === 1) {
    existing[key] = parsed;
  } else {
    let obj = existing;
    for (let i = 0; i < parts.length - 1; i++) {
      if (typeof obj[parts[i]] !== "object" || obj[parts[i]] === null) {
        obj[parts[i]] = {};
      }
      obj = obj[parts[i]] as Record<string, unknown>;
    }
    obj[parts[parts.length - 1]] = parsed;
  }

  await writeFile(configPath, JSON.stringify(existing, null, 2) + "\n", "utf-8");
  console.log(`Set ${key} = ${JSON.stringify(parsed)} in .llmception.json`);
}
