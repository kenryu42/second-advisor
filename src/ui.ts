import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import {
  cancel,
  intro,
  isCancel,
  log,
  outro,
  select,
  spinner,
  text,
} from "@clack/prompts";
import {
  type Advisor,
  advisorChoices,
  ampModes,
  buildAdvisorCommand,
  type Config,
  claudeModels,
  getModelListCommand,
  getThinkingOptions,
  isAdvisor,
  parsePiModelTableRow,
  summarizeConfig,
} from "./advisors.js";
import {
  configPath,
  parseConfig,
  readConfigIfPresent,
  writeConfig,
} from "./config.js";
import { loadModelChoices } from "./models.js";
import { readPackageVersion } from "./package.js";
import { getVersionArgs, resolveExecutable, runCommand } from "./process.js";

type AdvisorDoctorCheck = {
  cli: string;
  installed: boolean;
  path: string;
  version: string;
};

type Loader = {
  start: (message: string) => void;
  stop: (message: string) => void;
};

export const appTitle = "Second Advisor";

const secondAdvisorStartMarker = "<!-- second-advisor:start -->";
const secondAdvisorEndMarker = "<!-- second-advisor:end -->";

const secondAdvisorReviewContent = `## Second Advisor Review

After completing substantial work, especially code changes, skill changes, CLI behavior changes, or agent workflow changes, ask for a second opinion before the final response.

Use:

second-advisor "<review prompt>"

The second opinion must be read and considered. Wait for the second-advisor command to finish as long as it is still running without crashing or outputting an error, even if it produces no output for a long time. Run at most one second-advisor review per task. If it finds valid high-priority issues, fix them and rerun relevant tests, but do not run second-advisor again unless the user explicitly asks or the fix substantially changes the design beyond the reviewed scope. If the second-advisor command crashes or outputs an error, report that clearly.

Do not run second-advisor for:
- tasks invoked by second-advisor or when you are already responding as the second-advisor reviewer
- Do not run second-advisor if SECOND_ADVISOR=1 is present.
- simple Q&A
- tiny documentation wording changes
- status updates
- tasks where the user explicitly says not to`;

export const secondAdvisorReviewBlock = `${secondAdvisorStartMarker}
${secondAdvisorReviewContent}
${secondAdvisorEndMarker}`;

type TextRange = {
  start: number;
  end: number;
};

type SetupUpdate = {
  file: string;
  diff: string;
};

type SetupError = {
  file: string;
  message: string;
};

type SetupResult = {
  updated: SetupUpdate[];
  skipped: string[];
  errors: SetupError[];
};

type SetupFileResult =
  | { kind: "updated"; oldContent: string; content: string }
  | { kind: "skipped" }
  | { kind: "error"; message: string };

type SetupOptions = {
  remove?: boolean;
};

const agentInstructionFiles = ["AGENTS.md", "CLAUDE.md"] as const;

export async function runWithLoader<T>(
  loader: Loader,
  startMessage: string,
  stopMessage: string,
  work: () => Promise<T>,
) {
  loader.start(startMessage);
  const result = await work();
  loader.stop(stopMessage);
  return result;
}

export function getInstalledAdvisorChoices(
  resolve: (command: string) => string | undefined = resolveExecutable,
) {
  return advisorChoices.filter((advisor) => resolve(advisor));
}

export function normalizeVersionOutput(stdout: string, stderr: string) {
  return (
    `${stdout}\n${stderr}`
      .split("\n")
      .map((line) => line.trim())
      .find((line) => line.length > 0) || "version unavailable"
  );
}

