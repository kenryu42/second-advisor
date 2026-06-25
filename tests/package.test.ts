import { expect, test } from "bun:test";

async function readPackageJson() {
  return JSON.parse(await Bun.file("package.json").text());
}

test("exposes the cli under the full name and short alias", async () => {
  expect((await readPackageJson()).bin).toEqual({
    "second-advisor": "src/index.ts",
    sa: "src/index.ts",
  });
});

test("is configured for public npm publishing", async () => {
  const packageJson = await readPackageJson();

  expect(packageJson.private).toBeUndefined();
  expect(packageJson.description).toBe(
    "Ask another coding CLI for a second opinion.",
  );
  expect(packageJson.license).toBe("MIT");
  expect(packageJson.repository).toEqual({
    type: "git",
    url: "git+https://github.com/kenryu42/second-advisor.git",
  });
  expect(packageJson.bugs).toEqual({
    url: "https://github.com/kenryu42/second-advisor/issues",
  });
  expect(packageJson.homepage).toBe(
    "https://github.com/kenryu42/second-advisor#readme",
  );
  expect(packageJson.publishConfig).toEqual({ access: "public" });
  expect(packageJson.engines).toEqual({ bun: ">=1.3.0" });
  expect(packageJson.keywords).toEqual([
    "ai",
    "agent",
    "cli",
    "code-review",
    "codex",
  ]);
});

test("publishes only runtime source and standard package docs", async () => {
  expect((await readPackageJson()).files).toEqual(["src"]);
});

test("keeps development hook setup available", async () => {
  const packageJson = await readPackageJson();

  expect(packageJson.scripts.prepare).toBe("lefthook install");
  expect(packageJson.scripts["hooks:install"]).toBe("lefthook install");
});

test("disables lefthook execution in CI workflows", async () => {
  expect(await Bun.file(".github/workflows/ci.yml").text()).toContain(
    'LEFTHOOK: "0"',
  );
  expect(await Bun.file(".github/workflows/publish.yml").text()).toContain(
    'LEFTHOOK: "0"',
  );
});
