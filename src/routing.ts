const commands = ["init", "doctor", "models", "setup", "status"] as const;

type CommandName = (typeof commands)[number];

export type CliRequest =
  | { kind: "menu" }
  | { kind: "prompt"; prompt: string }
  | { kind: "command"; command: CommandName; args: string[] };

export function parseCliRequest(args: string[]): CliRequest {
  if (args.length === 0) return { kind: "menu" };
  if (isCommandName(args[0]))
    return { kind: "command", command: args[0], args: args.slice(1) };
  return { kind: "prompt", prompt: args.join(" ") };
}

function isCommandName(value: string): value is CommandName {
  return commands.includes(value as CommandName);
}