export function formatAdvisorDoctorTable(rows: AdvisorDoctorCheck[]) {
  const widths = {
    cli: Math.max("CLI".length, ...rows.map((row) => row.cli.length)),
    installed: "Installed".length,
    version: Math.max(
      "Version".length,
      ...rows.map((row) => row.version.length),
    ),
    path: Math.max("Path".length, ...rows.map((row) => row.path.length)),
  };
  const headers = {
    cli: "CLI",
    installed: "Installed",
    version: "Version",
    path: "Path",
  };
  const formatRow = (row: {
    cli: string;
    installed: string;
    version: string;
    path: string;
  }) =>
    `│ ${row.cli.padEnd(widths.cli)} │ ${row.installed.padEnd(widths.installed)} │ ${row.version.padEnd(widths.version)} │ ${row.path.padEnd(widths.path)} │`;
  const formatBorder = (left: string, middle: string, right: string) =>
    [
      left,
      "─".repeat(widths.cli + 2),
      middle,
      "─".repeat(widths.installed + 2),
      middle,
      "─".repeat(widths.version + 2),
      middle,
      "─".repeat(widths.path + 2),
      right,
    ].join("");

  return [
    formatBorder("┌", "┬", "┐"),
    formatRow(headers),
    formatBorder("├", "┼", "┤"),
    ...rows.map((row) =>
      formatRow({
        cli: row.cli,
        installed: row.installed ? "yes" : "no",
        version: row.version,
        path: row.path,
      }),
    ),
    formatBorder("└", "┴", "┘"),
  ].join("\n");
}

export function formatAdvisorDoctorVersions(
  rows: AdvisorDoctorCheck[],
  terminalWidth = process.stdout.columns || 80,
) {
  const table = formatAdvisorDoctorTable(rows);
  if (getMaxLineLength(table) <= Math.max(40, terminalWidth - 4)) return table;
  return formatAdvisorDoctorList(rows);
}

function formatAdvisorDoctorList(rows: AdvisorDoctorCheck[]) {
  const cliWidth = Math.max("CLI".length, ...rows.map((row) => row.cli.length));
  return rows
    .map((row) =>
      [
        `${row.cli.padEnd(cliWidth)}  ${row.installed ? "yes" : "no "}  ${row.version}`,
        `  path: ${formatDisplayPath(row.path)}`,
      ].join("\n"),
    )
    .join("\n\n");
}

function getMaxLineLength(value: string) {
  return Math.max(...value.split("\n").map((line) => line.length));
}

async function getAdvisorDoctorChecks(): Promise<AdvisorDoctorCheck[]> {
  return [
    await getDoctorCheck("second-advisor"),
    ...(await Promise.all(
      advisorChoices.map(async (advisor) => {
        return getDoctorCheck(advisor);
      }),
    )),
  ];
}

async function getDoctorCheck(cli: string): Promise<AdvisorDoctorCheck> {
  const executable = resolveExecutable(cli);
  if (!executable) {
    return {
      cli,
      installed: false,
      path: "-",
      version: "not installed",
    };
  }

  const version = await runCommand(cli, getVersionArgs(), {
    pipeOutput: true,
  });
  return {
    cli,
    installed: true,
    path: executable,
    version:
      version.exitCode === 0
        ? normalizeVersionOutput(version.stdout, version.stderr)
        : "version check failed",
  };
}

export async function runMenu() {
  intro(appTitle);
  const config = await readConfigIfPresent();

  if (!config) {
    log.info(`No config found at ${configPath}`);
    const action = await select({
      message: "What would you like to do?",
      options: [
        { value: "init", label: "Initialize second-advisor" },
        { value: "exit", label: "Exit" },
      ],
    });
    if (isCancel(action) || action === "exit") return endCancelled();
    await runInit();
    return;
  }

  log.message(formatStatus(config, resolveExecutable(config.advisor)));
  const action = await select({
    message: "What would you like to change?",
    options: [
      {
        value: "advisor",
        label: "Coding CLI",
        hint: "Change the executable/tool used for coding",
      },
      {
        value: "model",
        label: config.advisor === "amp" ? "Mode" : "Model",
        hint:
          config.advisor === "amp" ? "Pick an Amp mode" : "Pick provider model",
      },
      {
        value: "thinking",
        label: "Thinking effort",
        hint: "Toggle thinking and effort level",
      },
      {
        value: "models",
        label: "Models/modes",
        hint: "View available options",
      },
      { value: "doctor", label: "Doctor", hint: "Check config and executable" },
      { value: "exit", label: "Exit" },
    ],
  });

  if (isCancel(action) || action === "exit") return endCancelled();
  if (action === "advisor") {
    await writeConfig(await promptForConfig());
    outro("Updated setup.");
    return;
  }
  if (action === "model") {
    await writeConfig(await promptForModel(config));
    outro("Updated setup.");
    return;
  }
  if (action === "thinking") {
    await writeConfig(await promptForThinking(config));
    outro("Updated setup.");
    return;
  }
  if (action === "models") {
    await runModels(config.advisor);
    return;
  }
  await runDoctor();
}

