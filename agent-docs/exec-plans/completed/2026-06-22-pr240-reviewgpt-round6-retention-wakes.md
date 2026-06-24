# PR 240 ReviewGPT round 6 retention wake fixes

Status: completed
Created: 2026-06-22
Updated: 2026-06-22

## Goal

- Fix ReviewGPT round 6 retention correctness findings in PR 240 without adding a scheduler, service, config surface, or new retention owner.

## Success criteria

- Timer-only `inbox_media_retention` wakes run the existing idle-maintenance/checkpoint path once and clear or replace the due wake.
- Inbox media retention runs even when Codex compaction is skipped for imminent member-visible work.
- Active pending assistant inputs protect their entire inbox capture when attachment evidence is absent or failed.
- Retained audio/video transcripts can be rebuilt from deterministic derived parser artifacts even when the tombstone lacks a manifest pointer.
- Focused regression tests, typecheck, smoke/diff verification, and required completion audits pass or have a documented unrelated blocker.

## Scope

- In scope:
  - Hosted runtime wake/idle-maintenance control flow.
  - Inbox media retention protection inputs.
  - Retained parser projection rebuild fallback.
  - Focused tests for the ReviewGPT findings.
- Out of scope:
  - New retention schedules/services.
  - New durability policy rules.
  - Retention ledger schema churn unless required by tests.

## Constraints

- Technical constraints:
  - Keep the policy automatic and bounded.
  - Preserve existing checkpoint, wake, and retention primitives.
  - Do not retain sensitive media indefinitely.
- Product/process constraints:
  - Default to deletion and radical simplicity.
  - Preserve privacy guardrails and avoid local identifiers in committed artifacts.

## Risks and mitigations

1. Risk: Due retention wakes are re-committed and loop forever.
   Mitigation: Treat due retention as maintenance work, not as a projected future wake.
2. Risk: Pending inputs lose attachments when evidence enrichment fails.
   Mitigation: Protect by capture id as well as attachment/path.
3. Risk: Legacy restore order loses transcripts.
   Mitigation: Rebuild parser projection by deterministic derived path lookup when tombstones omit the pointer.

## Tasks

1. Patch hosted runtime due-retention wake and pending-work retention flow.
2. Add capture-level pending input protections.
3. Add deterministic retained parser manifest fallback.
4. Add focused regression tests.
5. Run verification, audits, commit, and push.

## Decisions

- Do not add hosted automation or a separate retention service; keep retention as idle checkpoint maintenance.
- Do not make `retainedDerivative` a required source of transcript truth; it remains a sidecar hint, and rebuild can derive the manifest path.

## Verification

- Focused tests passed:
  - `pnpm --filter @murphai/inboxd exec vitest run test/inbox-media-retention.test.ts --config vitest.config.ts --no-coverage`
  - `pnpm --filter @murphai/assistant-runtime exec vitest run test/hosted-runtime-idle-maintenance.test.ts test/hosted-runtime-workspace-entrypoint.test.ts --config vitest.config.ts --no-coverage`
- Full required verification passed:
  - `pnpm typecheck`
  - `pnpm test:smoke`
  - `MURPH_APP_VERIFY_PARALLEL=0 MURPH_VERIFY_STEP_PARALLEL=0 pnpm test:diff`
  - `pnpm docs:drift`
  - `git diff --check`
- Completion audits:
  - Coverage review found no additional test gap.
  - Security/privacy review found a pre-commit/commit-to-delete abort ordering risk; retention now checks cancellation before tombstone append and keeps post-commit deletes non-cancellable.
  - Deep review found pending-work retention could exceed the intended small slice; pending-work retention is now capped before hashing the next eligible attachment and covered by regression tests.

## Outcome

- Due committed `inbox_media_retention` wakes now enter the existing idle checkpoint maintenance path even when mailbox and assistant work make no progress.
- Pending-work checkpoints run only a one-attachment retention slice before skipping Codex compaction.
- Active pending assistant inputs protect their capture id when attachment evidence is missing or failed.
- Retained parser projection rebuilds can recover transcripts from the deterministic derived parser subtree when the tombstone lacks a manifest pointer.
Completed: 2026-06-22
