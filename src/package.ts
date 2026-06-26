import { readFileSync } from "node:fs";

export function readPackageVersion() {
  return JSON.parse(
    readFileSync(new URL("../package.json", import.meta.url), "utf8"),
  ).version as string;
}
