import { expect, test } from "bun:test";
import { runCommand } from "../src/process.js";

test("returns a failure when a command times out", async () => {
  const result = await runCommand("sh", ["-c", "sleep 1"], {
    pipeOutput: true,
    timeoutMs: 20,
  });

  expect(result.exitCode).not.toBe(0);
  expect(result.stderr).toContain("timed out");
});

test("returns stdout when a command finishes before the timeout", async () => {
  const result = await runCommand("sh", ["-c", "printf ready"], {
    pipeOutput: true,
    timeoutMs: 1_000,
  });

  expect(result.exitCode).toBe(0);
  expect(result.stdout).toBe("ready");
});
