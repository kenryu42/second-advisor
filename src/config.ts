import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import {
  ampModes,
  ampThinking,
  type Config,
  claudeThinking,
  codexThinking,
  isAdvisor,
  piThinking,
} from "./advisors.js";

export const configPath = path.join(
  homedir(),
  ".config",
  "second-advisor",
  "config.json",
);

export function parseConfig(value: unknown): Config {
  if (!isRecord(value)) throw new Error("Config must be an object");
  if (!isAdvisor(value.advisor)) throw new Error("Invalid advisor");
  if (typeof value.model !== "string" || value.model.length === 0) {
    throw new Error("Config model must be a non-empty string");
  }

  if (value.advisor === "kimi") {
    if ("thinking" in value) throw new Error("Kimi does not support thinking");
    return { advisor: value.advisor, model: value.model };
  }

  if (typeof value.thinking !== "string" || value.thinking.length === 0) {
    throw new Error("Config thinking must be a non-empty string");
  }

  if (value.advisor === "amp") {
    if (!ampModes.includes(value.model as (typeof ampModes)[number])) {
      throw new Error("Invalid Amp mode");
    }
    if (!ampThinking.includes(value.thinking as (typeof ampThinking)[number])) {
      throw new Error("Invalid Amp thinking");
    }
    return {
      advisor: value.advisor,
      model: value.model as (typeof ampModes)[number],
      thinking: value.thinking as (typeof ampThinking)[number],
    };
  }

  if (value.advisor === "claude") {
    if (
      !claudeThinking.includes(
        value.thinking as (typeof claudeThinking)[number],
      )
    ) {
      throw new Error("Invalid Claude thinking");
    }
    return {
      advisor: value.advisor,
      model: value.model,
      thinking: value.thinking as (typeof claudeThinking)[number],
    };
  }

  if (value.advisor === "codex") {
    if (
      !codexThinking.includes(value.thinking as (typeof codexThinking)[number])
    ) {
      throw new Error("Invalid Codex thinking");
    }
    return {
      advisor: value.advisor,
      model: value.model,
      thinking: value.thinking as (typeof codexThinking)[number],
    };
  }

  if (value.advisor === "pi") {
    if (!piThinking.includes(value.thinking as (typeof piThinking)[number])) {
      throw new Error("Invalid Pi thinking");
    }
    return {
      advisor: value.advisor,
      model: value.model,
      thinking: value.thinking as (typeof piThinking)[number],
    };
  }

  return {
    advisor: value.advisor,
    model: value.model,
    thinking: value.thinking,
  };
}

export async function readConfigIfPresent() {
  if (!existsSync(configPath)) return undefined;
  return parseConfig(JSON.parse(await readFile(configPath, "utf8")));
}

export async function writeConfig(config: Config) {
  await mkdir(path.dirname(configPath), { recursive: true });
  await writeFile(configPath, `${JSON.stringify(config, undefined, 2)}\n`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
