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
  cli: Advisor;
  installed: boolean;
  path: string;
  version: string;
};

type Loader = {
  start: (message: string) => void;
  stop: (message: string) => void;
};

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
  return Promise.all(
    advisorChoices.map(async (advisor) => {
      const executable = resolveExecutable(advisor);
      if (!executable) {
        return {
          cli: advisor,
          installed: false,
          path: "-",
          version: "not installed",
        };
      }

      const version = await runCommand(advisor, getVersionArgs(), {
        pipeOutput: true,
      });
      return {
        cli: advisor,
        installed: true,
        path: executable,
        version:
          version.exitCode === 0
            ? normalizeVersionOutput(version.stdout, version.stderr)
            : "version check failed",
      };
    }),
  );
}

export async function runMenu() {
  intro("second-advisor");
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
      { value: "advisor", label: "Change coding CLI" },
      {
        value: "model",
        label: config.advisor === "amp" ? "Change mode" : "Change model",
      },
      { value: "thinking", label: "Change thinking/effort" },
      { value: "models", label: "Show available models/modes" },
      { value: "doctor", label: "Run doctor" },
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
  intro("second-advisor init");
  await writeConfig(await promptForConfig());
  outro("second-advisor is configured.");
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

export async function runDoctor() {
  intro("second-advisor doctor");
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

function formatStatus(config: Config, executable?: string) {
  return [
    `Current setup: ${summarizeConfig(config)}`,
    `Config: ${configPath}`,
    `Executable: ${executable || "not found on PATH"}`,
  ].join("\n");
}

function parseAdvisorInput(input: string) {
  if (isAdvisor(input)) return input;
  throw new Error(`Unknown advisor: ${input}`);
}

function endCancelled(): never {
  cancel("Cancelled.");
  process.exit(0);
}
