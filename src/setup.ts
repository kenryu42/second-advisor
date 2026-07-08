import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const secondAdvisorStartMarker = "<!-- second-advisor:start -->";
const secondAdvisorEndMarker = "<!-- second-advisor:end -->";

const secondAdvisorReviewContent = `## Second Advisor Review

Use second-advisor selectively. For complex or high-risk work, ask for a second opinion before the final response. This is most useful for non-obvious design choices, broad code changes, agent workflow changes, security-sensitive behavior, repeated test/debug failures, or situations where you are uncertain about the approach.

Do not run second-advisor merely because a task includes code edits. For straightforward, localized changes with clear requirements and passing verification, finish normally.

Use:

second-advisor "<review prompt>"

The second opinion must be read and considered. Wait for the second-advisor command to finish as long as it is still running without crashing or outputting an error, even if it produces no output for a long time. Run at most one second-advisor review per task. If it finds valid high-priority issues, fix them and rerun relevant tests, but do not run second-advisor again unless the user explicitly asks or the fix substantially changes the design beyond the reviewed scope. If the second-advisor command crashes or outputs an error, report that clearly.

Do not run second-advisor for:
- tasks invoked by second-advisor or when you are already responding as the second-advisor reviewer
- Do not run second-advisor if SECOND_ADVISOR=1 is present.
- simple Q&A
- tiny documentation wording changes
- status updates
- tasks where the user explicitly says not to`;

export const secondAdvisorReviewBlock = `${secondAdvisorStartMarker}
${secondAdvisorReviewContent}
${secondAdvisorEndMarker}`;

type TextRange = {
  start: number;
  end: number;
};

type SetupUpdate = {
  file: string;
  diff: string;
};

type SetupError = {
  file: string;
  message: string;
};

type SetupResult = {
  updated: SetupUpdate[];
  skipped: string[];
  errors: SetupError[];
};

type SetupFileResult =
  | { kind: "updated"; oldContent: string; content: string }
  | { kind: "skipped" }
  | { kind: "error"; message: string };

export type SetupOptions = {
  remove?: boolean;
};

const agentInstructionFiles = ["AGENTS.md", "CLAUDE.md"] as const;

export async function setupSecondAdvisorReview(
  cwd = process.cwd(),
  options: SetupOptions = {},
): Promise<SetupResult> {
  const files = agentInstructionFiles
    .map((file) => path.join(cwd, file))
    .filter((file) => existsSync(file));

  const changes = await Promise.all(
    files.map(async (file) => ({
      file: path.basename(file),
      result: await setupSecondAdvisorReviewFile(file, options),
    })),
  );

  return {
    updated: changes
      .filter((change) => change.result.kind === "updated")
      .map((change) => ({
        file: change.file,
        diff:
          change.result.kind === "updated"
            ? formatSetupDiff(
                change.file,
                change.result.oldContent,
                change.result.content,
                false,
              )
            : "",
      })),
    skipped: changes
      .filter((change) => change.result.kind === "skipped")
      .map((change) => change.file),
    errors: changes
      .filter((change) => change.result.kind === "error")
      .map((change) => ({
        file: change.file,
        message: change.result.kind === "error" ? change.result.message : "",
      })),
  };
}

async function setupSecondAdvisorReviewFile(
  file: string,
  options: SetupOptions,
) {
  const content = await readFile(file, "utf8");
  const result = options.remove
    ? removeSecondAdvisorReviewBlock(content)
    : applySecondAdvisorReviewBlock(content);
  if (result.kind !== "updated") return result;
  await writeFile(file, result.content);
  return result;
}

function appendReviewBlock(content: string) {
  const separator =
    content.length === 0
      ? ""
      : content.endsWith("\n\n")
        ? ""
        : content.endsWith("\n")
          ? "\n"
          : "\n\n";
  return `${content}${separator}${secondAdvisorReviewBlock}\n`;
}

function applySecondAdvisorReviewBlock(content: string): SetupFileResult {
  return updateSecondAdvisorReviewBlock(
    content,
    replaceSecondAdvisorBlock,
    () => ({
      kind: "updated",
      oldContent: content,
      content: appendReviewBlock(content),
    }),
  );
}

function removeSecondAdvisorReviewBlock(content: string): SetupFileResult {
  const ranges = findRemovableSecondAdvisorBlocks(content);
  if (ranges.length === 0) return { kind: "skipped" };
  return createUpdatedContent(
    content,
    ranges
      .sort((left, right) => right.start - left.start)
      .reduce(
        (updated, range) => removeSecondAdvisorRangeContent(updated, range),
        content,
      ),
  );
}

