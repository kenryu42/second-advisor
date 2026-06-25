#!/usr/bin/env bun
import { $ } from "bun";
import { buildReleaseNotes } from "./changelog.ts";

type BumpType = "major" | "minor" | "patch";
type CommandRunner = typeof $;

function isBumpType(value: unknown): value is BumpType {
  return value === "major" || value === "minor" || value === "patch";
}

function bumpVersion(version: string, type: BumpType) {
  const [major = 0, minor = 0, patch = 0] = version.split(".").map(Number);
  if (type === "major") return `${major + 1}.0.0`;
  if (type === "minor") return `${major}.${minor + 1}.0`;
  return `${major}.${minor}.${patch + 1}`;
}

function replacePackageVersion(packageJson: string, newVersion: string) {
  const versionPattern = /"version"\s*:\s*"[^"]+"/;
  if (!versionPattern.test(packageJson)) {
    throw new Error("Could not find version field in package.json");
  }
  return packageJson.replace(versionPattern, `"version": "${newVersion}"`);
}

async function readPackageJson() {
  return JSON.parse(await Bun.file("package.json").text()) as {
    name?: string;
    version?: string;
  };
}

async function fetchPreviousVersion(packageName: string) {
  const res = await fetch(`https://registry.npmjs.org/${packageName}/latest`);
  if (res.status === 404) return "0.0.0";
  if (!res.ok)
    throw new Error(`Failed to fetch npm latest version: ${res.statusText}`);
  const data = (await res.json()) as { version: string };
  return data.version;
}

async function checkVersionExists(packageName: string, version: string) {
  const res = await fetch(
    `https://registry.npmjs.org/${packageName}/${version}`,
  );
  if (res.ok) return true;
  if (res.status === 404) return false;
  throw new Error(`Could not confirm npm version state: ${res.statusText}`);
}

async function requireCleanWorkingTree(
  runner: CommandRunner,
  allowedFiles: string[],
) {
  const status = await runner`git status --porcelain`.text();
  const unexpected = status
    .split("\n")
    .filter(Boolean)
    .filter((line) => !allowedFiles.some((file) => line.includes(file)));

  if (unexpected.length > 0) {
    throw new Error(
      `Unexpected uncommitted changes:\n${unexpected.join("\n")}`,
    );
  }
}

async function recover(
  packageName: string,
  execute: boolean,
  runner: CommandRunner,
) {
  const npmVersion = await fetchPreviousVersion(packageName);
  const tagExists = await runner`git rev-parse v${npmVersion}`.text().then(
    () => true,
    () => false,
  );
  const releaseExists = await runner`gh release view v${npmVersion}`
    .text()
    .then(
      () => true,
      () => false,
    );

  console.log(`npm version: ${npmVersion}`);
  console.log(`Git tag v${npmVersion}: ${tagExists ? "exists" : "missing"}`);
  console.log(`GitHub release: ${releaseExists ? "exists" : "missing"}`);

  if (!execute) {
    console.log("Use --recover --execute to create missing artifacts.");
    return;
  }

  if (!tagExists) {
    await runner`git tag v${npmVersion}`.text();
    await runner`git push origin v${npmVersion}`.text();
  }

  if (!releaseExists) {
    await runner`gh release create v${npmVersion} --title v${npmVersion} --notes "Recovery release"`.text();
  }
}

async function main(runner: CommandRunner = $) {
  const packageJson = await readPackageJson();
  if (!packageJson.name) throw new Error("package.json is missing a name");

  const args = process.argv.slice(2);
  if (args.includes("--recover")) {
    await recover(packageJson.name, args.includes("--execute"), runner);
    return;
  }

  const bump = process.env.BUMP || "patch";
  if (!isBumpType(bump)) {
    throw new Error(
      `Invalid BUMP value "${bump}". Use major, minor, or patch.`,
    );
  }

  const previousVersion = await fetchPreviousVersion(packageJson.name);
  const newVersion = process.env.VERSION || bumpVersion(previousVersion, bump);
  const dryRun = args.includes("--dry-run");
  const releaseFiles = ["package.json"];

  await requireCleanWorkingTree(runner, dryRun ? [] : releaseFiles);

  const versionExists = await checkVersionExists(packageJson.name, newVersion);
  if (versionExists) {
    console.log(
      `${packageJson.name}@${newVersion} already exists on npm. Skipping.`,
    );
    return;
  }

  if (dryRun) {
    console.log(`[DRY-RUN] Would publish ${packageJson.name}@${newVersion}`);
    return;
  }

  if (!process.env.CI) {
    throw new Error("Not in CI environment. Use --dry-run to test locally.");
  }

  const packageText = await Bun.file("package.json").text();
  await Bun.write(
    "package.json",
    replacePackageVersion(packageText, newVersion),
  );

  await runner`git config user.email "github-actions[bot]@users.noreply.github.com"`.text();
  await runner`git config user.name "github-actions[bot]"`.text();
  await runner`git add package.json`.text();
  await runner`git commit -m ${`release: v${newVersion}`}`.text();
  await runner`git tag v${newVersion}`.text();
  await runner`git push origin HEAD`.text();
  await runner`git push origin v${newVersion}`.text();

  const publish = Bun.spawnSync([
    "npm",
    "publish",
    "--access",
    "public",
    "--provenance",
  ]);
  if (publish.exitCode !== 0) {
    throw new Error(`npm publish failed: ${publish.stderr.toString()}`);
  }

  const notes = await buildReleaseNotes();
  await runner`gh release create v${newVersion} --title ${`v${newVersion}`} --notes ${notes.join("\n")}`.text();

  console.log(`Published ${packageJson.name}@${newVersion}`);
}

if (import.meta.main) {
  await main();
}
