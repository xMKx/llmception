import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execGit } from "../../../src/util/exec.js";
import { Snapshot } from "../../../src/forker/snapshot.js";

describe("Snapshot", () => {
  let repoDir: string;

  beforeEach(async () => {
    // Create a real temporary git repo
    repoDir = await mkdtemp(join(tmpdir(), "llmception-snapshot-"));
    await execGit(["init"], repoDir);
    await execGit(["config", "user.email", "test@test.com"], repoDir);
    await execGit(["config", "user.name", "Test"], repoDir);

    // Create an initial commit so HEAD exists
    await writeFile(join(repoDir, "init.txt"), "initial");
    await execGit(["add", "-A"], repoDir);
    await execGit(["commit", "-m", "initial commit"], repoDir);
  });

  afterEach(async () => {
    await rm(repoDir, { recursive: true, force: true });
  });

  it("take() creates a commit and returns hash", async () => {
    await writeFile(join(repoDir, "file.txt"), "hello world");

    const hash = await Snapshot.take(repoDir, "snapshot commit");

    expect(hash).toMatch(/^[0-9a-f]{40}$/);

    // Verify the commit message
    const logMsg = await execGit(["log", "-1", "--format=%s"], repoDir);
    expect(logMsg).toBe("snapshot commit");
  });

  it("take() with no changes returns current HEAD", async () => {
    const headBefore = await Snapshot.getCurrentHead(repoDir);

    const hash = await Snapshot.take(repoDir, "should not commit");

    expect(hash).toBe(headBefore);

    // Verify no new commit was created
    const logMsg = await execGit(["log", "-1", "--format=%s"], repoDir);
    expect(logMsg).toBe("initial commit");
  });

  it("take() with new files includes them", async () => {
    await writeFile(join(repoDir, "a.txt"), "aaa");
    await writeFile(join(repoDir, "b.txt"), "bbb");

    const hash = await Snapshot.take(repoDir, "add two files");

    expect(hash).toMatch(/^[0-9a-f]{40}$/);

    // Verify both files are in the commit
    const files = await execGit(
      ["diff-tree", "--no-commit-id", "--name-only", "-r", hash],
      repoDir,
    );
    expect(files).toContain("a.txt");
    expect(files).toContain("b.txt");
  });

  it("getCurrentHead() returns correct hash", async () => {
    const hash = await Snapshot.getCurrentHead(repoDir);

    expect(hash).toMatch(/^[0-9a-f]{40}$/);

    // Should match what git rev-parse HEAD gives directly
    const expected = await execGit(["rev-parse", "HEAD"], repoDir);
    expect(hash).toBe(expected);
  });
});
