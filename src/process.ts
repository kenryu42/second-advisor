import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import type { Advisor } from "./advisors.js";

export function resolveExecutable(command: string) {
  const pathValue = process.env.PATH || "";
  return pathValue
    .split(path.delimiter)
    .map((directory) => path.join(directory, command))
    .find((candidate) => existsSync(candidate));
}

export function getHelpArgs(advisor: Advisor) {
  if (advisor === "amp") return ["--version"];
  return ["--help"];
}

export function runCommand(
  command: string,
  args: string[],
  options: { pipeOutput: boolean },
) {
  return new Promise<{ exitCode: number; stdout: string; stderr: string }>(
    (resolve) => {
      const child = spawn(command, args, {
        stdio: options.pipeOutput ? ["ignore", "pipe", "pipe"] : "inherit",
      });
      const stdout: Buffer[] = [];
      const stderr: Buffer[] = [];

      if (options.pipeOutput) {
        child.stdout?.on("data", (chunk: Buffer) => stdout.push(chunk));
        child.stderr?.on("data", (chunk: Buffer) => stderr.push(chunk));
      }

      child.on("error", (error) =>
        resolve({ exitCode: 1, stdout: "", stderr: error.message }),
      );
      child.on("close", (code) =>
        resolve({
          exitCode: code || 0,
          stdout: Buffer.concat(stdout).toString("utf8"),
          stderr: Buffer.concat(stderr).toString("utf8"),
        }),
      );
    },
  );
}