function updateSecondAdvisorReviewBlock(
  content: string,
  update: (content: string, range: TextRange) => SetupFileResult,
  missing: () => SetupFileResult,
): SetupFileResult {
  const block = findSecondAdvisorBlock(content);
  if (block === "malformed") return malformedSecondAdvisorMarkers();
  if (block) return update(content, block);
  return missing();
}

function createUpdatedContent(
  oldContent: string,
  content: string,
): SetupFileResult {
  return {
    kind: "updated",
    oldContent,
    content,
  };
}

function findSecondAdvisorBlock(content: string) {
  const managedBlock = findManagedBlock(content);
  if (managedBlock) return managedBlock;
  return findLegacySecondAdvisorBlock(content);
}

function malformedSecondAdvisorMarkers() {
  return {
    kind: "error" as const,
    message: "Malformed second-advisor managed block markers.",
  };
}

function replaceSecondAdvisorBlock(content: string, range: TextRange) {
  if (content.slice(range.start, range.end) === secondAdvisorReviewBlock) {
    return { kind: "skipped" as const };
  }

  return createUpdatedContent(
    content,
    content.slice(0, range.start) +
      secondAdvisorReviewBlock +
      getReplacementSeparator(content.slice(range.end)) +
      content.slice(range.end),
  );
}

function removeSecondAdvisorRangeContent(content: string, range: TextRange) {
  const before = content.slice(0, range.start).replace(/\n+$/, "");
  const after = content.slice(range.end).replace(/^\n+/, "");
  const result =
    before.length > 0 && after.length > 0
      ? `${before}\n\n${after}`
      : `${before}${after}`;
  if (result.length > 0 && content.endsWith("\n") && !result.endsWith("\n")) {
    return `${result}\n`;
  }
  return result;
}

function getReplacementSeparator(after: string) {
  if (after.length === 0) return "\n";
  if (after.startsWith("\n\n")) return "";
  if (after.startsWith("\n")) return "\n";
  return "\n\n";
}

function findManagedBlock(content: string) {
  const start = content.indexOf(secondAdvisorStartMarker);
  const end = content.indexOf(secondAdvisorEndMarker);
  if (start === -1 && end === -1) return undefined;
  if (
    start === -1 ||
    end === -1 ||
    end < start ||
    content.indexOf(secondAdvisorStartMarker, start + 1) !== -1 ||
    content.indexOf(secondAdvisorEndMarker, end + 1) !== -1
  ) {
    return "malformed" as const;
  }
  return { start, end: end + secondAdvisorEndMarker.length };
}

function findLegacySecondAdvisorBlock(content: string) {
  return findLegacySecondAdvisorBlocks(content)[0];
}

function findRemovableSecondAdvisorBlocks(content: string) {
  const managedBlocks = findCompleteManagedBlocks(content);
  const legacyBlocks = findLegacySecondAdvisorBlocks(content)
    .filter((range) => !startsInsideAnyRange(range, managedBlocks))
    .map((range) => expandRangeToPrecedingStartMarker(content, range));
  const markerBlocks = [
    ...findMarkerRanges(content, secondAdvisorStartMarker),
    ...findMarkerRanges(content, secondAdvisorEndMarker),
  ].filter(
    (range) => !isInsideAnyRange(range, [...managedBlocks, ...legacyBlocks]),
  );
  return mergeRanges([...managedBlocks, ...legacyBlocks, ...markerBlocks]);
}

function findCompleteManagedBlocks(content: string) {
  return [...content.matchAll(managedBlockPattern())].map((match) => ({
    start: match.index,
    end: match.index + match[0].length,
  }));
}

