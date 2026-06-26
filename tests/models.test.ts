import { expect, test } from "bun:test";
import { loadModelChoices, parseModelChoices } from "../src/models.js";

test("loads static Claude model aliases", async () => {
  await expect(loadModelChoices("claude")).resolves.toEqual([
    "haiku",
    "sonnet",
    "opus",
  ]);
});

test("parses only Codex model slugs", () => {
  expect(
    parseModelChoices(
      "codex",
      JSON.stringify({
        models: [
          {
            slug: "gpt-5.5",
            display_name: "GPT-5.5",
            default_reasoning_level: "medium",
            supported_reasoning_levels: [{ effort: "low" }],
          },
          {
            slug: "gpt-5.4-mini",
            display_name: "GPT-5.4-Mini",
            default_reasoning_level: "low",
          },
        ],
      }),
    ),
  ).toEqual(["gpt-5.5", "gpt-5.4-mini"]);
});

test("parses only Grok model names", () => {
  expect(
    parseModelChoices(
      "grok",
      [
        "You are logged in with grok.com.",
        "",
        "Default model: grok-composer-2.5-fast",
        "",
        "Available models:",
        "  - grok-build",
        "  * grok-composer-2.5-fast (default)",
      ].join("\n"),
    ),
  ).toEqual(["grok-build", "grok-composer-2.5-fast"]);
});

test("parses only Kimi model ids", () => {
  expect(
    parseModelChoices(
      "kimi",
      JSON.stringify({
        providers: {
          "managed:kimi-code": {
            type: "kimi",
            baseUrl: "https://api.kimi.com/coding/v1",
            env: { KIMI_API_KEY: "sk-kimi-secret" },
          },
        },
        models: {
          "kimi-code/kimi-k2.7-code": {
            provider: "managed:kimi-code",
            model: "kimi-k2.7-code",
            displayName: "K2.7 Code",
          },
          "kimi-code/kimi-k2.7-code-highspeed": {
            provider: "managed:kimi-code",
            model: "kimi-k2.7-code-highspeed",
            displayName: "K2.7 Code Highspeed",
          },
        },
      }),
    ),
  ).toEqual(["kimi-code/kimi-k2.7-code", "kimi-code/kimi-k2.7-code-highspeed"]);
});

test("parses Pi model table rows as provider-qualified model ids", () => {
  expect(
    parseModelChoices(
      "pi",
      [
        "Warning: cached models may be stale",
        "provider               model                               context  max-out  thinking  images",
        "--------               -----                               -------  -------  --------  ------",
        "zai                    glm-5.2                             1M       128K     yes       no",
        "proxx                  openai/gpt-5.2                      272K     128K     yes       yes",
      ].join("\n"),
    ),
  ).toEqual(["zai/glm-5.2", "proxx/openai/gpt-5.2"]);
});