export async function runInit() {
  intro(`${appTitle} init`);
  await writeConfig(await promptForConfig());
  outro(`${appTitle} is configured.`);
}

export async function runStatus() {
  const config = await readConfigIfPresent();
  if (!config) {
    log.info(`No config found at ${configPath}. Run second-advisor init.`);
    return;
  }
  log.message(formatStatus(config, resolveExecutable(config.advisor)));
}

export async function runModels(input?: string) {
  const advisor = input
    ? parseAdvisorInput(input)
    : (await readConfigIfPresent())?.advisor;
  if (!advisor) {
    log.info(
      "No advisor configured. Run second-advisor init or pass an advisor name.",
    );
    return;
  }

  if (advisor === "amp") {
    log.message(
      `Available Amp modes:\n${ampModes.map((mode) => `- ${mode}`).join("\n")}`,
    );
    return;
  }
  if (advisor === "claude") {
    log.message(
      `Available Claude models:\n${claudeModels.map((model) => `- ${model}`).join("\n")}`,
    );
    return;
  }

  if (!getModelListCommand(advisor)) {
    log.info(
      `${advisor} does not expose a reliable model-list command. Enter the model manually.`,
    );
    return;
  }

  const choices = await loadModelChoices(advisor);
  if (choices.length === 0) {
    log.error(`Failed to list models with ${advisor}.`);
    return;
  }
  log.message(choices.map((choice) => `- ${choice}`).join("\n"));
}

export async function runSetup(
  cwd = process.cwd(),
  options: SetupOptions = {},
) {
  const result = await setupSecondAdvisorReview(cwd, options);
  if (
    result.updated.length === 0 &&
    result.skipped.length === 0 &&
    result.errors.length === 0
  ) {
    console.error("No AGENTS.md or CLAUDE.md found in the current directory.");
    process.exitCode = 1;
    return;
  }

  result.skipped.forEach((file) => {
    log.info(
      options.remove
        ? `Nothing to remove: ${file}`
        : `Already configured: ${file}`,
    );
  });
  result.updated.forEach((update) => {
    log.success(`Updated: ${update.file}`);
    console.log(colorSetupDiff(update.diff));
  });
  result.errors.forEach((error) => {
    log.error(`${error.file}: ${error.message}`);
  });
  if (result.errors.length > 0) process.exitCode = 1;
}

export async function runVersion() {
  console.log(await formatVersionIdentity());
}

async function formatVersionIdentity() {
  const config = await readConfigIfPresent();
  const executable = config ? resolveExecutable(config.advisor) : undefined;
  const advisorVersion =
    config && executable
      ? await getCliVersion(config.advisor)
      : config
        ? "not found on PATH"
        : "not configured";

  return [
    `second-advisor ${readPackageVersion()}`,
    `runtime bun ${Bun.version}`,
    `runtime node ${process.version}`,
    `config ${formatDisplayPath(configPath)}`,
    `advisor ${config?.advisor || "not configured"}`,
    `advisor version ${advisorVersion}`,
  ].join("\n");
}

async function getCliVersion(cli: string) {
  const version = await runCommand(cli, getVersionArgs(), {
    pipeOutput: true,
  });
  if (version.exitCode !== 0) return "version check failed";
  return normalizeVersionOutput(version.stdout, version.stderr);
}

