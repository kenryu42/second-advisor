import { expect, test } from "bun:test";
import { parseConfig } from "../src/config.js";

test("parses and validates persisted config", () => {
  expect(
    parseConfig({
      advisor: "claude",
      model: "sonnet",
      thinking: "high",
    }),
  ).toEqual({
    advisor: "claude",
    model: "sonnet",
    thinking: "high",
  });
  expect(
    parseConfig({ advisor: "amp", model: "smart", thinking: "xhigh" }),
  ).toEqual({
    advisor: "amp",
    model: "smart",
    thinking: "xhigh",
  });
  expect(parseConfig({ advisor: "kimi", model: "kimi-k2" })).toEqual({
    advisor: "kimi",
    model: "kimi-k2",
  });
  expect(() =>
    parseConfig({ advisor: "amp", model: "sonnet", thinking: "low" }),
  ).toThrow("Invalid Amp mode");
  expect(() =>
    parseConfig({ advisor: "amp", model: "smart", thinking: "what" }),
  ).toThrow("Invalid Amp thinking");
  expect(() =>
    parseConfig({
      advisor: "claude",
      model: "claude-sonnet",
      thinking: "high",
    }),
  ).toThrow("Invalid Claude model");
  expect(() =>
    parseConfig({ advisor: "kimi", model: "kimi-k2", thinking: "high" }),
  ).toThrow("Kimi does not support thinking");
});
