# Refactor core public canonical writes onto one audited mutation seam

Status: completed
Created: 2026-04-14
Updated: 2026-04-14

## Goal

- Make public canonical mutations in `packages/core` emit audit records through one obvious seam instead of relying on optional per-call auditing or raw `runCanonicalWrite` usage.

## Success criteria

- `packages/core` exposes one small audited public-write helper that owns `emitAuditRecord` for generic canonical mutations.
- Remaining public mutation surfaces that currently skip audit emission are migrated to that audited seam or to audited markdown helpers.
- Tests cover the refactored seam and at least one representative mutation from each migrated pattern family.
- Required scoped verification and completion-workflow audits pass, or any unrelated pre-existing blocker is documented.

## Scope

- In scope:
- `packages/core/src/public-mutations.ts`
- Public mutation owners in `packages/core` that currently write canonically without an audit record
- Matching audit action constants and focused tests
- Out of scope:
- Changes under `apps/web/**` and other unrelated in-flight work
- Rewriting low-level storage primitives to auto-audit every write

## Constraints

- Technical constraints:
- Keep `runCanonicalWrite` / `runLoadedCanonicalWrite` as low-level storage helpers.
- Minimize new abstraction count; prefer one audited commit helper plus small call-site updates.
- Product/process constraints:
- Preserve existing mutation behavior and audit semantics where already correct.
- Do not revert or interfere with unrelated worktree changes.

## Risks and mitigations

1. Risk: introducing double-audit behavior by layering the new seam on top of already-audited writes.
   Mitigation: migrate only currently unaudited public seams and leave already-audited owners on their existing explicit pattern unless consolidation is clearly behavior-preserving.
2. Risk: broad refactor touches many mutation families.
   Mitigation: centralize the helper first, then migrate callers mechanically and verify with focused tests covering each family.

## Tasks

1. Add a small audited public canonical write helper and tighten markdown delete/write helpers around required audit metadata for public callers.
2. Migrate remaining unaudited public mutation owners in preferences, memory, journal, experiments, vault summary, inbox promotion, and registry deletes.
3. Add any missing audit actions and focused regression tests.
4. Run scoped verification, required audit passes, and commit only the touched paths.

## Decisions

- Audit belongs at the public mutation owner seam, not inside low-level storage primitives.
- Generic exported public write helpers should require explicit audit metadata instead of silently writing unaudited records.

## Verification

- Commands to run:
- `pnpm typecheck`
- `bash scripts/workspace-verify.sh test:diff agent-docs/exec-plans/active/2026-04-14-audit-write-seam.md agent-docs/exec-plans/active/COORDINATION_LEDGER.md packages/contracts/src/constants.ts packages/contracts/generated/audit-record.schema.json packages/core/src packages/core/test packages/inboxd/src/indexing/persist.ts packages/inboxd/test/inboxd.test.ts packages/vault-usecases/src/usecases/workout-import.ts packages/vault-usecases/src/usecases/types.ts packages/assistant-engine/src/knowledge/service.ts packages/assistant-engine/test/assistant-knowledge-thresholds.test.ts packages/cli/src/review-gpt-runtime.ts packages/cli/test/assistant-service.test.ts packages/cli/test/review-gpt-runtime-process.test.ts`
- `pnpm test:smoke`
- Required completion-workflow audit passes: `coverage-write` and `task-finish-review`
- Expected outcomes:
- Scoped package coverage and root typecheck pass for the touched owners.
- Direct audit-path regressions are covered by focused tests.

## Outcome

- Added `packages/core/src/audited-write.ts` as the shared public audited canonical-write seam.
- Migrated public mutation helpers, audited markdown helpers, registry deletes, inbox capture persistence, workout import batching, and knowledge/research note batching to require explicit audit metadata.
- Added a drift-guard test blocking new direct public `runCanonicalWrite` usage outside an allowlist.
- Focused and scoped verification passed for touched owners and smoke integrity passed.
- Remaining verification blockers were unrelated pre-existing failures outside this task:
- `pnpm typecheck` failed in `apps/web` with local dirty-tree errors in `hosted-phone-auth-support.ts` and `hosted-onboarding-privy-service.test.ts`.
- `bash scripts/workspace-verify.sh test:diff ...` reached `apps/cloudflare` and failed an unrelated worker runtime expectation in `apps/cloudflare/test/workers/runtime.test.ts` plus an env-key rejection for `AGENTMAIL_API_BASE_URL`.
Completed: 2026-04-14
