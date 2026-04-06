import { execFile as execFileCb, spawn } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFileCb);

/**
 * Execute a git command and return trimmed stdout.
 * Throws an error with stderr content on failure.
 */
export async function execGit(args: string[], cwd?: string): Promise<string> {
  try {
    const { stdout } = await execFileAsync("git", args, {
      cwd,
      maxBuffer: 10 * 1024 * 1024,
    });
    return stdout.trimEnd();
  } catch (err: unknown) {
    const execErr = err as { stderr?: string; message?: string };
    const msg = execErr.stderr?.trim() || execErr.message || "git command failed";
    throw new Error(`git ${args[0]} failed: ${msg}`);
  }
}

/**
 * Execute a general command with optional input piping.
 * Returns stdout, stderr, and exit code.
 */
export async function execCommand(
  cmd: string,
  args: string[],
  opts?: { cwd?: string; input?: string; timeout?: number },
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      cwd: opts?.cwd,
      stdio: ["pipe", "pipe", "pipe"],
      timeout: opts?.timeout,
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (data: Buffer) => {
      stdout += data.toString();
    });

    child.stderr.on("data", (data: Buffer) => {
      stderr += data.toString();
    });

    child.on("error", (err) => {
      reject(err);
    });

    child.on("close", (code) => {
      resolve({
        stdout,
        stderr,
        exitCode: code ?? 1,
      });
    });

    if (opts?.input !== undefined) {
      child.stdin.write(opts.input);
      child.stdin.end();
    } else {
      child.stdin.end();
    }
  });
}
