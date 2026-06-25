import { expect, test } from "bun:test";
import { chmod, mkdir, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  formatAdvisorDoctorTable,
  getInstalledAdvisorChoices,
  normalizeVersionOutput,
  runWithLoader,
} from "../src/ui.js";

test("filters coding CLI choices to installed advisors", () => {
  expect(
    getInstalledAdvisorChoices((advisor) =>
      ["codex", "amp"].includes(advisor) ? `/bin/${advisor}` : undefined,
    ),
  ).toEqual(["codex", "amp"]);
});

test("returns no coding CLI choices when supported advisors are not installed", () => {
  expect(getInstalledAdvisorChoices(() => undefined)).toEqual([]);
});

test("formats coding CLI versions for doctor output", () => {
  expect(
    formatAdvisorDoctorTable([
      {
        cli: "claude",
        installed: false,
        path: "-",
        version: "not installed",
      },
      {
        cli: "codex",
        installed: true,
        path: "/usr/local/bin/codex",
        version: "codex-cli 1.2.3",
      },
      {
        cli: "opencode",
        installed: true,
        path: "/opt/bin/opencode",
        version: "version check failed",
      },
    ]),
  ).toEqual(`┌──────────┬───────────┬──────────────────────┬──────────────────────┐
│ CLI      │ Installed │ Version              │ Path                 │
├──────────┼───────────┼──────────────────────┼──────────────────────┤
│ claude   │ no        │ not installed        │ -                    │
│ codex    │ yes       │ codex-cli 1.2.3      │ /usr/local/bin/codex │
│ opencode │ yes       │ version check failed │ /opt/bin/opencode    │
└──────────┴───────────┴──────────────────────┴──────────────────────┘`);
});

test("normalizes version command output", () => {
  expect(normalizeVersionOutput("codex-cli 1.2.3\nmore detail", "")).toBe(
    "codex-cli 1.2.3",
  );
  expect(normalizeVersionOutput("", "warning\namp 0.4.0")).toBe("warning");
  expect(normalizeVersionOutput("", "")).toBe("version unavailable");
});

test("runs doctor work with a loader indicator", async () => {
  const events: string[] = [];
  const result = await runWithLoader(
    {
      start: (message) => events.push(`start:${message}`),
      stop: (message) => events.push(`stop:${message}`),
    },
    "Checking coding CLI versions",
    "Checked coding CLI versions",
    async () => "done",
  );

  expect(result).toBe("done");
  expect(events).toEqual([
    "start:Checking coding CLI versions",
    "stop:Checked coding CLI versions",
  ]);
});

test("doctor output omits redundant configured CLI success lines", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "second-advisor-home-"));
  const bin = await mkdtemp(path.join(tmpdir(), "second-advisor-bin-"));
  await mkdir(path.join(home, ".config", "second-advisor"), {
    recursive: true,
  });
  await Bun.write(
    path.join(home, ".config", "second-advisor", "config.json"),
    `${JSON.stringify({ advisor: "amp", model: "deep", thinking: "max" })}\n`,
  );
  await Bun.write(path.join(bin, "amp"), "#!/bin/sh\necho amp 1.0.0\n");
  await chmod(path.join(bin, "amp"), 0o755);

  const child = Bun.spawn([process.execPath, "run", "src/index.ts", "doctor"], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      HOME: home,
      PATH: bin,
    },
    stderr: "pipe",
    stdout: "pipe",
  });
  const output = `${await new Response(child.stdout).text()}\n${await new Response(child.stderr).text()}`;

  expect(await child.exited).toBe(0);
  expect(output).toContain("Doctor passed.");
  expect(output).not.toContain("Executable found:");
  expect(output).not.toContain("version check OK.");
});
