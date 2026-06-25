import { expect, test } from "bun:test";

test("exposes the cli under the full name and short alias", async () => {
  expect(JSON.parse(await Bun.file("package.json").text()).bin).toEqual({
    "second-advisor": "src/index.ts",
    sa: "src/index.ts",
  });
});
