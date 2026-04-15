# Simplify the audited canonical-write architecture after rollout

Status: completed
Created: 2026-04-14
Updated: 2026-04-14

## Goal

- Review the newly added audited canonical-write seam, remove avoidable abstraction or duplicated surface area, and land the cleanest composable version without regressing audit coverage.

## Success criteria

- Public audited canonical writes still route through one obvious seam.
- Audit-related types are not duplicated without a clear ownership reason.
- Callers are not forced to pass metadata the shared seam can derive mechanically.
- Verification covers the simplification work and preserves the audit drift guard.

## Scope

- In scope:
- `packages/core/src/audited-write.ts`
- `packages/core/src/markdown-documents.ts`
- direct audited-write callers and focused tests
- Out of scope:
- unrelated `apps/web/**` work already in the tree
- broad re-architecture of already-correct low-level storage primitives

## Constraints

- Keep low-level `runCanonicalWrite` / `runLoadedCanonicalWrite` as storage primitives.
- Prefer fewer concepts and clearer ownership over helper proliferation.
- Preserve the committed public audit coverage from the previous refactor.

## Tasks

1. Review the audited-write seam and its callers for duplicated types and derivable metadata.
2. Simplify the shared seam and update callers/tests accordingly.
3. Run focused verification, required audit passes if possible, and commit only the task files.

## Decisions

- Keep the public audited-write seam as a thin wrapper over `runCanonicalWrite`; do not hide staging semantics inside a second high-level batch abstraction.
- Treat audit `changes` as the richer source of truth and stop carrying parallel file lists through staged markdown writes when the seam already has the change list.
- Markdown rename writes should report both the surviving path update and the removed old path delete in one staged change list.

## Verification

- `pnpm --filter ./packages/core typecheck`
- `pnpm --filter ./packages/core test`
- `pnpm test:smoke`
- `bash scripts/workspace-verify.sh test:diff agent-docs/exec-plans/active/2026-04-14-audit-write-seam-simplify.md agent-docs/exec-plans/active/COORDINATION_LEDGER.md packages/core/src packages/core/test`

## Outcome

- Removed the duplicate markdown-specific audit input interface and reused the shared audited-write input type.
- Simplified staged markdown writes so `changes` is the complete mutation description, including old-path deletes during renames.
- Dropped redundant `files` and repeated `targetIds` plumbing from audited-write callers where the seam can already infer the necessary audit metadata.
- Core typecheck, full core tests, and smoke integrity passed.
- Diff-aware repo verification passed through all affected package owners and then hit the same unrelated pre-existing `apps/cloudflare` worker-runtime failure and `AGENTMAIL_API_BASE_URL` env-key rejection outside this task.
Completed: 2026-04-14
