import { expect, test } from "bun:test";
import { chmod, mkdir, mkdtemp, readFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import type { Config } from "../src/advisors.js";
import {
  appTitle,
  formatAdvisorDoctorTable,
  formatAdvisorDoctorVersions,
  formatSetupDiff,
  formatStatus,
  getInstalledAdvisorChoices,
  normalizeVersionOutput,
  runWithLoader,
  secondAdvisorReviewBlock,
  setupSecondAdvisorReview,
} from "../src/ui.js";

async function createCliFixture(
  config: Config,
  executable: string,
  script: string,
) {
  const home = await mkdtemp(path.join(tmpdir(), "second-advisor-home-"));
  const bin = await mkdtemp(path.join(tmpdir(), "second-advisor-bin-"));
  await mkdir(path.join(home, ".config", "second-advisor"), {
    recursive: true,
  });
  await Bun.write(
    path.join(home, ".config", "second-advisor", "config.json"),
    `${JSON.stringify(config)}\n`,
  );
  await Bun.write(path.join(bin, executable), script);
  await chmod(path.join(bin, executable), 0o755);
  return { home, bin };
}

async function runCli(
  args: string[],
  options: { cwd?: string; env?: Record<string, string | undefined> } = {},
) {
  const child = Bun.spawn(
    [
      process.execPath,
      "run",
      path.join(process.cwd(), "src/index.ts"),
      ...args,
    ],
    {
      cwd: options.cwd || process.cwd(),
      env: options.env,
      stderr: "pipe",
      stdout: "pipe",
    },
  );
  return {
    exitCode: await child.exited,
    output: `${await new Response(child.stdout).text()}\n${await new Response(child.stderr).text()}`,
  };
}

function expectSetupUpdated(
  result: Awaited<ReturnType<typeof setupSecondAdvisorReview>>,
  files: string[],
) {
  expect(result.updated.map((update) => update.file)).toEqual(files);
  expect(result.skipped).toEqual([]);
  expect(result.errors).toEqual([]);
}

async function expectFileContent(cwd: string, file: string, content: string) {
  expect(await readFile(path.join(cwd, file), "utf8")).toBe(content);
}

async function expectMalformedSetupPreservesContent(content: string) {
  const cwd = await mkdtemp(path.join(tmpdir(), "second-advisor-setup-"));
  await Bun.write(path.join(cwd, "AGENTS.md"), content);

  const result = await setupSecondAdvisorReview(cwd);

  expect(result.updated).toEqual([]);
  expect(result.skipped).toEqual([]);
  expect(result.errors).toEqual([
    {
      file: "AGENTS.md",
      message: "Malformed second-advisor managed block markers.",
    },
  ]);
  await expectFileContent(cwd, "AGENTS.md", content);
}

async function runDoctorWithAmpFixture(
  extraCommands: Record<string, string> = {},
  args = ["doctor"],
) {
  const fixture = await createCliFixture(
    { advisor: "amp", model: "deep", thinking: "max" },
    "amp",
    "#!/bin/sh\necho amp 1.0.0\n",
  );

  await Promise.all(
    Object.entries(extraCommands).map(async (command) => {
      await Bun.write(path.join(fixture.bin, command[0]), command[1]);
      await chmod(path.join(fixture.bin, command[0]), 0o755);
    }),
  );

  return runCli(args, {
    env: {
      ...process.env,
      HOME: fixture.home,
      PATH: fixture.bin,
    },
  });
}

test("filters coding CLI choices to installed advisors", () => {
  expect(
    getInstalledAdvisorChoices((advisor) =>
      ["codex", "amp"].includes(advisor) ? `/bin/${advisor}` : undefined,
    ),
  ).toEqual(["codex", "amp"]);
});

test("uses a human-readable app title", () => {
  expect(appTitle).toBe("Second Advisor");
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

test("uses table doctor output when it fits the terminal", () => {
  const rows = [
    {
      cli: "codex",
      installed: true,
      path: "/usr/local/bin/codex",
      version: "codex-cli 1.2.3",
    },
  ];

  expect(formatAdvisorDoctorVersions(rows, 120)).toBe(
    formatAdvisorDoctorTable(rows),
  );
});

test("uses compact doctor output when the table would wrap", () => {
  expect(
    formatAdvisorDoctorVersions(
      [
        {
          cli: "second-advisor",
          installed: true,
          path: path.join(
            homedir(),
            ".nvm",
            "versions",
            "node",
            "v24.16.0",
            "bin",
            "second-advisor",
          ),
          version: "version check failed",
        },
        {
          cli: "claude",
          installed: false,
          path: "-",
          version: "not installed",
        },
      ],
      60,
    ),
  ).toBe(`second-advisor  yes  version check failed
  path: ~/.nvm/versions/node/v24.16.0/bin/second-advisor

claude          no   not installed
  path: -`);
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

test("formats current setup as labelled rows", () => {
  expect(
    formatStatus(
      { advisor: "pi", model: "glm-5.2", thinking: "high" },
      path.join(homedir(), ".local", "bin", "pi"),
    ),
  ).toBe(`Current setup
  Coding CLI pi
  Model      glm-5.2
  Thinking   high
  Config     ~/.config/second-advisor/config.json
  Executable ~/.local/bin/pi`);
});

test("formats legacy Pi model table rows as readable metadata", () => {
  expect(
    formatStatus(
      {
        advisor: "pi",
        model:
          "zai                    glm-5.2                             1M       128K     yes       no",
        thinking: "high",
      },
      "/opt/homebrew/bin/pi",
    ),
  ).toBe(`Current setup
  Coding CLI pi
  Model      zai / glm-5.2
  Context    1M input / 128K output
  Thinking   yes, high
  Config     ~/.config/second-advisor/config.json
  Executable /opt/homebrew/bin/pi`);
});

test("formats Kimi setup without thinking row", () => {
  expect(
    formatStatus({ advisor: "kimi", model: "kimi-k2" }, undefined),
  ).toBe(`Current setup
  Coding CLI kimi
  Model      kimi-k2
  Config     ~/.config/second-advisor/config.json
  Executable not found on PATH`);
});

test("doctor output omits redundant configured CLI success lines", async () => {
  const result = await runDoctorWithAmpFixture();

  expect(result.exitCode).toBe(0);
  expect(result.output).toContain("Doctor passed.");
  expect(result.output).not.toContain("Executable found:");
  expect(result.output).not.toContain("version check OK.");
});

test("doctor output includes installed second-advisor version", async () => {
  const result = await runDoctorWithAmpFixture({
    "second-advisor": "#!/bin/sh\necho second-advisor 9.9.9\n",
  });

  expect(result.exitCode).toBe(0);
  expect(result.output).toContain("second-advisor");
  expect(result.output).toContain("second-advisor 9.9.9");
});

test("doctor can output json for debugging", async () => {
  const result = await runDoctorWithAmpFixture(
    { "second-advisor": "#!/bin/sh\necho second-advisor 9.9.9\n" },
    ["doctor", "--json"],
  );
  const output = JSON.parse(result.output.trim());

  expect(result.exitCode).toBe(0);
  expect(output.ok).toBe(true);
  expect(output.config).toEqual({
    path: "~/.config/second-advisor/config.json",
    present: true,
    summary: "advisor amp, mode deep, thinking max",
    value: { advisor: "amp", model: "deep", thinking: "max" },
  });
  expect(output.errors).toEqual([]);
  expect(output.checks).toContainEqual({
    cli: "second-advisor",
    installed: true,
    path: expect.stringContaining("second-advisor"),
    version: "second-advisor 9.9.9",
  });
});

test("prints compact runtime identity", async () => {
  const fixture = await createCliFixture(
    { advisor: "amp", model: "deep", thinking: "max" },
    "amp",
    "#!/bin/sh\necho amp 1.0.0\n",
  );

  const result = await runCli(["--version"], {
    env: {
      ...process.env,
      HOME: fixture.home,
      PATH: fixture.bin,
    },
  });

  expect(result.exitCode).toBe(0);
  expect(
    result.output.trim(),
  ).toBe(`second-advisor ${JSON.parse(await Bun.file("package.json").text()).version}
runtime bun ${Bun.version}
runtime node ${process.version}
config ~/.config/second-advisor/config.json
advisor amp
advisor version amp 1.0.0`);
});

test("debug prompt output includes the advisor command", async () => {
  const fixture = await createCliFixture(
    { advisor: "amp", model: "rush", thinking: "low" },
    "amp",
    "#!/bin/sh\necho advisor ran\n",
  );

  const result = await runCli(["say hi", "--debug"], {
    env: {
      ...process.env,
      HOME: fixture.home,
      PATH: fixture.bin,
    },
  });

  expect(result.exitCode).toBe(0);
  expect(result.output).toContain(
    "amp --mode rush --effort low --execute 'say hi'",
  );
  expect(result.output).toContain("advisor ran");
});

test("second advisor review instructions wait for long-running reviews", () => {
  expect(secondAdvisorReviewBlock).toContain("<!-- second-advisor:start -->");
  expect(secondAdvisorReviewBlock).toContain(
    "Wait for the second-advisor command to finish as long as it is still running without crashing or outputting an error, even if it produces no output for a long time.",
  );
  expect(secondAdvisorReviewBlock).toContain("<!-- second-advisor:end -->");
  expect(secondAdvisorReviewBlock).not.toContain("blocking forever");
});

test("setup appends second advisor review instructions to AGENTS.md", async () => {
  const cwd = await mkdtemp(path.join(tmpdir(), "second-advisor-setup-"));
  await Bun.write(path.join(cwd, "AGENTS.md"), "# Instructions\n");

  const result = await setupSecondAdvisorReview(cwd);

  expectSetupUpdated(result, ["AGENTS.md"]);
  expect(result.updated[0]?.diff).toContain("@@ -1,1 +1,19 @@");
  expect(result.updated[0]?.diff).toContain("+<!-- second-advisor:start -->");
  await expectFileContent(
    cwd,
    "AGENTS.md",
    `# Instructions\n\n${secondAdvisorReviewBlock}\n`,
  );
});

test("setup appends second advisor review instructions to CLAUDE.md", async () => {
  const cwd = await mkdtemp(path.join(tmpdir(), "second-advisor-setup-"));
  await Bun.write(path.join(cwd, "CLAUDE.md"), "# Instructions\n");

  const result = await setupSecondAdvisorReview(cwd);

  expectSetupUpdated(result, ["CLAUDE.md"]);
  await expectFileContent(
    cwd,
    "CLAUDE.md",
    `# Instructions\n\n${secondAdvisorReviewBlock}\n`,
  );
});

test("setup appends to both supported agent instruction files", async () => {
  const cwd = await mkdtemp(path.join(tmpdir(), "second-advisor-setup-"));
  await Bun.write(path.join(cwd, "AGENTS.md"), "# Agents\n");
  await Bun.write(path.join(cwd, "CLAUDE.md"), "# Claude\n");

  const result = await setupSecondAdvisorReview(cwd);

  expectSetupUpdated(result, ["AGENTS.md", "CLAUDE.md"]);
  await expectFileContent(
    cwd,
    "AGENTS.md",
    `# Agents\n\n${secondAdvisorReviewBlock}\n`,
  );
  await expectFileContent(
    cwd,
    "CLAUDE.md",
    `# Claude\n\n${secondAdvisorReviewBlock}\n`,
  );
});

test("setup does not duplicate existing second advisor review instructions", async () => {
  const cwd = await mkdtemp(path.join(tmpdir(), "second-advisor-setup-"));
  await Bun.write(
    path.join(cwd, "AGENTS.md"),
    `# Instructions\n\n${secondAdvisorReviewBlock}\n`,
  );

  const result = await setupSecondAdvisorReview(cwd);

  expect(result).toEqual({ updated: [], skipped: ["AGENTS.md"], errors: [] });
  await expectFileContent(
    cwd,
    "AGENTS.md",
    `# Instructions\n\n${secondAdvisorReviewBlock}\n`,
  );
});

test("setup replaces stale marked second advisor review instructions", async () => {
  const cwd = await mkdtemp(path.join(tmpdir(), "second-advisor-setup-"));
  await Bun.write(
    path.join(cwd, "AGENTS.md"),
    `# Instructions\n\n<!-- second-advisor:start -->\n## Second Advisor Review\n\nold instructions\n<!-- second-advisor:end -->\n\n## Other\nKeep this.\n`,
  );

  const result = await setupSecondAdvisorReview(cwd);

  expectSetupUpdated(result, ["AGENTS.md"]);
  expect(result.updated[0]?.diff).toContain("-old instructions");
  await expectFileContent(
    cwd,
    "AGENTS.md",
    `# Instructions\n\n${secondAdvisorReviewBlock}\n\n## Other\nKeep this.\n`,
  );
});

test("setup does not color returned diffs", async () => {
  const cwd = await mkdtemp(path.join(tmpdir(), "second-advisor-setup-"));
  await Bun.write(
    path.join(cwd, "AGENTS.md"),
    `# Instructions\n\n<!-- second-advisor:start -->\n## Second Advisor Review\n\nold instructions\n<!-- second-advisor:end -->\n`,
  );

  const result = await setupSecondAdvisorReview(cwd);

  expect(result.updated[0]?.diff).toContain("-old instructions");
  expect(result.updated[0]?.diff).not.toContain("\u001b[");
});

test("setup replaces legacy unmarked second advisor review instructions", async () => {
  const cwd = await mkdtemp(path.join(tmpdir(), "second-advisor-setup-"));
  await Bun.write(
    path.join(cwd, "AGENTS.md"),
    `# Instructions\n\n## Second Advisor Review\n\nold instructions\n\n## Other\nKeep this.\n`,
  );

  const result = await setupSecondAdvisorReview(cwd);

  expectSetupUpdated(result, ["AGENTS.md"]);
  await expectFileContent(
    cwd,
    "AGENTS.md",
    `# Instructions\n\n${secondAdvisorReviewBlock}\n\n## Other\nKeep this.\n`,
  );
});

test("setup replaces legacy unmarked second advisor review instructions at EOF", async () => {
  const cwd = await mkdtemp(path.join(tmpdir(), "second-advisor-setup-"));
  await Bun.write(
    path.join(cwd, "AGENTS.md"),
    "# Instructions\n\n## Second Advisor Review\n\nold instructions",
  );

  const result = await setupSecondAdvisorReview(cwd);

  expectSetupUpdated(result, ["AGENTS.md"]);
  await expectFileContent(
    cwd,
    "AGENTS.md",
    `# Instructions\n\n${secondAdvisorReviewBlock}\n`,
  );
});

test("setup does not edit files with malformed second advisor markers", async () => {
  await expectMalformedSetupPreservesContent(
    `# Instructions\n\n<!-- second-advisor:start -->\n## Second Advisor Review\n`,
  );
});

test("setup does not edit files with duplicate second advisor markers", async () => {
  await expectMalformedSetupPreservesContent(
    `${secondAdvisorReviewBlock}\n\n${secondAdvisorReviewBlock}\n`,
  );
});

test("setup does not edit files with second advisor markers out of order", async () => {
  await expectMalformedSetupPreservesContent(
    `# Instructions\n\n<!-- second-advisor:end -->\nold\n<!-- second-advisor:start -->\n`,
  );
});

test("formats setup diffs without color", () => {
  expect(
    formatSetupDiff(
      "AGENTS.md",
      "# Instructions\n\nold\n",
      "# Instructions\n\nnew\n",
      false,
    ),
  ).toBe(`--- AGENTS.md
+++ AGENTS.md
@@ -1,3 +1,3 @@
 # Instructions
 
-old
+new`);
});

test("formats setup diffs with color", () => {
  const diff = formatSetupDiff(
    "AGENTS.md",
    "# Instructions\n\nold\n",
    "# Instructions\n\nnew\n",
    true,
  );

  expect(diff).toContain("\u001b[36m@@ -1,3 +1,3 @@\u001b[0m");
  expect(diff).toContain("\u001b[31m-old\u001b[0m");
  expect(diff).toContain("\u001b[32m+new\u001b[0m");
});

test("setup command reports a unified diff for changed files", async () => {
  const cwd = await mkdtemp(path.join(tmpdir(), "second-advisor-setup-"));
  await Bun.write(
    path.join(cwd, "AGENTS.md"),
    "# Instructions\n\n## Second Advisor Review\n\nold instructions\n",
  );

  const result = await runCli(["setup"], {
    cwd,
    env: { ...process.env, NO_COLOR: "1" },
  });

  expect(result.exitCode).toBe(0);
  expect(result.output).toContain("Updated: AGENTS.md");
  expect(result.output).toContain("--- AGENTS.md");
  expect(result.output).toContain("+++ AGENTS.md");
  expect(result.output).toContain("-old instructions");
  expect(result.output).toContain("+<!-- second-advisor:start -->");
  expect(result.output).not.toContain("\u001b[31m-old instructions");
  expect(result.output).not.toContain(
    "\u001b[32m+<!-- second-advisor:start -->",
  );
});

test("setup command reports malformed marker errors", async () => {
  const cwd = await mkdtemp(path.join(tmpdir(), "second-advisor-setup-"));
  await Bun.write(
    path.join(cwd, "AGENTS.md"),
    "# Instructions\n\n<!-- second-advisor:start -->\n",
  );

  const result = await runCli(["setup"], { cwd });

  expect(result.exitCode).toBe(1);
  expect(result.output).toContain(
    "AGENTS.md: Malformed second-advisor managed block markers.",
  );
});

test("setup exits with an error when no supported instruction file exists", async () => {
  const cwd = await mkdtemp(path.join(tmpdir(), "second-advisor-setup-"));

  await expect(setupSecondAdvisorReview(cwd)).resolves.toEqual({
    updated: [],
    skipped: [],
    errors: [],
  });
});

test("setup command reports an error when no supported instruction file exists", async () => {
  const cwd = await mkdtemp(path.join(tmpdir(), "second-advisor-setup-"));
  const result = await runCli(["setup"], { cwd });

  expect(result.exitCode).toBe(1);
  expect(result.output).toContain(
    "No AGENTS.md or CLAUDE.md found in the current directory.",
  );
});
