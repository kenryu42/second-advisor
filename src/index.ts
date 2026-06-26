#!/usr/bin/env bun
import { Command } from "commander";
import { readPackageVersion } from "./package.js";
import { parseCliRequest } from "./routing.js";
import {
  runDoctor,
  runInit,
  runMenu,
  runModels,
  runPrompt,
  runSetup,
  runStatus,
} from "./ui.js";

export {
  advisorChoices,
  buildAdvisorCommand,
  getModelListCommand,
  summarizeConfig,
} from "./advisors.js";
export { parseConfig } from "./config.js";
export { parseCliRequest } from "./routing.js";

async function main() {
  const program = new Command()
    .name("second-advisor")
    .description("Consult a configured coding CLI for a second opinion.")
    .version(readPackageVersion(), "-v, --version", "display version")
    .argument("[input...]", "prompt to send to the configured advisor")
    .option("--debug", "print the coding CLI command before running it")
    .option("--json", "print command output as JSON when supported")
    .allowUnknownOption(false)
    .helpOption("-h, --help", "display help")
    .addHelpText(
      "after",
      `
Examples:
  second-advisor
  second-advisor init
  second-advisor doctor
  second-advisor models
  second-advisor setup
  second-advisor "what do you think about this implementation?"
`,
    );

  program.parse(process.argv);
  const request = parseCliRequest(program.args);
  const options = program.opts<{ debug?: boolean; json?: boolean }>();

  if (request.kind === "menu") {
    await runMenu();
    return;
  }

  if (request.kind === "prompt") {
    await runPrompt(request.prompt, { debug: options.debug === true });
    return;
  }

  if (request.command === "init") {
    await runInit();
    return;
  }

  if (request.command === "doctor") {
    await runDoctor({ json: options.json === true });
    return;
  }

  if (request.command === "models") {
    await runModels(request.args[0]);
    return;
  }

  if (request.command === "setup") {
    await runSetup();
    return;
  }

  await runStatus();
}

if (import.meta.main) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
