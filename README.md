# Second Advisor

[![CI](https://github.com/kenryu42/second-advisor/actions/workflows/ci.yml/badge.svg)](https://github.com/kenryu42/second-advisor/actions/workflows/ci.yml)
[![Version](https://img.shields.io/github/v/tag/kenryu42/second-advisor?label=version&color=blue)](https://github.com/kenryu42/second-advisor)
[![Codex](https://img.shields.io/badge/Codex-white)](#supported-advisors)
[![Claude Code](https://img.shields.io/badge/Claude%20Code-D27656)](#supported-advisors)
[![OpenCode](https://img.shields.io/badge/OpenCode-black)](#supported-advisors)
[![Grok](https://img.shields.io/badge/Grok-111111)](#supported-advisors)
[![Pi](https://img.shields.io/badge/Pi%20Coding-22262E)](#supported-advisors)
[![Droid](https://img.shields.io/badge/Droid-3DDC84)](#supported-advisors)
[![Amp](https://img.shields.io/badge/Amp-615CED)](#supported-advisors)
[![Kimi Code](https://img.shields.io/badge/Kimi%20Code-5587FF)](#supported-advisors)
[![License: MIT](https://img.shields.io/badge/License-MIT-red.svg)](LICENSE)

`second-advisor` is a small CLI that sends a prompt to another coding CLI for a second opinion. It is intended for review-oriented workflows where your primary agent or editor can ask a configured advisor to inspect substantial work before a final response.

The CLI stores one configured advisor, model or mode, and thinking/effort setting, then builds the correct non-interactive command for that advisor.

## Features

- Interactive initialization with installed advisor detection.
- Prompt forwarding to supported coding CLIs.
- Short command alias: `sa`.
- Debug output for the raw command that will be executed.
- Doctor command for checking config and advisor executables.
- Model/mode listing for advisors that expose model discovery.
- Setup command that appends second-advisor workflow instructions to `AGENTS.md` and/or `CLAUDE.md`.

## Requirements

- Bun
- At least one supported coding CLI installed on `PATH`

The command entrypoint is `src/index.ts` with `#!/usr/bin/env bun`, so Bun must be available on `PATH` even when using a linked command.

Supported advisors:

| Advisor | Executable | Notes |
| --- | --- | --- |
| Claude | `claude` | Uses built-in aliases: `haiku`, `sonnet`, `opus`. |
| Codex | `codex` | Lists bundled models with `codex debug models --bundled`. |
| opencode | `opencode` | Lists models with `opencode models`. |
| Grok | `grok` | Lists models with `grok models`. |
| Pi | `pi` | Lists models with `pi --list-models`. |
| Droid | `droid` | Extracts models from `droid exec --help`. |
| Amp | `amp` | Uses modes: `rush`, `smart`, `deep`. |
| Kimi | `kimi` | Lists models with `kimi provider list --json`; no thinking setting. |

## Installation

Install globally with Bun:

```sh
bun install -g second-advisor
```

Or install globally with npm:

```sh
npm install -g second-advisor
```

Both commands are available after installation:

```sh
second-advisor --help
sa --help
```

Depending on your package manager setup, you may need its global bin directory on `PATH`.

### Local Development

Clone the repository, then install dependencies:

```sh
bun install
```

Run locally:

```sh
bun run src/index.ts
```

For local command usage, link the package so the `bin` entries are available:

```sh
bun link
```

After linking, both commands point to the same CLI:

```sh
second-advisor --help
sa --help
```

## Quick Start

Initialize the advisor config:

```sh
second-advisor init
```

Send a prompt:

```sh
second-advisor "review this implementation for correctness and missed edge cases"
```

Use the short alias:

```sh
sa "say hi"
```

Print the raw advisor command before running it:

```sh
second-advisor "say hi" --debug
```

Example debug output:

```sh
amp --mode rush --effort low --execute 'say hi'
```

## Commands

### `second-advisor`

With no arguments, opens the interactive menu. If no config exists, the menu offers initialization. If a config exists, the menu shows current setup and lets you change advisor, model/mode, thinking/effort, list models, or run doctor.

```sh
second-advisor
```

### `second-advisor init`

Creates or replaces the config at:

```text
~/.config/second-advisor/config.json
```

The initializer detects supported CLIs on `PATH`, asks which advisor to use, then prompts for a model/mode and thinking/effort setting when applicable.

### `second-advisor "<prompt>"`

Runs the configured advisor with the given prompt. The prompt is formed by joining all non-command arguments with spaces.

```sh
second-advisor "what risks do you see in this change?"
```

If no config exists, the command exits with an error and asks you to run `second-advisor init`.

The first argument is reserved when it is one of the command names: `init`, `doctor`, `models`, `setup`, or `status`. For example, `second-advisor init` runs initialization instead of sending `init` as a prompt.

### `second-advisor "<prompt>" --debug`

Prints the exact advisor command before executing it.

```sh
second-advisor "review this diff" --debug
```

The debug line is written to stderr so advisor stdout remains usable.

### `second-advisor status`

Shows the current config, config file path, and whether the configured advisor executable is present on `PATH`.

```sh
second-advisor status
```

### `second-advisor --version`

Prints compact runtime identity information: the installed `second-advisor` version, Bun and Node versions, config path, configured advisor, and advisor CLI version when available.

```sh
second-advisor --version
second-advisor -v
```

### `second-advisor doctor`

Checks the installed `second-advisor` version, installed advisor CLI versions, config validity, configured advisor executable, and Amp mode validity.

The version report uses a table when it fits the terminal and switches to a compact list on narrow terminals.

```sh
second-advisor doctor
```

For machine-readable debug output:

```sh
second-advisor doctor --json
```

### `second-advisor models [advisor]`

Lists models or modes for an advisor.

```sh
second-advisor models
second-advisor models amp
second-advisor models codex
```

If no advisor is passed, the command uses the configured advisor. Claude and Amp are listed from built-in aliases/modes. Other supported advisors use their model-list commands when available.

During interactive setup, advisors with model-list commands fall back to manual model entry if model discovery does not return choices.

### `second-advisor setup`

Looks for `AGENTS.md` and `CLAUDE.md` in the current working directory and installs or updates the managed Second Advisor Review instructions in each file found.

```sh
second-advisor setup
second-advisor setup --remove
```

Behavior:

- Updates both files if both exist.
- Appends the managed block when it is missing.
- Updates stale managed or legacy `## Second Advisor Review` blocks in place.
- Removes managed or legacy `## Second Advisor Review` blocks when `--remove` is passed.
- Skips a file when the managed block already matches the latest text.
- Prints a focused unified diff for each file it edits.
- Leaves files with malformed Second Advisor markers unchanged and reports an error when installing/updating; `--remove` cleans them up best-effort.
- Exits with code `1` if neither `AGENTS.md` nor `CLAUDE.md` exists in the current directory.
- Exits with code `1` if any file cannot be updated safely.
- Does not search parent directories.

The appended block tells agents to ask for a second opinion after substantial work and to use:

```sh
second-advisor "<review prompt>"
```

## Configuration

Config is stored at:

```text
~/.config/second-advisor/config.json
```

Example Amp config:

```json
{
  "advisor": "amp",
  "model": "rush",
  "thinking": "low"
}
```

Example Kimi config:

```json
{
  "advisor": "kimi",
  "model": "kimi-k2"
}
```

Validation rules:

- `advisor` must be one of the supported advisors.
- Most advisors require `model` and `thinking`.
- Kimi requires `model` and does not support `thinking`.
- Claude models must be one of `haiku`, `sonnet`, or `opus`.
- Claude thinking must be one of `low`, `medium`, `high`, `xhigh`, or `max`.
- Codex thinking must be one of `low`, `medium`, `high`, or `xhigh`.
- Pi thinking must be one of `off`, `minimal`, `low`, `medium`, `high`, or `xhigh`.
- Amp modes must be one of `rush`, `smart`, or `deep`.
- Amp `rush` supports only `none`, `minimal`, `low`, and `medium` effort.

## Exit Codes

- Prompt execution forwards the configured advisor command's exit code.
- Prompt execution exits with code `1` when no config exists.
- `setup` exits with code `1` when neither `AGENTS.md` nor `CLAUDE.md` exists in the current working directory.
- Unhandled config parse errors are printed by the CLI and exit with code `1`.

## Advisor Command Mapping

`second-advisor` runs advisors non-interactively:

| Advisor | Command shape |
| --- | --- |
| Claude | `claude --model <model> --effort <thinking> -p <prompt>` |
| Codex | `codex exec -m <model> --config model_reasoning_effort=<thinking> <prompt>` |
| opencode | `opencode run -m <model> --variant <thinking> <prompt>` |
| Grok | `grok -m <model> --reasoning-effort <thinking> -p <prompt>` |
| Pi | `pi --model <provider/model> --thinking <thinking> -p <prompt>` |
| Droid | `droid exec -m <model> --reasoning-effort <thinking> <prompt>` |
| Amp | `amp --mode <mode> --effort <thinking> --execute <prompt>` |
| Kimi | `kimi -m <model> -p <prompt>` |

Use `--debug` to inspect the exact command for your current config.

## Development

Install dependencies:

```sh
bun install
```

Run the CLI during development:

```sh
bun run src/index.ts
```

Or use the project script:

```sh
bun run sa
```

Run the full verification suite:

```sh
bun run check
```

`bun run check` runs typecheck, Biome lint, Knip, copy-paste detection, and tests.

Useful scripts:

```sh
bun run test
bun run test:watch
bun run typecheck
bun run lint
bun run publish:dry-run
```

## Troubleshooting

### `second-advisor is not initialized`

Run:

```sh
second-advisor init
```

### Advisor executable is missing

Make sure the configured advisor CLI is installed and available on `PATH`, then run:

```sh
second-advisor doctor
```

If `second-advisor init` reports that no supported coding CLI was found, install one of the supported advisor CLIs or fix your `PATH`.

### Model listing fails

Some advisors depend on their own CLI model-list command. Confirm that advisor is authenticated and that its model-list command works directly.

### Setup cannot find instruction files

`second-advisor setup` only checks the current working directory. Run it from the directory that contains `AGENTS.md` or `CLAUDE.md`.

## License

MIT. See `LICENSE`.
