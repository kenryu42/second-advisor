import {
  type Advisor,
  ampModes,
  claudeModels,
  getModelListCommand,
} from "./advisors.js";
import { runCommand } from "./process.js";

export async function loadModelChoices(advisor: Advisor) {
  if (advisor === "amp") return [...ampModes];
  if (advisor === "claude") return [...claudeModels];
  const command = getModelListCommand(advisor);
  if (!command) return [];

  const result = await runCommand(command.command, command.args, {
    pipeOutput: true,
  });
  if (result.exitCode !== 0) return [];
  return parseModelChoices(advisor, result.stdout).slice(0, 80);
}

export function parseModelChoices(advisor: Advisor, output: string) {
  if (advisor === "codex") return extractCodexModels(output);
  if (advisor === "grok") return extractGrokModels(output);
  if (advisor === "kimi") return extractKimiModels(output);
  if (advisor === "droid") return extractDroidModels(output);
  if (advisor === "pi") return extractPiModels(output);
  return output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("Warning:"))
    .map((line) => line.replace(/^[-*]\s*/, ""))
    .filter((line) => line.length > 0);
}

function extractKimiModels(output: string) {
  try {
    const json = JSON.parse(output);
    if (!isRecord(json) || !isRecord(json.models)) return [];
    return Object.keys(json.models).filter((model) => model.length > 0);
  } catch {
    return [];
  }
}

function extractGrokModels(output: string) {
  const models = output.match(/Available models:\n(?<body>[\s\S]*)/)?.groups
    ?.body;
  if (!models) return [];
  return models
    .split(/\r?\n/)
    .map((line) =>
      line
        .trim()
        .replace(/^[-*]\s*/, "")
        .replace(/\s+\(default\)$/, ""),
    )
    .filter((value) => value.length > 0);
}

function extractCodexModels(output: string) {
  try {
    const json = JSON.parse(output);
    if (!isRecord(json) || !Array.isArray(json.models)) return [];
    return json.models
      .map((model) => (isRecord(model) ? model.slug : undefined))
      .filter(
        (slug): slug is string => typeof slug === "string" && slug.length > 0,
      );
  } catch {
    return [];
  }
}

function extractDroidModels(output: string) {
  const models = output.match(
    /Available Models:\n(?<body>[\s\S]*?)\n\nModel details:/,
  )?.groups?.body;
  if (!models) return [];
  return models
    .split(/\r?\n/)
    .map((line) => line.trim().split(/\s+/)[0])
    .filter((value) => value.length > 0);
}

function extractPiModels(output: string) {
  return output
    .split(/\r?\n/)
    .map(formatPiModelTableChoice)
    .filter(
      (value): value is string =>
        value !== undefined && value !== "provider/model",
    );
}

function formatPiModelTableChoice(line: string) {
  const cells = line.trim().split(/\s{2,}/);
  if (cells.length < 2 || cells[0] === "provider" || /^-+$/.test(cells[0])) {
    return undefined;
  }
  return `${cells[0]}/${cells[1]}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
