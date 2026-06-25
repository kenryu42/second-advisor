import { expect, test } from "bun:test";
import { parseConfig } from "../src/config.js";

test("parses and validates persisted config", () => {
  expect(
    parseConfig({ advisor: "amp", model: "smart", thinking: "low" }),
  ).toEqual({
    advisor: "amp",
    model: "smart",
    thinking: "low",
  });
  expect(parseConfig({ advisor: "kimi", model: "kimi-k2" })).toEqual({
    advisor: "kimi",
    model: "kimi-k2",
  });
  expect(() =>
    parseConfig({ advisor: "amp", model: "sonnet", thinking: "low" }),
  ).toThrow("Invalid Amp mode");
  expect(() =>
    parseConfig({ advisor: "kimi", model: "kimi-k2", thinking: "high" }),
  ).toThrow("Kimi does not support thinking");
});
