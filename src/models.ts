import { type Advisor, ampModes, getModelListCommand } from "./advisors.js";
import { runCommand } from "./process.js";

export async function loadModelChoices(advisor: Advisor) {
  if (advisor === "amp") return [...ampModes];
  const command = getModelListCommand(advisor);
  if (!command) return [];

  const result = await runCommand(command.command, command.args, {
    pipeOutput: true,
  });
  if (result.exitCode !== 0) return [];
  return extractModelNames(advisor, result.stdout).slice(0, 80);
}

function extractModelNames(advisor: Advisor, output: string) {
  if (advisor === "codex" || advisor === "kimi")
    return extractStringsFromJson(output);
  if (advisor === "droid") return extractDroidModels(output);
  return output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("Warning:"))
    .map((line) => line.replace(/^[-*]\s*/, ""))
    .filter((line) => line.length > 0);
}

function extractStringsFromJson(output: string) {
  try {
    const seen = new Set<string>();
    collectStrings(JSON.parse(output), seen);
    return [...seen].filter((value) => looksLikeModelName(value));
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

function collectStrings(value: unknown, seen: Set<string>) {
  if (typeof value === "string") {
    seen.add(value);
    return;
  }
  if (Array.isArray(value)) {
    value.map((item) => collectStrings(item, seen));
    return;
  }
  if (!isRecord(value)) return;
  Object.entries(value).forEach(([key, item]) => {
    seen.add(key);
    collectStrings(item, seen);
  });
}

function looksLikeModelName(value: string) {
  return /^[a-z0-9][a-z0-9._:/+-]+$/i.test(value) && value.length < 120;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
