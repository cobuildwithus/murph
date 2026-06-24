# PR 240 ReviewGPT round 7 retention fixes

Status: completed
Created: 2026-06-22
Updated: 2026-06-22

## Goal

- Resolve accepted ReviewGPT round-7 retention findings for PR 240 with the
  smallest durable changes in existing inbox retention, parser-job, and hosted
  maintenance owners.

## Success criteria

- Active nonterminal parser jobs protect their source media from retention until
  they are terminal.
- Missing legacy/materialized candidates do not consume retention batch capacity
  or schedule an infinite immediate wake.
- Retained parser transcripts are derived from deterministic parser artifacts
  without a second tombstone-owned pointer.
- Focused regression tests and required verification pass.

## Scope

- In scope:
  - Inbox media retention candidate selection and protection inputs.
  - Hosted runtime protection assembly.
  - Parser-derived transcript rebuild fallback.
  - Focused assistant-runtime/inboxd parser-job and retention tests.
- Out of scope:
  - New retention services, queues, schedulers, or pin state.
  - Broad base-branch CI integration beyond this PR's retention changes.

## Constraints

- Technical constraints:
  - Keep deletion the default after the 14-day lifecycle.
  - Preserve active work only while it is genuinely nonterminal.
  - Avoid adding persistent state for facts that can be derived.
- Product/process constraints:
  - Default to deletion and radical simplicity.
  - Preserve privacy guardrails and avoid local identifiers in committed artifacts.

## Risks and mitigations

1. Risk: Parser-job protections retain media forever.
   Mitigation: Protect only pending/running jobs; terminal jobs do not protect.
2. Risk: Missing candidates hide later eligible media.
   Mitigation: Count candidates against the batch only after integrity succeeds.
3. Risk: Removing the derivative pointer breaks legacy tombstones.
   Mitigation: Keep reader tolerant of old records, but use deterministic lookup as the source of truth.

## Tasks

1. Verify parser-job storage states and retention integration points.
2. Implement active parser-job protections and tests.
3. Fix missing-candidate batch accounting and tests.
4. Collapse retained parser manifest ownership and tests.
5. Run verification, commit, push, and rerun ReviewGPT.

## Decisions

- Use existing SQLite parser-job state as the protection source.
- Check parser-job protection exactly for each retainable retention candidate
  inside inbox retention rather than scanning every active parser job up front.
- Do not add a new retention queue, cursor, or durable pin.

## Progress

- Implemented:
  - Pending/running parser jobs protect candidate source bytes.
  - Missing materialized artifacts no longer consume the retention batch when
    they remain missing.
  - Retention tombstones no longer own parser-manifest pointers.
- Verified so far:
  - `pnpm --dir packages/inboxd test -- inbox-media-retention`
  - `pnpm --dir packages/assistant-runtime test -- hosted-runtime-idle-maintenance hosted-runtime-workspace-entrypoint`
  - `pnpm --dir packages/contracts test:artifacts`
  - `pnpm typecheck`
  - `pnpm test:smoke`
  - `MURPH_APP_VERIFY_PARALLEL=0 MURPH_VERIFY_STEP_PARALLEL=0 pnpm test:diff`
  - `pnpm docs:drift`
  - `git diff --check`

## Verification

- Commands to run:
  - Focused inboxd retention/parser tests.
  - Focused assistant-runtime retention protection tests.
  - `pnpm typecheck`
  - `pnpm test:smoke`
  - `MURPH_APP_VERIFY_PARALLEL=0 MURPH_VERIFY_STEP_PARALLEL=0 pnpm test:diff`
  - `pnpm docs:drift`
  - `git diff --check`
- Expected outcomes:
  - All local checks pass, or any unrelated base-branch blocker is documented with evidence.
Completed: 2026-06-22
