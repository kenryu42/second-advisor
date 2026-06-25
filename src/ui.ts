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
import { getHelpArgs, resolveExecutable, runCommand } from "./process.js";

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
  const config = await readConfigIfPresent();

  if (!config) {
    log.error(`Config missing: ${configPath}`);
    outro("Run second-advisor init.");
    return;
  }

  log.success(`Config OK: ${summarizeConfig(config)}`);
  const executable = resolveExecutable(config.advisor);

  if (!executable) {
    log.error(`Executable not found on PATH: ${config.advisor}`);
    outro("Doctor failed.");
    return;
  }

  log.success(`Executable found: ${executable}`);
  if (config.advisor === "amp" && !ampModes.includes(config.model)) {
    log.error(`Invalid Amp mode: ${config.model}`);
    outro("Doctor failed.");
    return;
  }

  const help = await runCommand(config.advisor, getHelpArgs(config.advisor), {
    pipeOutput: true,
  });
  if (help.exitCode !== 0) {
    log.error(help.stderr || `${config.advisor} help check failed.`);
    outro("Doctor failed.");
    return;
  }

  log.success(`${config.advisor} help check OK.`);
  outro("Doctor passed.");
}

export async function runPrompt(prompt: string) {
  const config = await readConfigIfPresent();
  if (!config) {
    console.error(
      `second-advisor is not initialized. Run: second-advisor init`,
    );
    process.exitCode = 1;
    return;
  }

  const advisorCommand = buildAdvisorCommand(config, prompt);
  const result = await runCommand(advisorCommand.command, advisorCommand.args, {
    pipeOutput: false,
  });
  process.exitCode = result.exitCode;
}

async function promptForConfig() {
  const advisor = await select({
    message: "Choose a coding CLI",
    options: advisorChoices.map((value) => ({ value, label: value })),
  });
  if (isCancel(advisor)) return endCancelled();
  return promptForAdvisor(advisor);
}

async function promptForAdvisor(advisor: Advisor): Promise<Config> {
  const model = await promptModelValue(advisor);
  if (advisor === "kimi") return { advisor, model };

  const thinking = await promptThinkingValue(advisor);
  return parseConfig({ advisor, model, thinking });
}

async function promptForModel(config: Config): Promise<Config> {
  const model = await promptModelValue(config.advisor, config.model);
  return parseConfig({ ...config, model });
}

async function promptForThinking(config: Config): Promise<Config> {
  if (config.advisor === "kimi") {
    log.info("Kimi does not expose a thinking/effort setting.");
    return config;
  }
  const thinking = await promptThinkingValue(config.advisor, config.thinking);
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
) {
  const options = getThinkingOptions(advisor);
  const thinking = await select({
    message:
      advisor === "amp" ? "Choose review thinking" : "Choose thinking/effort",
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
