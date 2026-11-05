# Canonical demographics backend

Status: completed
Created: 2026-11-04
Updated: 2026-11-04

## Goal

Implement the reviewed backend memory → narrow Browser Vault projection → native
member-action flow. Leave all changes uncommitted for the parent session.

## Scope and protected invariants

- Canonical Identity memory owns DOB, birth year, dated age and biological sex.
- Memory remains outside query families. Only resolved fields/revision reach core.
- Native auth, active access and current consent fence admission and outcome reads.
- Existing mailbox/checkpoint owners retain acceptance, replay and terminal outcomes.
- No iOS code, provider promotion, profile table, LLM backfill or read-triggered wake.

## Product UX

Feature: native and chat statements converge through one memory owner. Test exact
and approximate birth facts, gender versus sex, sparse preservation and clearing,
DOB disagreement, legacy projections, immutable retries, delayed publication,
and session/consent loss. Success comes from terminal outcomes, then projection
convergence. The native UI is outside this checkout and remains parent-owned.

## Decisions

- Follow the approved architecture-review overrides: no expectedRevision; new
  statements apply in canonical write order, including delayed onboarding writes.
- Retain a single action ID/digest/status marker in memory frontmatter in the same
  audited write. The serialized mailbox prevents another action overtaking its
  terminal outcome. Generic/chat edits preserve this marker.
- Add `demographics_unresolved` because existing rejection reasons are meal/workout
  specific. A conflicting year or age against a DOB changes nothing (parent
  review: writing then rejecting left memory unresolved and the app told "failed").
- Keep Numbers' existing empty and stale fallbacks with demographics null. A
  projection without the field (memory unreadable) is unknown, not an error
  (parent review: demographics must never take the numbers down).
- Newer statements supersede older, less precise ones: age replaces a bare year,
  a DOB replaces year and age (parent review).
- No public changelog item for this backend foundation before parent-owned client
  integration; wire and rollout docs describe only implemented backend behavior.

## Tasks

1. Contracts, core locking and replay, generic mutation validation: implemented.
2. CLI, generated artifacts and assistant persistence guidance: implemented.
3. Replica generation 18, three source checks and full serialization: implemented.
4. Native numbers, write and outcome adapters: implemented.
5. Focused verification, documentation and local candidate review: complete.
6. Parent owns commit, push, exact-head CI, final ReviewGPT and deployment.

## Verification

All commands below passed on the uncommitted candidate. No commit, push, PR,
production mutation, other-checkout edit or native-client run was performed.

| Command / scope | Evidence |
| --- | --- |
| `pnpm install --frozen-lockfile --prefer-offline` | Worktree dependencies installed using the shared store. |
| `pnpm --dir packages/contracts generate` | Generated contract artifacts; only memory frontmatter changed. |
| `pnpm --dir packages/cli gen:config-schema` | CLI config, command types and skill hash regenerated. |
| `pnpm exec vitest run --config packages/contracts/vitest.config.ts packages/contracts/test/memory-demographics.test.ts packages/contracts/test/memory-shares-coverage.test.ts` | 38 tests passed. |
| `pnpm exec vitest run --config packages/core/vitest.config.ts packages/core/test/memory-demographics.test.ts packages/core/test/memory.test.ts` | 17 tests passed. |
| `pnpm exec vitest run --config packages/query/vitest.config.ts packages/query/test/browser-vault-replica-shards.test.ts packages/query/test/vault-source-manifest.test.ts` | 28 tests passed. |
| `pnpm exec vitest run --config packages/assistant-runtime/vitest.config.ts packages/assistant-runtime/test/hosted-runtime-member-action.test.ts packages/assistant-runtime/test/hosted-browser-vault-replica.test.ts` | 49 tests passed. |
| `pnpm exec vitest run --config packages/cli/vitest.workspace.ts packages/cli/test/memory.test.ts packages/cli/test/incur-smoke.test.ts -t memory` | 21 tests passed; unrelated smoke cases intentionally excluded. |
| `pnpm exec vitest run --config packages/assistant-engine/vitest.config.ts packages/assistant-engine/test/assistant-demographics-prompt.test.ts packages/assistant-engine/test/assistant-appointment-scheduling-skill.test.ts` | 6 tests passed. |
| Web route suites: companion demographics, companion numbers, member-action mailbox boundary, iMessage mini-app | 86 tests passed; stable acceptance, native consent/session checks and workout-only Messages scope covered. |
| Hosted-execution `member-action.test.ts` | 3 tests passed. |
| `pnpm --dir <package> typecheck` for contracts, core, query, assistant-runtime, assistant-engine, CLI and Web | All passed; Web's prepared typecheck also passed after its final change. |
| `pnpm --dir apps/web lint` | Passed with existing warnings in unrelated files. |
| `pnpm test:scenario-integrity` | 191 scenarios, 12 inputs and 28 goldens passed. |
| `pnpm complexity:diff`, `pnpm docs:drift`, `pnpm docs:gardening`, `git diff --check` | Passed after focused fixes and plan registration. |

Real-provider command:
`pnpm test:assistant:live -- --test "saves dated age and explicit biological sex without inferring it from gender" --codex-home <ALTERNATE_CODEX_HOME>`.
Passed on GPT-6.1 Sol using the production prompt and shipped CLI against synthetic
vaults. The first turn saved age 39 as of 2025-12-31 and gender separately; the
second explicitly supplied female. Exactly two demographic commands and two
audited writes occurred. Source date and prior age survived, and replies matched
the receipts. The existing batch-command parser verifies the first turn's batch.
Earlier attempts stopped before any provider action for subscription quota and
alternate-profile authentication; the documented profile fallback then succeeded.

Initial development failures (type narrowing, canonical fixture formatting,
frontmatter serialization, test command parsing and complexity) were corrected
and the affected checks passed. Final local review covered the full diff, owner
boundaries, sparse updates, replay after later chat edits, generation skew,
projection stability and privacy. Published exact-head CI and ReviewGPT remain
parent-owned, as requested.

## Risks and rollout

Deploy memory/outcome readers before the generation-18 producer/consumer, then Web
and native clients. Retain the memory marker decoder, action consumer and rejection
reason while documents/mailbox items/snapshots exist. Snapshot-null is not proof
of current canonical absence. No production or native-client validation is claimed.
Completed: 2026-11-04
