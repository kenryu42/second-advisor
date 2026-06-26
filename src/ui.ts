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

export const secondAdvisorReviewBlock = `## Second Advisor Review

After completing substantial work, especially code changes, skill changes, CLI behavior changes, or agent workflow changes, ask for a second opinion before the final response.

Use:

second-advisor "<review prompt>"

The second opinion must be read and considered. Fix valid high-priority issues, then rerun relevant tests. If the second-advisor command hangs or fails, report that clearly instead of blocking forever.

Do not run second-advisor for:
- simple Q&A
- tiny documentation wording changes
- status updates
- tasks where the user explicitly says not to`;

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

export async function runSetup(cwd = process.cwd()) {
  const result = await setupSecondAdvisorReview(cwd);
  if (result.updated.length === 0 && result.skipped.length === 0) {
    console.error("No AGENTS.md or CLAUDE.md found in the current directory.");
    process.exitCode = 1;
    return;
  }

  result.skipped.forEach((file) => {
    log.info(`Already configured: ${file}`);
  });
  result.updated.forEach((file) => {
    log.success(`Updated: ${file}`);
  });
}

export async function setupSecondAdvisorReview(cwd = process.cwd()) {
  const files = agentInstructionFiles
    .map((file) => path.join(cwd, file))
    .filter((file) => existsSync(file));

  const changes = await Promise.all(
    files.map(async (file) =>
      (await setupSecondAdvisorReviewFile(file))
        ? { updated: path.basename(file), skipped: undefined }
        : { updated: undefined, skipped: path.basename(file) },
    ),
  );

  return {
    updated: changes
      .map((change) => change.updated)
      .filter((file) => file !== undefined),
    skipped: changes
      .map((change) => change.skipped)
      .filter((file) => file !== undefined),
  };
}

export async function runDoctor() {
  intro(`${appTitle} doctor`);
  const advisorChecks = await runWithLoader(
    spinner(),
    "Checking coding CLI versions",
    "Checked coding CLI versions",
    getAdvisorDoctorChecks,
  );
  log.message(
    `Coding CLI versions:\n${formatAdvisorDoctorTable(advisorChecks)}`,
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

async function setupSecondAdvisorReviewFile(file: string) {
  const content = await readFile(file, "utf8");
  if (content.includes("## Second Advisor Review")) return false;
  await writeFile(file, appendReviewBlock(content));
  return true;
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
