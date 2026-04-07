#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { Command } from "commander";
import { exploreAction } from "./commands/explore.js";
import { statusAction } from "./commands/status.js";
import { answerAction } from "./commands/answer.js";
import { diffAction } from "./commands/diff.js";
import { applyAction } from "./commands/apply.js";
import { cleanupAction } from "./commands/cleanup.js";
import { costAction } from "./commands/cost.js";
import { configAction, configSetAction } from "./commands/config.js";

async function getVersion(): Promise<string> {
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = dirname(__filename);
  // In dist/ we need to go up one level; in src/ (via tsx) we also go up one level
  const pkgPath = join(__dirname, "..", "package.json");
  try {
    const content = await readFile(pkgPath, "utf-8");
    const pkg = JSON.parse(content) as { version: string };
    return pkg.version;
  } catch {
    return "0.0.0";
  }
}

async function main(): Promise<void> {
  const version = await getVersion();
  const program = new Command();

  program
    .name("llmception")
    .description(
      "Explore multiple implementation paths for ambiguous LLM prompts via decision trees",
    )
    .version(version);

  // explore <task>
  program
    .command("explore <task>")
    .alias("e")
    .description("Start exploring an ambiguous task")
    .option("--depth <n>", "override maxDepth")
    .option("--width <n>", "override maxWidth")
    .option("--budget <usd>", "override total budget in USD")
    .option("--model <model>", "override model")
    .option("--provider <type>", "override provider")
    .option("--concurrency <n>", "override concurrency")
    .option("--node-budget <n>", "override node budget")
    .option("--answer <value>", "pre-answer questions (by index or label substring, repeatable)", (val: string, prev: string[]) => [...prev, val], [] as string[])
    .action(exploreAction);

  // status
  program
    .command("status")
    .alias("s")
    .description("Show current exploration status")
    .option("--tree", "show full tree visualization")
    .option("--json", "output as JSON")
    .action(statusAction);

  // answer <option>
  program
    .command("answer <option>")
    .alias("a")
    .description("Answer the current question (1-based option index)")
    .action(answerAction);

  // diff [nodeId]
  program
    .command("diff [nodeId]")
    .alias("d")
    .description("Show diff for a completed branch")
    .action((nodeId?: string) => diffAction({ nodeId }));

  // apply
  program
    .command("apply")
    .alias("p")
    .description("Apply the winning implementation to the working tree")
    .action(applyAction);

  // cleanup
  program
    .command("cleanup")
    .alias("c")
    .description("Remove all llmception worktrees and branches")
    .action(cleanupAction);

  // cost
  program
    .command("cost")
    .description("Show cost breakdown")
    .action(costAction);

  // config
  const configCmd = program
    .command("config")
    .description("Show or modify configuration");

  configCmd
    .command("show", { isDefault: true })
    .description("Show current configuration")
    .action(() => configAction({}));

  configCmd
    .command("set <key> <value>")
    .description("Set a config value in project .llmception.json")
    .action(configSetAction);

  await program.parseAsync(process.argv);
}

main().catch((err: unknown) => {
  console.error("Fatal error:", err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
