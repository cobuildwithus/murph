# Vault CLI Error Final Findings

Status: completed
Owner: Codex
Started: 2026-08-24

## Outcome

- Preserve owner-authored repair metadata while recovering only bounded,
  value-free fields from established Zod-like validation issues.
- Return the direct projected object for ordinary pre-serve JSON modes and
  reserve the full-output envelope for explicit full-output requests.

## Scope

- Keep explicit `VaultCliError.repair` as the authoritative repair channel.
- When explicit repair is absent, map only the established
  `VaultCliError.context.issues` array and escaped raw Zod errors through one
  shared bounded normalizer.
- Allowlist issue path, code, and expected metadata; ignore raw messages,
  received values, submitted values, and unrelated context.
- Preserve the directly consumed `createVaultCliRepair` helper while removing
  any production or test path that normalizes the same issue set twice.
- Derive every pre-serve machine representation from one projected body.

## Product UX Patch

- Outcome: an assistant receives one safe, correctly shaped error document it
  can use to repair supported CLI calls without guessing or leaking inputs.
- Reaches: existing individual and hosted-group turns using main or setup CLI
  validation and pre-serve failure paths.
- Proof: built CLI reproductions cover three domain owners, bounded issue
  omission, duplicate output flags, nonzero exits, and secret-safe output.

## Verification

- Focused operator-config, setup-cli, assistant-engine, CLI, inbox-seam, and
  Cloudflare runner bundle/parity tests.
- Affected package typechecks, CLI package-shape proof, workspace-boundary
  proof, built production-path scenarios, privacy scan, diff check, and
  provider-input no-change proof.
- Close with `scripts/finish-task`; do not push, mutate PR metadata, or start
  ReviewGPT.

## Progress

- Accepted old-head findings and parent dispositions supplied.
- Worktree ownership, clean candidate head, and Frog inventory verified.
- A task-owned ReviewGPT wake process unexpectedly edited this worktree; the
  coordinator proved its exact process ownership, terminated it, and restored
  exclusive ownership before reconciliation continued.
- Existing Frog entry `20260817153820-reviewgpt-wake-reports` already records
  the exact orphaned-child/second-writer failure, so no duplicate was created.
- Mixed hunks reconciled: the explicit repair API and precedence remain, while
  inferred Zod repair and direct-versus-envelope transport are narrowly added.
- Focused and built-path regressions pass. The first runner-bundle attempt
  exposed duplicated mapper machinery; collapsing onto the existing repair
  normalizer brought the production bundle back under its unchanged budget.
- Final focused proof passed: operator-config 26 tests, setup 33, assistant 15,
  CLI 94, inbox seams 10, and runner-bundle contracts 14. Six affected package
  typechecks, CLI package shape, workspace boundaries/cycles, and built
  production-path scenarios also passed.
- The production runner bundle and all parity probes passed at 9,467,564 bytes
  of 9,467,648, with the entry and static-startup-closure budgets unchanged.
- This remediation changes no assistant prompt or other provider-input surface,
  so the candidate's prior identical-fixture measurement remains current:
  individual +87 tokens/+414 bytes and group +87 tokens/+414 bytes, all in
  assembled instructions and none in tools or other provider-visible fields.
- Privacy, unsafe-cast, whitespace, package-shape, and source-boundary scans
  passed.

Updated: 2026-08-24
Completed: 2026-08-24
