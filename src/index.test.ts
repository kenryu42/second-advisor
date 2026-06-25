import { expect, test } from "bun:test";
import { greet } from "./index.js";

test("greets by name", () => {
  expect(greet("Bun")).toBe("Hello, Bun.");
});