export async function setupSecondAdvisorReview(
  cwd = process.cwd(),
  options: SetupOptions = {},
): Promise<SetupResult> {
  const files = agentInstructionFiles
    .map((file) => path.join(cwd, file))
    .filter((file) => existsSync(file));

  const changes = await Promise.all(
    files.map(async (file) => ({
      file: path.basename(file),
      result: await setupSecondAdvisorReviewFile(file, options),
    })),
  );

  return {
    updated: changes
      .filter((change) => change.result.kind === "updated")
      .map((change) => ({
        file: change.file,
        diff:
          change.result.kind === "updated"
            ? formatSetupDiff(
                change.file,
                change.result.oldContent,
                change.result.content,
                false,
              )
            : "",
      })),
    skipped: changes
      .filter((change) => change.result.kind === "skipped")
      .map((change) => change.file),
    errors: changes
      .filter((change) => change.result.kind === "error")
      .map((change) => ({
        file: change.file,
        message: change.result.kind === "error" ? change.result.message : "",
      })),
  };
}

export async function runDoctor(options = { json: false }) {
  if (options.json) {
    const advisorChecks = await getAdvisorDoctorChecks();
    console.log(
      JSON.stringify(
        formatDoctorJson(advisorChecks, await readConfigIfPresent()),
        null,
        2,
      ),
    );
    return;
  }

  intro(`${appTitle} doctor`);
  const advisorChecks = await runWithLoader(
    spinner(),
    "Checking coding CLI versions",
    "Checked coding CLI versions",
    getAdvisorDoctorChecks,
  );
  log.message(
    `Coding CLI versions:\n${formatAdvisorDoctorVersions(advisorChecks)}`,
  );
  const config = await readConfigIfPresent();

  if (!config) {
    log.error(`Config missing: ${configPath}`);
    outro("Run second-advisor init.");
    return;
  }

  log.success(`Config OK: ${summarizeConfig(config)}`);
  const advisorCheck = advisorChecks.find(
    (check) => check.cli === config.advisor,
  );

  if (!advisorCheck?.installed) {
    log.error(`Executable not found on PATH: ${config.advisor}`);
    outro("Doctor failed.");
    return;
  }

  if (advisorCheck.version === "version check failed") {
    log.error(`${config.advisor} version check failed.`);
    outro("Doctor failed.");
    return;
  }

  if (config.advisor === "amp" && !ampModes.includes(config.model)) {
    log.error(`Invalid Amp mode: ${config.model}`);
    outro("Doctor failed.");
    return;
  }

  outro("Doctor passed.");
}

function formatDoctorJson(
  checks: AdvisorDoctorCheck[],
  config: Config | undefined,
) {
  const errors = getDoctorErrors(checks, config);
  return {
    ok: errors.length === 0,
    config: config
      ? {
          path: formatDisplayPath(configPath),
          present: true,
          summary: summarizeConfig(config),
          value: config,
        }
      : {
          path: formatDisplayPath(configPath),
          present: false,
        },
    checks,
    errors,
  };
}

function getDoctorErrors(
  checks: AdvisorDoctorCheck[],
  config: Config | undefined,
) {
  if (!config) return [`Config missing: ${formatDisplayPath(configPath)}`];

  const advisorCheck = checks.find((check) => check.cli === config.advisor);
  if (!advisorCheck?.installed) {
    return [`Executable not found on PATH: ${config.advisor}`];
  }

  if (advisorCheck.version === "version check failed") {
    return [`${config.advisor} version check failed.`];
  }

  if (config.advisor === "amp" && !ampModes.includes(config.model)) {
    return [`Invalid Amp mode: ${config.model}`];
  }

  return [];
}

export async function runPrompt(prompt: string, options = { debug: false }) {
  const config = await readConfigIfPresent();
  if (!config) {
    console.error(
      `second-advisor is not initialized. Run: second-advisor init`,
    );
    process.exitCode = 1;
    return;
  }

  const advisorCommand = buildAdvisorCommand(config, prompt);
  if (options.debug) {
    console.error(formatCommand(advisorCommand.command, advisorCommand.args));
  }
  const result = await runCommand(advisorCommand.command, advisorCommand.args, {
    env: { ...process.env, SECOND_ADVISOR: "1" },
    pipeOutput: false,
  });
  process.exitCode = result.exitCode;
}

