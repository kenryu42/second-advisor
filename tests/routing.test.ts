import { expect, test } from "bun:test";
import { parseCliRequest } from "../src/routing.js";

test("routes bare invocation, commands, and prompts", () => {
  expect(parseCliRequest([])).toEqual({ kind: "menu" });
  expect(parseCliRequest(["init"])).toEqual({
    kind: "command",
    command: "init",
    args: [],
  });
  expect(parseCliRequest(["doctor"])).toEqual({
    kind: "command",
    command: "doctor",
    args: [],
  });
  expect(parseCliRequest(["models", "amp"])).toEqual({
    kind: "command",
    command: "models",
    args: ["amp"],
  });
  expect(parseCliRequest(["setup"])).toEqual({
    kind: "command",
    command: "setup",
    args: [],
  });
  expect(parseCliRequest(["what", "do", "you", "think?"])).toEqual({
    kind: "prompt",
    prompt: "what do you think?",
  });
});
