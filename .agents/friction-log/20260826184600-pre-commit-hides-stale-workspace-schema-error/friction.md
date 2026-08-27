---
title: 'Pre-commit hides stale workspace schema error'
severity: 'minor'
issue: 'cobuildwithus/murph#2428'
---

A scoped CLI commit widened an existing workspace API and updated its only production callers. The pre-commit hook ran `packages/cli gen:config-schema` before the changed workspace dependency had been rebuilt, suppressed the generator output, and reported only that schema generation failed. A visible rerun showed the CLI build reading the dependency's stale declaration.

## Impact

The commit was valid and the hook allowed it, but diagnosing the warning required a manual generator rerun followed by the canonical prepared-runtime build and another generator rerun. The final build, schema generation, package-shape verification, and runner assembly all passed without a source workaround.

## Expected

The hook should either prepare changed workspace dependencies before building the CLI schema or surface the captured compiler error plus the canonical preparation command. It should not require product code to compensate for stale local build artifacts.

## Reproduction

1. Change a workspace API consumed by `packages/cli` so its built declaration is stale.
2. Commit the API and CLI caller together through `scripts/committer`.
3. Observe the opaque non-blocking schema-generation warning.
4. Run `pnpm --dir packages/cli gen:config-schema` to reveal the stale declaration error.
5. Run the canonical prepared-runtime verification, then rerun the generator; it passes.
