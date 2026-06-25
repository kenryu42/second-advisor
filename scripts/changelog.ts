#!/usr/bin/env bun
import { $ } from "bun";

type CommandRunner = (
  strings: TemplateStringsArray,
  ...values: readonly string[]
) => { text: () => Promise<string> };

async function getLatestReleasedTag(runner: CommandRunner) {
  try {
    const tag =
      await runner`gh release list --exclude-drafts --exclude-pre-releases --limit 1 --json tagName --jq '.[0].tagName // empty'`.text();
    return tag.trim() || null;
  } catch {
    return null;
  }
}

async function generateChangelog(
  previousTag: string | null,
  runner: CommandRunner,
) {
  let log: string;
  try {
    log = previousTag
      ? await runner`git log ${previousTag}..HEAD --oneline --format="%h %s"`.text()
      : await runner`git log HEAD --oneline --format="%h %s"`.text();
  } catch {
    try {
      log = await runner`git log HEAD --oneline --format="%h %s"`.text();
    } catch {
      return [];
    }
  }

  return log
    .split("\n")
    .filter(Boolean)
    .map((commit) => `- ${commit}`);
}

export async function buildReleaseNotes(runner: CommandRunner = $) {
  const previousTag = await getLatestReleasedTag(runner);
  const changelog = await generateChangelog(previousTag, runner);

  return changelog.length > 0 ? changelog : ["No changes in this release"];
}

if (import.meta.main) {
  const notes = await buildReleaseNotes();
  console.log(notes.join("\n"));
}
