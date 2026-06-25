export const advisorChoices = [
  "claude",
  "codex",
  "opencode",
  "grok",
  "pi",
  "droid",
  "amp",
  "kimi",
] as const;

export const ampModes = ["deep", "rush", "smart"] as const;
export const ampThinking = [
  "none",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
] as const;
export const claudeModels = ["haiku", "sonnet", "opus"] as const;
export const claudeThinking = [
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
] as const;
export const codexThinking = ["low", "medium", "high", "xhigh"] as const;
export const piThinking = [
  "off",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
] as const;

export type Advisor = (typeof advisorChoices)[number];
export type CommandSpec = { command: string; args: string[] };
type ConfigBase<T extends Advisor> = { advisor: T; model: string };
type ConfigWithThinking<T extends Advisor, U extends string> = ConfigBase<T> & {
  thinking: U;
};

export type Config =
  | (ConfigWithThinking<"claude", (typeof claudeThinking)[number]> & {
      model: (typeof claudeModels)[number];
    })
  | ConfigWithThinking<"codex", (typeof codexThinking)[number]>
  | ConfigWithThinking<"opencode", string>
  | ConfigWithThinking<"grok", string>
  | ConfigWithThinking<"pi", (typeof piThinking)[number]>
  | ConfigWithThinking<"droid", string>
  | {
      advisor: "amp";
      model: (typeof ampModes)[number];
      thinking: (typeof ampThinking)[number];
    }
  | ConfigBase<"kimi">;

export function getModelListCommand(advisor: Advisor): CommandSpec | null {
  if (advisor === "codex")
    return { command: "codex", args: ["debug", "models", "--bundled"] };
  if (advisor === "opencode") return { command: "opencode", args: ["models"] };
  if (advisor === "grok") return { command: "grok", args: ["models"] };
  if (advisor === "pi") return { command: "pi", args: ["--list-models"] };
  if (advisor === "droid")
    return { command: "droid", args: ["exec", "--help"] };
  if (advisor === "kimi")
    return { command: "kimi", args: ["provider", "list", "--json"] };
  return null;
}

export function buildAdvisorCommand(
  config: Config,
  prompt: string,
): CommandSpec {
  if (config.advisor === "claude") {
    return {
      command: "claude",
      args: [
        "--model",
        config.model,
        "--effort",
        config.thinking,
        "-p",
        prompt,
      ],
    };
  }

  if (config.advisor === "codex") {
    return {
      command: "codex",
      args: [
        "exec",
        "-m",
        config.model,
        "--config",
        `model_reasoning_effort=${config.thinking}`,
        prompt,
      ],
    };
  }

  if (config.advisor === "opencode") {
    return {
      command: "opencode",
      args: ["run", "-m", config.model, "--variant", config.thinking, prompt],
    };
  }

  if (config.advisor === "grok") {
    return {
      command: "grok",
      args: [
        "-m",
        config.model,
        "--reasoning-effort",
        config.thinking,
        "-p",
        prompt,
      ],
    };
  }

  if (config.advisor === "pi") {
    return {
      command: "pi",
      args: [
        "--model",
        config.model,
        "--thinking",
        config.thinking,
        "-p",
        prompt,
      ],
    };
  }

  if (config.advisor === "droid") {
    return {
      command: "droid",
      args: [
        "exec",
        "-m",
        config.model,
        "--reasoning-effort",
        config.thinking,
        prompt,
      ],
    };
  }

  if (config.advisor === "amp") {
    return {
      command: "amp",
      args: [
        "--mode",
        config.model,
        "--effort",
        config.thinking,
        "--execute",
        prompt,
      ],
    };
  }

  return { command: "kimi", args: ["-m", config.model, "-p", prompt] };
}

export function summarizeConfig(config: Config) {
  if (config.advisor === "amp") {
    return `advisor amp, mode ${config.model}, thinking ${config.thinking}`;
  }
  if (config.advisor === "kimi") return `advisor kimi, model ${config.model}`;
  return `advisor ${config.advisor}, model ${config.model}, thinking ${config.thinking}`;
}

export function getThinkingOptions(advisor: Exclude<Advisor, "kimi">) {
  if (advisor === "claude") return [...claudeThinking];
  if (advisor === "codex") return [...codexThinking];
  if (advisor === "pi") return [...piThinking];
  if (advisor === "amp") return [...ampThinking];
  return ["low", "medium", "high", "xhigh"];
}

export function isAdvisor(value: unknown): value is Advisor {
  return typeof value === "string" && advisorChoices.includes(value as Advisor);
}
