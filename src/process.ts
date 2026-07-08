import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";

export const metadataCommandTimeoutMs = 10_000;

export function resolveExecutable(command: string) {
  const pathValue = process.env.PATH || "";
  return pathValue
    .split(path.delimiter)
    .map((directory) => path.join(directory, command))
    .find((candidate) => existsSync(candidate));
}

export function getVersionArgs() {
  return ["--version"];
}

export function runCommand(
  command: string,
  args: string[],
  options: { pipeOutput: boolean; env?: NodeJS.ProcessEnv; timeoutMs?: number },
) {
  return new Promise<{ exitCode: number; stdout: string; stderr: string }>(
    (resolve) => {
      const child = spawn(command, args, {
        env: options.env,
        stdio: options.pipeOutput ? ["ignore", "pipe", "pipe"] : "inherit",
      });
      const stdout: Buffer[] = [];
      const stderr: Buffer[] = [];
      let timeout: ReturnType<typeof setTimeout> | undefined;
      let resolved = false;
      const finish = (result: {
        exitCode: number;
        stdout: string;
        stderr: string;
      }) => {
        if (resolved) return;
        resolved = true;
        if (timeout) clearTimeout(timeout);
        resolve(result);
      };

      if (options.pipeOutput) {
        child.stdout?.on("data", (chunk: Buffer) => stdout.push(chunk));
        child.stderr?.on("data", (chunk: Buffer) => stderr.push(chunk));
      }

      if (options.timeoutMs !== undefined) {
        timeout = setTimeout(() => {
          child.kill();
          finish({
            exitCode: 1,
            stdout: Buffer.concat(stdout).toString("utf8"),
            stderr: [
              Buffer.concat(stderr).toString("utf8"),
              `Command timed out after ${options.timeoutMs}ms: ${command}`,
            ]
              .filter((value) => value.length > 0)
              .join("\n"),
          });
        }, options.timeoutMs);
      }

      child.on("error", (error) =>
        finish({ exitCode: 1, stdout: "", stderr: error.message }),
      );
      child.on("close", (code) =>
        finish({
          exitCode: code ?? 1,
          stdout: Buffer.concat(stdout).toString("utf8"),
          stderr: Buffer.concat(stderr).toString("utf8"),
        }),
      );
    },
  );
}
