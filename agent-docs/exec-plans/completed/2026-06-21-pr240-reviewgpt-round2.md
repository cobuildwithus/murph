# PR 240 ReviewGPT round 2 fixes

Status: completed
Created: 2026-06-21
Updated: 2026-06-21

## Goal

- Resolve accepted ReviewGPT round-2 findings for PR 240 without adding new lifecycle services, queues, or stores. Preserve the 14-day inbox media policy while keeping attachment descriptors, retained parser derivatives, and active assistant work safe.

## Success criteria

- Accepted findings have focused regression proof or a documented simplification proof.
- Retention failures schedule a bounded retry wake instead of leaving expired bytes indefinitely.
- Retention protects unresolved assistant input media using existing input evidence, not a new pin store.
- Vault validation loads inbox retention tombstones once per validation pass.
- Any parser-derivative rebuild fix stays inside existing inbox/parser projection ownership and does not make derived transcripts canonical.
- Focused package tests, typechecks, diff checks, and the PR ReviewGPT loop pass before handoff.

## Scope

- In scope:
  - `packages/inboxd` retention and projection rebuild behavior.
  - `packages/core` vault validation of retention-expired inbox media.
  - `packages/assistant-runtime` idle maintenance wake/protection behavior.
  - Focused regression tests for accepted findings.
- Out of scope:
  - New retention schedulers, hosted cron jobs, durable pin stores, or sensitivity-based indefinite retention.
  - Broad parser runtime redesign or making derived transcript artifacts canonical health records.

## Constraints

- Technical constraints:
  - Canonical vault writes stay core-owned.
  - Raw inbox media deletion remains tombstone-backed and idempotent.
  - Assistant foreground work must not wait on idle retention.
  - Projection rebuild must remain derivable from canonical inbox captures, raw inbox envelopes, and retention records.
- Product/process constraints:
  - Default to deletion and radical simplicity.
  - Privacy wins should not silently discard durable descriptors, hashes, message relationships, transcripts, or active-turn evidence.

## Risks and mitigations

1. Risk: Retention fixes grow into a second scheduling or pinning subsystem.
   Mitigation: Reuse existing next-wake metadata and existing assistant input evidence only.
2. Risk: Parser derivative hydration treats derived transcript files as canonical.
   Mitigation: Keep hydration projection-only and sourced from explicit retention tombstone derivative metadata.
3. Risk: Validation optimization changes fail-closed behavior.
   Mitigation: Preserve the exact tombstone match key: capture id, attachment id, and stored path.

## Tasks

1. Triage each round-2 finding against the real code path.
2. Add focused regression tests for accepted bugs and direct proof for simplifications.
3. Implement the smallest fixes at existing owner boundaries.
4. Run focused package tests, typechecks, and required repo checks.
5. Finish the plan, commit, push, and run the next ReviewGPT PR round.

## Decisions

- Accepted the parser-derivative rebuild finding. The fix is projection-only: when a retention tombstone points at a parser manifest, runtime rebuild may rehydrate searchable transcript/extracted text from the retained derivative without making that derivative canonical evidence.
- Accepted the transient-retention-failure finding. Idle maintenance remains fail-open, but a non-abort retention error now returns a bounded five-minute `inbox_media_retention` wake so cleanup retries without adding a scheduler.
- Accepted the pending-assistant-work protection finding. Hosted idle maintenance now derives protection IDs/paths from existing pending assistant input evidence and passes them into retention; there is no new durable pin store.
- Accepted the core validation repeated-parse finding as simplification work. Validation now builds the retention tombstone index once per inbox-capture validation pass and keeps the exact match key of capture id, attachment id, and stored path.

## Verification

- Commands to run:
  - Focused Vitest tests for changed owners.
  - `pnpm --filter @murphai/inboxd typecheck`
  - `pnpm --filter @murphai/core typecheck`
  - `pnpm --filter @murphai/assistant-runtime typecheck`
  - `pnpm typecheck`
  - `pnpm test:diff`
  - `pnpm test:smoke`
  - `git diff --check`
  - Privacy diff scan.
  - Next `pnpm review:gpt pr-review` round after push.
- Expected outcomes:
  - All required checks pass or any failure is proven unrelated.
  - ReviewGPT reaches zero accepted findings before merge-ready handoff.
Completed: 2026-06-21
