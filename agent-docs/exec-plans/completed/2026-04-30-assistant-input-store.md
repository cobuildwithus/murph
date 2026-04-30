# Implement durable assistant input store

Status: completed
Created: 2026-04-30
Updated: 2026-04-30

## Goal

- Land Batch 2 of the hosted assistant input migration: add a durable,
  assistant-engine-owned input-event store under assistant runtime state so
  decoded hosted events can later be staged before inbox projection.

## Success criteria

- Versioned assistant input event records can be upserted, read, listed by
  source/conversation/source-position cursor, and have projection status
  updated.
- The store is source-agnostic and does not import hosted-runtime wake types.
- Hosted mailbox identity is first-class at the envelope level without
  importing hosted-runtime wake payload types.
- Replay is idempotent by deterministic `inputId` and immutable source/content
  identity; conflicting replays fail closed.
- Tests prove projection failure remains listable and projection success can
  attach a capture id.
- Hosted-runtime, scanner, reply, evidence, and accepted-input journal behavior
  remain unchanged in this batch.

## Scope

- In scope:
  - New assistant-engine input-store module.
  - Minimal exports through the existing assistant automation surface.
  - Focused assistant-engine store tests.
  - Small additive refinements to `input-source.ts` only if needed to consume
    stored records later.
- Out of scope:
  - Hosted mailbox ingest or cursor changes.
  - Runtime-state descriptor changes.
  - Scanner/reply/active-turn migration to stored input events.
  - Accepted-input journal/evidence schema changes.
  - Inbox projection demotion.

## Constraints

- Technical constraints:
  - Assistant-engine must remain source-agnostic and must not import
    hosted-runtime wake types.
  - Do not persist provider payloads, ciphertext, raw EML bytes, signed URLs,
    local filesystem paths, auth headers, or prompt/provider request bodies.
  - Store only minimized prompt-ready text/content descriptors needed for later
    assistant admission.
  - Use existing assistant state paths and permission helpers.
- Product/process constraints:
  - Preserve unrelated dirty-tree work, especially shared ledger edits and the
    active local import removal lane.
  - Keep this batch narrow enough for a scoped commit.

## Risks and mitigations

1. Risk: The durable store becomes hosted-runtime-shaped.
   Mitigation: Keep source refs envelope-only. The store knows mailbox item
   identity and ordering, but hosted wake decoding/mapping stays in later
   assistant-runtime adapter batches.
2. Risk: The store persists too much user/provider content.
   Mitigation: Explicitly reject local paths and keep stored fields to
   minimized text, content parts, attachment descriptors, source refs, and
   projection metadata.
3. Risk: This batch changes live assistant behavior.
   Mitigation: Add the store beside existing capture-based paths and do not
   wire scanner/reply/runtime consumers yet.

## Tasks

1. Inspect existing assistant state path and atomic JSON helpers.
2. Add input-event record schema, id helpers, upsert/read/list/update APIs.
3. Export the store through the assistant automation barrel.
4. Add focused tests for idempotency, conflict, listing, projection updates,
   corrupt records, and path/privacy guardrails.
5. Run focused verification and required audits, including the requested
   three-subagent stress review against the canonical plan.
6. Close plan and commit scoped changes if safe.

## Decisions

- Durable input events live in assistant runtime operational state, not
  canonical vault truth. They are replay/admission state for hosted and local
  automation; canonical inbox remains a projection until later migration
  batches demote it.
- Projection state uses source-neutral lifecycle statuses:
  `not_attempted`, `pending`, `succeeded`, `failed`, and `quarantined`.
  Inbox/runtime-only persistence labels are projection details, not durable
  assistant-input truth.

## Verification

- Commands to run:
  - `pnpm --dir packages/assistant-engine typecheck`
  - `pnpm --dir packages/assistant-engine exec tsc -p tsconfig.json --noEmit --pretty false`
  - `pnpm --dir packages/assistant-engine exec vitest run --config vitest.config.ts --no-coverage test/assistant-input-store.test.ts test/assistant-input-source.test.ts`
  - `git diff --check -- packages/assistant-engine/src/assistant/input-store.ts packages/assistant-engine/src/assistant/input-source.ts packages/assistant-engine/src/assistant/automation.ts packages/assistant-engine/test/assistant-input-store.test.ts packages/assistant-engine/test/assistant-input-source.test.ts agent-docs/exec-plans/completed/2026-04-30-assistant-input-store.md agent-docs/exec-plans/active/COORDINATION_LEDGER.md`
- Expected outcomes:
  - Focused assistant-engine checks pass or unrelated blockers are documented.
  - Diff has no whitespace errors.

## Actual outcomes

- `pnpm --dir packages/assistant-engine typecheck` passed.
- `pnpm --dir packages/assistant-engine exec tsc -p tsconfig.json --noEmit --pretty false` passed.
- Focused `assistant-input-store` and `assistant-input-source` Vitest coverage
  passed with final-audit regressions for cross-lane cursors, projection
  metadata preservation, path/URL/raw-email text guards, attachment descriptor
  bounds, timestamp validation, paths-only context mismatch, and symlinked
  listing.
- Full `packages/assistant-engine` package tests passed.
- Final simplify, security/privacy, coverage-write, and task-finish-review
  subagent audits ran; their blocking findings were fixed before commit.
- Scoped `workspace-verify.sh test:diff` passed for the assistant-engine diff
  scope, including dependency policy, workspace boundaries, raw log guard,
  assistant-cli, assistant-engine, assistant-runtime, assistantd, cli,
  setup-cli, and Cloudflare owner verification.
Completed: 2026-04-30
