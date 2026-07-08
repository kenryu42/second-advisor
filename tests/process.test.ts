import { expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
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

test("kills an unresponsive command when it times out", async () => {
  const marker = path.join(
    await mkdtemp(path.join(tmpdir(), "second-advisor-timeout-")),
    "alive",
  );

  const result = await runCommand(
    "sh",
    ["-c", `trap '' TERM; sleep 0.1; printf alive > ${marker}`],
    {
      pipeOutput: true,
      timeoutMs: 20,
    },
  );
  await Bun.sleep(150);

  expect(result.exitCode).not.toBe(0);
  expect(result.stderr).toContain("timed out");
  expect(existsSync(marker)).toBe(false);
});