function formatCommand(command: string, args: string[]) {
  return [command, ...args].map(formatCommandPart).join(" ");
}

function formatCommandPart(value: string) {
  if (/^[A-Za-z0-9_/:=.,@%+-]+$/.test(value)) return value;
  return `'${value.replaceAll("'", "'\\''")}'`;
}

async function setupSecondAdvisorReviewFile(
  file: string,
  options: SetupOptions,
) {
  const content = await readFile(file, "utf8");
  const result = options.remove
    ? removeSecondAdvisorReviewBlock(content)
    : applySecondAdvisorReviewBlock(content);
  if (result.kind !== "updated") return result;
  await writeFile(file, result.content);
  return result;
}

function appendReviewBlock(content: string) {
  const separator =
    content.length === 0
      ? ""
      : content.endsWith("\n\n")
        ? ""
        : content.endsWith("\n")
          ? "\n"
          : "\n\n";
  return `${content}${separator}${secondAdvisorReviewBlock}\n`;
}

function applySecondAdvisorReviewBlock(content: string): SetupFileResult {
  return updateSecondAdvisorReviewBlock(
    content,
    replaceSecondAdvisorBlock,
    () => ({
      kind: "updated",
      oldContent: content,
      content: appendReviewBlock(content),
    }),
  );
}

function removeSecondAdvisorReviewBlock(content: string): SetupFileResult {
  const ranges = findRemovableSecondAdvisorBlocks(content);
  if (ranges.length === 0) return { kind: "skipped" };
  return createUpdatedContent(
    content,
    ranges
      .sort((left, right) => right.start - left.start)
      .reduce(
        (updated, range) => removeSecondAdvisorRangeContent(updated, range),
        content,
      ),
  );
}

function updateSecondAdvisorReviewBlock(
  content: string,
  update: (content: string, range: TextRange) => SetupFileResult,
  missing: () => SetupFileResult,
): SetupFileResult {
  const block = findSecondAdvisorBlock(content);
  if (block === "malformed") return malformedSecondAdvisorMarkers();
  if (block) return update(content, block);
  return missing();
}

function createUpdatedContent(
  oldContent: string,
  content: string,
): SetupFileResult {
  return {
    kind: "updated",
    oldContent,
    content,
  };
}

function findSecondAdvisorBlock(content: string) {
  const managedBlock = findManagedBlock(content);
  if (managedBlock) return managedBlock;
  return findLegacySecondAdvisorBlock(content);
}

function malformedSecondAdvisorMarkers() {
  return {
    kind: "error" as const,
    message: "Malformed second-advisor managed block markers.",
  };
}

function replaceSecondAdvisorBlock(content: string, range: TextRange) {
  if (content.slice(range.start, range.end) === secondAdvisorReviewBlock) {
    return { kind: "skipped" as const };
  }

  return createUpdatedContent(
    content,
    `${content.slice(0, range.start)}${secondAdvisorReviewBlock}${getReplacementSeparator(content.slice(range.end))}${content.slice(range.end)}`,
  );
}

function removeSecondAdvisorRangeContent(content: string, range: TextRange) {
  const before = content.slice(0, range.start).replace(/\n+$/, "");
  const after = content.slice(range.end).replace(/^\n+/, "");
  const result =
    before.length > 0 && after.length > 0
      ? `${before}\n\n${after}`
      : `${before}${after}`;
  if (result.length > 0 && content.endsWith("\n") && !result.endsWith("\n")) {
    return `${result}\n`;
  }
  return result;
}

function getReplacementSeparator(after: string) {
  if (after.length === 0) return "\n";
  if (after.startsWith("\n\n")) return "";
  if (after.startsWith("\n")) return "\n";
  return "\n\n";
}

