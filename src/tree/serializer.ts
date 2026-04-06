import { readdir, readFile, writeFile, mkdir, unlink } from "node:fs/promises";
import { join } from "node:path";
import type { DecisionTreeState } from "../types.js";
import { DecisionTree } from "./tree.js";

const LLMCEPTION_DIR = ".llmception";

/**
 * Persistence layer for decision trees.
 * Trees are stored as JSON files in {projectDir}/.llmception/tree-{id}.json
 */
export class TreeSerializer {
  /** Save a decision tree to disk */
  static async save(tree: DecisionTree, dir: string): Promise<void> {
    const targetDir = join(dir, LLMCEPTION_DIR);
    await mkdir(targetDir, { recursive: true });

    const state = tree.toState();
    const filePath = join(targetDir, `tree-${state.id}.json`);
    const json = JSON.stringify(state, null, 2);
    await writeFile(filePath, json, "utf-8");
  }

  /** Load a specific tree by ID */
  static async load(
    treeId: string,
    dir: string,
  ): Promise<DecisionTree | null> {
    const filePath = join(dir, LLMCEPTION_DIR, `tree-${treeId}.json`);
    try {
      const json = await readFile(filePath, "utf-8");
      const state: DecisionTreeState = JSON.parse(json) as DecisionTreeState;
      return DecisionTree.fromState(state);
    } catch {
      return null;
    }
  }

  /** Load the most recently updated tree from the directory */
  static async loadLatest(dir: string): Promise<DecisionTree | null> {
    const targetDir = join(dir, LLMCEPTION_DIR);
    let files: string[];
    try {
      files = await readdir(targetDir);
    } catch {
      return null;
    }

    const treeFiles = files.filter(
      (f) => f.startsWith("tree-") && f.endsWith(".json"),
    );
    if (treeFiles.length === 0) return null;

    let latestTree: DecisionTree | null = null;
    let latestUpdated = "";

    for (const file of treeFiles) {
      const filePath = join(targetDir, file);
      try {
        const json = await readFile(filePath, "utf-8");
        const state: DecisionTreeState = JSON.parse(json) as DecisionTreeState;
        if (state.updatedAt > latestUpdated) {
          latestUpdated = state.updatedAt;
          latestTree = DecisionTree.fromState(state);
        }
      } catch {
        // Skip corrupted files
      }
    }

    return latestTree;
  }

  /** List all tree IDs stored in the directory */
  static async list(dir: string): Promise<string[]> {
    const targetDir = join(dir, LLMCEPTION_DIR);
    let files: string[];
    try {
      files = await readdir(targetDir);
    } catch {
      return [];
    }

    return files
      .filter((f) => f.startsWith("tree-") && f.endsWith(".json"))
      .map((f) => f.replace(/^tree-/, "").replace(/\.json$/, ""));
  }

  /** Remove a tree file from disk */
  static async remove(treeId: string, dir: string): Promise<void> {
    const filePath = join(dir, LLMCEPTION_DIR, `tree-${treeId}.json`);
    try {
      await unlink(filePath);
    } catch {
      // Ignore if file doesn't exist
    }
  }
}