function findLegacySecondAdvisorBlocks(content: string) {
  return [...content.matchAll(/^## Second Advisor Review$/gm)].map((match) => {
    const afterHeading = match.index + match[0].length;
    const nextHeading = content.slice(afterHeading).search(/\n## /);
    return {
      start: match.index,
      end:
        nextHeading === -1
          ? content.length
          : afterHeading + nextHeading + "\n".length,
    };
  });
}

function expandRangeToPrecedingStartMarker(content: string, range: TextRange) {
  const start = content.lastIndexOf(secondAdvisorStartMarker, range.start);
  if (
    start === -1 ||
    content.slice(start + secondAdvisorStartMarker.length, range.start).trim()
      .length > 0
  ) {
    return range;
  }
  return { start, end: range.end };
}

function findMarkerRanges(content: string, marker: string) {
  return [...content.matchAll(new RegExp(escapeRegExp(marker), "g"))].map(
    (match) => ({
      start: match.index,
      end: match.index + marker.length,
    }),
  );
}

function isInsideAnyRange(range: TextRange, ranges: TextRange[]) {
  return ranges.some(
    (candidate) => range.start >= candidate.start && range.end <= candidate.end,
  );
}

function startsInsideAnyRange(range: TextRange, ranges: TextRange[]) {
  return ranges.some(
    (candidate) =>
      range.start >= candidate.start && range.start < candidate.end,
  );
}

function mergeRanges(ranges: TextRange[]) {
  const merged: TextRange[] = [];
  ranges
    .sort((left, right) => left.start - right.start)
    .forEach((range) => {
      const last = merged.at(-1);
      if (!last || range.start > last.end) {
        merged.push(range);
        return;
      }
      last.end = Math.max(last.end, range.end);
    });
  return merged;
}

function managedBlockPattern() {
  return new RegExp(
    escapeRegExp(secondAdvisorStartMarker) +
      "[\\s\\S]*?" +
      escapeRegExp(secondAdvisorEndMarker),
    "g",
  );
}

function escapeRegExp(value: string) {
  return [
    "\\",
    ".",
    "*",
    "+",
    "?",
    "^",
    "$",
    "{",
    "}",
    "(",
    ")",
    "|",
    "[",
    "]",
  ].reduce(
    (escaped, character) => escaped.replaceAll(character, `\\${character}`),
    value,
  );
}

export function formatSetupDiff(
  fileName: string,
  oldContent: string,
  newContent: string,
  color = shouldUseColor(),
) {
  const oldLines = splitDiffLines(oldContent);
  const newLines = splitDiffLines(newContent);
  const prefixLength = getCommonPrefixLength(oldLines, newLines);
  const suffixLength = getCommonSuffixLength(
    oldLines.slice(prefixLength),
    newLines.slice(prefixLength),
  );
  const context = 3;
  const hunkStart = Math.max(0, prefixLength - context);
  const oldChangeEnd = oldLines.length - suffixLength;
  const newChangeEnd = newLines.length - suffixLength;
  const oldHunkEnd = Math.min(oldLines.length, oldChangeEnd + context);
  const newHunkEnd = Math.min(newLines.length, newChangeEnd + context);

  return [
    colorDiffLine(`--- ${fileName}`, color),
    colorDiffLine(`+++ ${fileName}`, color),
    colorDiffLine(
      "@@ -" +
        (hunkStart + 1) +
        "," +
        (oldHunkEnd - hunkStart) +
        " +" +
        (hunkStart + 1) +
        "," +
        (newHunkEnd - hunkStart) +
        " @@",
      color,
    ),
    ...oldLines.slice(hunkStart, prefixLength).map((line) => ` ${line}`),
    ...oldLines
      .slice(prefixLength, oldChangeEnd)
      .map((line) => colorDiffLine(`-${line}`, color)),
    ...newLines
      .slice(prefixLength, newChangeEnd)
      .map((line) => colorDiffLine(`+${line}`, color)),
    ...oldLines.slice(oldChangeEnd, oldHunkEnd).map((line) => ` ${line}`),
  ].join("\n");
}

function splitDiffLines(content: string) {
  if (content.length === 0) return [];
  if (content.endsWith("\n")) return content.slice(0, -1).split("\n");
  return content.split("\n");
}

function getCommonPrefixLength(left: string[], right: string[]) {
  const mismatch = left.findIndex((line, index) => line !== right[index]);
  return mismatch === -1 ? Math.min(left.length, right.length) : mismatch;
}

function getCommonSuffixLength(left: string[], right: string[]) {
  const maxLength = Math.min(left.length, right.length);
  const mismatch = Array.from({ length: maxLength }).findIndex(
    (_, index) =>
      left[left.length - index - 1] !== right[right.length - index - 1],
  );
  return mismatch === -1 ? maxLength : mismatch;
}

function shouldUseColor() {
  return process.stdout.isTTY && !("NO_COLOR" in process.env);
}

export function colorSetupDiff(diff: string) {
  return diff
    .split("\n")
    .map((line) => colorDiffLine(line, shouldUseColor()))
    .join("\n");
}

function colorDiffLine(line: string, color: boolean) {
  if (!color) return line;
  if (line.startsWith("@@")) return `\u001b[36m${line}\u001b[0m`;
  if (line.startsWith("--- ") || line.startsWith("+++ ")) return line;
  if (line.startsWith("+")) return `\u001b[32m${line}\u001b[0m`;
  if (line.startsWith("-")) return `\u001b[31m${line}\u001b[0m`;
  return line;
}