function findManagedBlock(content: string) {
  const start = content.indexOf(secondAdvisorStartMarker);
  const end = content.indexOf(secondAdvisorEndMarker);
  if (start === -1 && end === -1) return undefined;
  if (
    start === -1 ||
    end === -1 ||
    end < start ||
    content.indexOf(secondAdvisorStartMarker, start + 1) !== -1 ||
    content.indexOf(secondAdvisorEndMarker, end + 1) !== -1
  ) {
    return "malformed" as const;
  }
  return { start, end: end + secondAdvisorEndMarker.length };
}

function findLegacySecondAdvisorBlock(content: string) {
  return findLegacySecondAdvisorBlocks(content)[0];
}

function findRemovableSecondAdvisorBlocks(content: string) {
  const managedBlocks = findCompleteManagedBlocks(content);
  const legacyBlocks = findLegacySecondAdvisorBlocks(content)
    .filter((range) => !startsInsideAnyRange(range, managedBlocks))
    .map((range) => expandRangeToPrecedingStartMarker(content, range));
  const markerBlocks = [
    ...findMarkerRanges(content, secondAdvisorStartMarker),
    ...findMarkerRanges(content, secondAdvisorEndMarker),
  ].filter(
    (range) => !isInsideAnyRange(range, [...managedBlocks, ...legacyBlocks]),
  );
  return mergeRanges([...managedBlocks, ...legacyBlocks, ...markerBlocks]);
}

function findCompleteManagedBlocks(content: string) {
  return [...content.matchAll(managedBlockPattern())].map((match) => ({
    start: match.index,
    end: match.index + match[0].length,
  }));
}

