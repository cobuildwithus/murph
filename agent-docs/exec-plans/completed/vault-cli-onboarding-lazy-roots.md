# Vault CLI Onboarding Lazy Roots

## Goal

Extend the existing fail-closed vault CLI lazy-root path to the common onboarding and assistant-read command families approved for this PR.

Success criteria:

- Approved roots classify as scoped without inspecting nested command tokens.
- Each scoped root mounts only the existing owning registrar and then lets Incur parse the original argv.
- Root discovery, unknown roots, completion environments, setup routing, and installed Incur skills still fall back to the full command graph.
- CLI package coverage, typecheck, and direct built-CLI scenario checks pass or have an unrelated blocker called out.

## Scope

Expected production files:

- `packages/cli/src/vault-cli-routing.ts`
- `packages/cli/src/vault-cli-command-routing.ts`
- `packages/cli/src/vault-cli-inbox-services.ts`
- `packages/cli/src/vault-cli.ts`

Expected test files:

- `packages/cli/test/vault-cli-routing.test.ts`
- `packages/cli/test/vault-cli-command-routing.test.ts`
- `packages/cli/test/cli-entry.test.ts`
- `packages/cli/test/vault-cli-wiring.test.ts`

No new service, daemon, cache, custom parser, persisted state, dependency, or configuration is planned.

## Design

Keep the existing boundary:

- classify only the first effective root token after known global flags and vault override extraction;
- never inspect command-specific flags or nested command names;
- never rewrite argv;
- mount existing Incur command groups through their current registrar functions;
- fall back to the full eager graph whenever routing is uncertain.
- keep shared default inbox-service wiring in one lightweight module so lazy `assistant` and the full builder stay semantically aligned without importing the full command graph.

Approved roots:

- `assistant`
- `automation`
- `blood-test`
- `goal`
- `list`
- `measurement`
- `memory`
- `protocol`
- `query`
- `regimen`
- `search`
- `show`
- `supplement`
- `timeline`
- `wearables`

Multi-root families should map to their existing shared registrars:

- `show` / `list` -> read commands
- `search` / `query` / `timeline` -> search commands
- `regimen` / `protocol` -> protocol commands

Top-level assistant shortcuts such as `chat`, `run`, `status`, `doctor`, and `stop` stay full-fallback for this follow-up unless a measured need proves alias routing should be added separately.

## Verification Plan

- Focused CLI routing tests.
- `pnpm --dir packages/cli verify:coverage`
- `pnpm typecheck`
- Direct built CLI scenarios for representative new roots.
- `git diff --check`

## Open Questions

- None.
Status: completed
Updated: 2026-06-05
Completed: 2026-06-05
