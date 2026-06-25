import { expect, test } from "bun:test";
import {
  advisorChoices,
  ampThinking,
  buildAdvisorCommand,
  claudeModels,
  getModelListCommand,
  summarizeConfig,
} from "../src/advisors.js";

test("builds non-interactive commands for every advisor", () => {
  expect(
    buildAdvisorCommand(
      { advisor: "claude", model: "sonnet", thinking: "high" },
      "what do you think?",
    ),
  ).toEqual({
    command: "claude",
    args: ["--model", "sonnet", "--effort", "high", "-p", "what do you think?"],
  });

  expect(
    buildAdvisorCommand(
      { advisor: "codex", model: "gpt-5.2", thinking: "xhigh" },
      "review this",
    ),
  ).toEqual({
    command: "codex",
    args: [
      "exec",
      "-m",
      "gpt-5.2",
      "--config",
      "model_reasoning_effort=xhigh",
      "review this",
    ],
  });

  expect(
    buildAdvisorCommand(
      { advisor: "opencode", model: "github-copilot/gpt-5", thinking: "max" },
      "review this",
    ),
  ).toEqual({
    command: "opencode",
    args: [
      "run",
      "-m",
      "github-copilot/gpt-5",
      "--variant",
      "max",
      "review this",
    ],
  });

  expect(
    buildAdvisorCommand(
      { advisor: "grok", model: "grok-code-fast", thinking: "high" },
      "review this",
    ),
  ).toEqual({
    command: "grok",
    args: [
      "-m",
      "grok-code-fast",
      "--reasoning-effort",
      "high",
      "-p",
      "review this",
    ],
  });

  expect(
    buildAdvisorCommand(
      { advisor: "pi", model: "sonnet", thinking: "minimal" },
      "review this",
    ),
  ).toEqual({
    command: "pi",
    args: ["--model", "sonnet", "--thinking", "minimal", "-p", "review this"],
  });

  expect(
    buildAdvisorCommand(
      { advisor: "droid", model: "claude-opus-4-8", thinking: "medium" },
      "review this",
    ),
  ).toEqual({
    command: "droid",
    args: [
      "exec",
      "-m",
      "claude-opus-4-8",
      "--reasoning-effort",
      "medium",
      "review this",
    ],
  });

  expect(
    buildAdvisorCommand(
      { advisor: "amp", model: "deep", thinking: "high" },
      "review this",
    ),
  ).toEqual({
    command: "amp",
    args: ["--mode", "deep", "--effort", "high", "--execute", "review this"],
  });

  expect(
    buildAdvisorCommand({ advisor: "kimi", model: "kimi-k2" }, "review this"),
  ).toEqual({
    command: "kimi",
    args: ["-m", "kimi-k2", "-p", "review this"],
  });
});

test("declares Claude model aliases", () => {
  expect(claudeModels).toEqual(["haiku", "sonnet", "opus"]);
});

test("declares Amp effort choices", () => {
  expect(ampThinking).toEqual([
    "none",
    "minimal",
    "low",
    "medium",
    "high",
    "xhigh",
    "max",
  ]);
});

test("declares model discovery commands and unsupported advisors", () => {
  expect(getModelListCommand("codex")).toEqual({
    command: "codex",
    args: ["debug", "models", "--bundled"],
  });
  expect(getModelListCommand("pi")).toEqual({
    command: "pi",
    args: ["--list-models"],
  });
  expect(getModelListCommand("opencode")).toEqual({
    command: "opencode",
    args: ["models"],
  });
  expect(getModelListCommand("grok")).toEqual({
    command: "grok",
    args: ["models"],
  });
  expect(getModelListCommand("droid")).toEqual({
    command: "droid",
    args: ["exec", "--help"],
  });
  expect(getModelListCommand("kimi")).toEqual({
    command: "kimi",
    args: ["provider", "list", "--json"],
  });
  expect(getModelListCommand("claude")).toBeNull();
  expect(getModelListCommand("amp")).toBeNull();
});

test("summarizes config for status output", () => {
  expect(
    summarizeConfig({ advisor: "codex", model: "gpt-5.2", thinking: "medium" }),
  ).toContain("codex");
  expect(
    summarizeConfig({ advisor: "amp", model: "rush", thinking: "low" }),
  ).toContain("mode rush");
  expect(advisorChoices).toEqual([
    "claude",
    "codex",
    "opencode",
    "grok",
    "pi",
    "droid",
    "amp",
    "kimi",
  ]);
});
