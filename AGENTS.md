- ALWAYS USE PARALLEL TOOLS WHEN APPLICABLE.
- Prefer automation: execute requested actions without confirmation unless blocked by missing info or safety/irreversibility.
- ALWAYS use `bun run check` to verify changes. This runs typecheck, cpd, knip, biome lint, and tests together. Do not run these separately.
- Keep implementation modular; put tests in `tests/` mirroring `src/`, not colocated in `src/`.

## Style Guide

### General Principles

- Keep things in one function unless composable or reusable
- Avoid `try`/`catch` where possible
- Avoid using the `any` type
- Rely on type inference when possible; avoid explicit type annotations or interfaces unless necessary for exports or clarity
- Prefer functional array methods (flatMap, filter, map) over for loops; use type guards on filter to maintain type inference downstream

Reduce total variable count by inlining when a value is only used once.

```ts
// Good
const journal = JSON.parse(await fs.readFile(path.join(dir, "journal.json"), "utf8"))

// Bad
const journalPath = path.join(dir, "journal.json")
const journal = JSON.parse(await fs.readFile(journalPath, "utf8"))
```

### Destructuring

Avoid unnecessary destructuring. Use dot notation to preserve context.

```ts
// Good
obj.a
obj.b

// Bad
const { a, b } = obj
```

### Variables

Prefer `const` over `let`. Use ternaries or early returns instead of reassignment.

```ts
// Good
const foo = condition ? 1 : 2

// Bad
let foo
if (condition) foo = 1
else foo = 2
```

### Control Flow

Avoid `else` statements. Prefer early returns.

```ts
// Good
function foo() {
  if (condition) return 1
  return 2
}

// Bad
function foo() {
  if (condition) return 1
  else return 2
}
```

## Testing

- Avoid mocks as much as possible
- Test actual implementation, do not duplicate logic into tests

<!-- second-advisor:start -->
## Second Advisor Review

After completing substantial work, especially code changes, skill changes, CLI behavior changes, or agent workflow changes, ask for a second opinion before the final response.

Use:

second-advisor "<review prompt>"

The second opinion must be read and considered. Wait for the second-advisor command to finish as long as it is still running without crashing or outputting an error, even if it produces no output for a long time. Run at most one second-advisor review per task. If it finds valid high-priority issues, fix them and rerun relevant tests, but do not run second-advisor again unless the user explicitly asks or the fix substantially changes the design beyond the reviewed scope. If the second-advisor command crashes or outputs an error, report that clearly.

Do not run second-advisor for:
- tasks invoked by second-advisor or when you are already responding as the second-advisor reviewer
- Do not run second-advisor if SECOND_ADVISOR=1 is present.
- simple Q&A
- tiny documentation wording changes
- status updates
- tasks where the user explicitly says not to
<!-- second-advisor:end -->