function findLegacySecondAdvisorBlocks(content: string) {
  return [...content.matchAll(/^## Second Advisor Review$/gm)].map((match) => {
    const afterHeading = match.index + match[0].length;
    const nextHeading = content.slice(afterHeading).search(/\n## /);
    return {
      start: match.index,
      end:
        nextHeading === -1
          ? content.length
          : afterHeading + nextHeading + "\n".length,
    };
  });
}

function expandRangeToPrecedingStartMarker(content: string, range: TextRange) {
  const start = content.lastIndexOf(secondAdvisorStartMarker, range.start);
  if (
    start === -1 ||
    content.slice(start + secondAdvisorStartMarker.length, range.start).trim()
      .length > 0
  ) {
    return range;
  }
  return { start, end: range.end };
}

function findMarkerRanges(content: string, marker: string) {
  return [...content.matchAll(new RegExp(escapeRegExp(marker), "g"))].map(
    (match) => ({
      start: match.index,
      end: match.index + marker.length,
    }),
  );
}

function isInsideAnyRange(range: TextRange, ranges: TextRange[]) {
  return ranges.some(
    (candidate) => range.start >= candidate.start && range.end <= candidate.end,
  );
}

function startsInsideAnyRange(range: TextRange, ranges: TextRange[]) {
  return ranges.some(
    (candidate) =>
      range.start >= candidate.start && range.start < candidate.end,
  );
}

function mergeRanges(ranges: TextRange[]) {
  const merged: TextRange[] = [];
  ranges
    .sort((left, right) => left.start - right.start)
    .forEach((range) => {
      const last = merged.at(-1);
      if (!last || range.start > last.end) {
        merged.push(range);
        return;
      }
      last.end = Math.max(last.end, range.end);
    });
  return merged;
}

function managedBlockPattern() {
  return new RegExp(
    `${escapeRegExp(secondAdvisorStartMarker)}[\\s\\S]*?${escapeRegExp(secondAdvisorEndMarker)}`,
    "g",
  );
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function formatSetupDiff(
  fileName: string,
  oldContent: string,
  newContent: string,
  color = shouldUseColor(),
) {
  const oldLines = splitDiffLines(oldContent);
  const newLines = splitDiffLines(newContent);
  const prefixLength = getCommonPrefixLength(oldLines, newLines);
  const suffixLength = getCommonSuffixLength(
    oldLines.slice(prefixLength),
    newLines.slice(prefixLength),
  );
  const context = 3;
  const hunkStart = Math.max(0, prefixLength - context);
  const oldChangeEnd = oldLines.length - suffixLength;
  const newChangeEnd = newLines.length - suffixLength;
  const oldHunkEnd = Math.min(oldLines.length, oldChangeEnd + context);
  const newHunkEnd = Math.min(newLines.length, newChangeEnd + context);

  return [
    colorDiffLine(`--- ${fileName}`, color),
    colorDiffLine(`+++ ${fileName}`, color),
    colorDiffLine(
      `@@ -${hunkStart + 1},${oldHunkEnd - hunkStart} +${hunkStart + 1},${newHunkEnd - hunkStart} @@`,
      color,
    ),
    ...oldLines.slice(hunkStart, prefixLength).map((line) => ` ${line}`),
    ...oldLines
      .slice(prefixLength, oldChangeEnd)
      .map((line) => colorDiffLine(`-${line}`, color)),
    ...newLines
      .slice(prefixLength, newChangeEnd)
      .map((line) => colorDiffLine(`+${line}`, color)),
    ...oldLines.slice(oldChangeEnd, oldHunkEnd).map((line) => ` ${line}`),
  ].join("\n");
}

function splitDiffLines(content: string) {
  if (content.length === 0) return [];
  if (content.endsWith("\n")) return content.slice(0, -1).split("\n");
  return content.split("\n");
}

function getCommonPrefixLength(left: string[], right: string[]) {
  const mismatch = left.findIndex((line, index) => line !== right[index]);
  return mismatch === -1 ? Math.min(left.length, right.length) : mismatch;
}

function getCommonSuffixLength(left: string[], right: string[]) {
  const maxLength = Math.min(left.length, right.length);
  const mismatch = Array.from({ length: maxLength }).findIndex(
    (_, index) =>
      left[left.length - index - 1] !== right[right.length - index - 1],
  );
  return mismatch === -1 ? maxLength : mismatch;
}

function shouldUseColor() {
  return process.stdout.isTTY && !("NO_COLOR" in process.env);
}

function colorSetupDiff(diff: string) {
  return diff
    .split("\n")
    .map((line) => colorDiffLine(line, shouldUseColor()))
    .join("\n");
}

function colorDiffLine(line: string, color: boolean) {
  if (!color) return line;
  if (line.startsWith("@@")) return `\u001b[36m${line}\u001b[0m`;
  if (line.startsWith("--- ") || line.startsWith("+++ ")) return line;
  if (line.startsWith("+")) return `\u001b[32m${line}\u001b[0m`;
  if (line.startsWith("-")) return `\u001b[31m${line}\u001b[0m`;
  return line;
}

async function promptForConfig() {
  const installedAdvisors = getInstalledAdvisorChoices();
  if (installedAdvisors.length === 0) {
    log.error("No supported coding CLI found on PATH.");
    log.info(`Supported CLIs: ${advisorChoices.join(", ")}`);
    process.exit(1);
  }

  const advisor = await select({
    message: "Choose a coding CLI",
    options: installedAdvisors.map((value) => ({ value, label: value })),
  });
  if (isCancel(advisor)) return endCancelled();
  return promptForAdvisor(advisor);
}

async function promptForAdvisor(advisor: Advisor): Promise<Config> {
  const model = await promptModelValue(advisor);
  if (advisor === "kimi") return { advisor, model };

  const thinking = await promptThinkingValue(advisor, undefined, model);
  return parseConfig({ advisor, model, thinking });
}

async function promptForModel(config: Config): Promise<Config> {
  const model = await promptModelValue(config.advisor, config.model);
  if (config.advisor === "amp") {
    const options = getThinkingOptions("amp", model);
    return parseConfig({
      ...config,
      model,
      thinking: options.includes(config.thinking)
        ? config.thinking
        : options[0],
    });
  }
  return parseConfig({ ...config, model });
}

async function promptForThinking(config: Config): Promise<Config> {
  if (config.advisor === "kimi") {
    log.info("Kimi does not expose a thinking/effort setting.");
    return config;
  }
  const thinking = await promptThinkingValue(
    config.advisor,
    config.thinking,
    config.model,
  );
  return parseConfig({ ...config, thinking });
}

async function promptModelValue(advisor: Advisor, initialValue?: string) {
  if (advisor === "amp") {
    const mode = await select({
      message: "Choose an Amp mode",
      initialValue:
        initialValue &&
        ampModes.includes(initialValue as (typeof ampModes)[number])
          ? initialValue
          : "smart",
      options: ampModes.map((value) => ({ value, label: value })),
    });
    if (isCancel(mode)) return endCancelled();
    return mode;
  }

  const choices = await loadChoicesWithSpinner(advisor);
  if (choices.length > 0) {
    const model = await select({
      message: "Choose a model",
      initialValue,
      options: choices.map((value) => ({ value, label: value })),
    });
    if (isCancel(model)) return endCancelled();
    return model;
  }

  const model = await text({
    message: `Enter ${advisor} model`,
    placeholder: initialValue || "model name",
    initialValue,
    validate: (value) =>
      !value || value.length === 0 ? "Model is required" : undefined,
  });
  if (isCancel(model)) return endCancelled();
  return model;
}

async function promptThinkingValue(
  advisor: Exclude<Advisor, "kimi">,
  initialValue?: string,
  model?: string,
) {
  const options = getThinkingOptions(advisor, model);
  const thinking = await select({
    message: advisor === "amp" ? "Choose effort" : "Choose thinking/effort",
    initialValue:
      initialValue && options.includes(initialValue)
        ? initialValue
        : options[0],
    options: options.map((value) => ({ value, label: value })),
  });
  if (isCancel(thinking)) return endCancelled();
  return thinking;
}

async function loadChoicesWithSpinner(advisor: Advisor) {
  if (advisor === "claude") return loadModelChoices(advisor);
  if (!getModelListCommand(advisor)) return [];

  const s = spinner();
  s.start(`Loading ${advisor} models`);
  const choices = await loadModelChoices(advisor);
  s.stop(
    choices.length > 0
      ? `Loaded ${advisor} models`
      : `Could not load ${advisor} models`,
  );
  return choices;
}

export function formatStatus(config: Config, executable?: string) {
  const modelRows = formatModelRows(config);
  const rows = [
    ["Coding CLI", config.advisor],
    ...modelRows,
    ...("thinking" in config && !modelRows.some((row) => row[0] === "Thinking")
      ? [["Thinking", config.thinking]]
      : []),
    ["Config", formatDisplayPath(configPath)],
    [
      "Executable",
      executable ? formatDisplayPath(executable) : "not found on PATH",
    ],
  ];
  const labelWidth = Math.max(...rows.map((row) => row[0].length));

  return [
    "Current setup",
    ...rows.map((row) => `  ${row[0].padEnd(labelWidth)} ${row[1]}`),
  ].join("\n");
}

function formatModelRows(config: Config) {
  if (config.advisor === "pi") {
    const piModel = parsePiModelTableRow(config.model);
    if (!piModel) return [["Model", config.model]];
    return [
      ["Model", `${piModel.provider} / ${piModel.model}`],
      ["Context", `${piModel.context} input / ${piModel.maxOutput} output`],
      ["Thinking", `${piModel.thinking}, ${config.thinking}`],
    ];
  }
  return [[config.advisor === "amp" ? "Mode" : "Model", config.model]];
}

function formatDisplayPath(value: string) {
  if (value === homedir()) return "~";
  if (value.startsWith(`${homedir()}${path.sep}`)) {
    return `~${path.sep}${value.slice(homedir().length + 1)}`;
  }
  return value;
}

function parseAdvisorInput(input: string) {
  if (isAdvisor(input)) return input;
  throw new Error(`Unknown advisor: ${input}`);
}

function endCancelled(): never {
  cancel("Cancelled.");
  process.exit(0);
}
