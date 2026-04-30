# Hosted Assistant Input Parallel Execution Plan

Status snapshot: 2026-04-30

## Purpose

This document turns `docs/hosted-assistant-input-migration-guide.md` into a
parallelizable implementation plan.

The implementation is high-risk because it touches hosted ingress, durable
assistant runtime state, accepted input, reply handling, delivery safety, and
recovery semantics. The plan therefore parallelizes review, test design, and
bounded patch proposals, while keeping final code landing serial through one
integrator.

## Execution Model

Use one checkout and one integrator.

Parallel Codex high subagents may:

- inspect code
- propose patches for bounded write scopes
- design tests
- review invariants
- run focused commands when not racing shared build artifacts

Parallel subagents must not independently mutate the same checkout at the same
time. The integrator lands one batch at a time, verifies it, runs required
audits, commits it, and only then opens the next implementation batch.

This is intentionally stricter than the theoretical module split. The current
repo has many active ledger rows around hosted runtime, assistant-engine,
Cloudflare, runtime-state, active-turn, and hosted Linq work. Serial landing is
the safer way to preserve unrelated work and avoid misleading green tests.

## Global Invariants

- Codex consumes durable assistant input events, not inbox captures.
- Inbox/search/files/parsers are projections.
- Assistant-engine owns the source-agnostic input contract.
- Hosted runtime adapts hosted mailbox events into that contract.
- Assistant-engine must not import hosted-runtime wake types.
- Input durability must precede mailbox ingest cursor advancement.
- Accepted input and reply intent durability must precede provider delivery.
- Capture ids are optional projection metadata, not assistant handling keys.
- Runtime-only inbox rows are migration-only and must not become reply
  eligibility truth.
- No journals, logs, status records, or test fixtures should persist plaintext
  prompt bodies, secrets, full authorization headers, direct personal
  identifiers, or local machine paths.

## Batch Overview

| Batch | Scope | Parallel role | Serial landing gate |
| --- | --- | --- | --- |
| 0 | Prep and ownership | Subagents map overlap and tests | Coordinator opens a batch plan and ledger row |
| 1 | Engine input contract and inbox adapter | Review/test design only | Contract and inbox-backed candidate tests pass |
| 2 | Assistant input store | Can patch after Batch 1 | Store restore/dedupe/corrupt-record tests pass |
| 3 | Journal and evidence schema | Can patch after Batch 1 | Source-ref journal and input-keyed evidence tests pass |
| 4 | Runtime source adapters | Can patch after Batch 1/2 | Linq adapter produces prompt-ready input data |
| 5 | Hosted mailbox ingest | Mostly serial | Decode/match writes input before projection; cursor safety proven |
| 6 | Automation scanner | Can patch after Batch 3 | Initial scanner uses input candidates and dedupes by input id |
| 7 | Active-turn admission | Serial after Batch 5/6 | Late input reaches turn; checkpoint conflict blocks delivery |
| 8 | Projection demotion | Can patch after Batch 5 | Projection failure leaves input listable |
| 9 | Integration and hosted Linq proof | Serial | Reply/delivery/provider cleanup works without inbox gate |
| 10 | Live docs update | Review in parallel, land serial | Live docs match implemented behavior |

## Batch 0: Prep And Ownership

Write scope:

- one active execution plan under `agent-docs/exec-plans/active/`
- one matching row in `agent-docs/exec-plans/active/COORDINATION_LEDGER.md`

Work:

- Recheck active ledger overlap before editing.
- Mark exclusive file scopes when overlap would be unsafe.
- Confirm current dirty tree ownership.
- Assign one integrator.
- Decide whether the first implementation slice is allowed to proceed or must
  wait for active overlapping rows to close.

Serial gate:

- Active plan and ledger row exist.
- Hot files are assigned to exactly one batch owner.

## Batch 1: Engine Input Contract And Inbox Adapter

Write scope:

- `packages/assistant-engine/src/assistant/input-source.ts` or equivalent new
  source-agnostic module
- minimal exports/barrels needed by existing package conventions
- focused assistant-engine input-source tests
- only minimal `turn-input.ts` edits needed to introduce compatibility

Work:

- Define `AssistantInputSourceRef`.
- Define `AssistantInputCursor`.
- Define `AssistantInputProjectionStatus`.
- Define `AssistantInputEvent`.
- Define `AssistantInputCandidate`.
- Define `AssistantInputSource`.
- Add an inbox-backed adapter that maps existing inbox captures into input
  candidates.
- Preserve current capture-backed behavior.

Rules:

- No hosted-runtime types in assistant-engine.
- No scanner/reply refactor in this batch.
- No accepted-input journal schema change in this batch unless it is strictly
  needed to type the contract.

Focused checks:

```bash
pnpm --dir packages/assistant-engine typecheck
pnpm --dir packages/assistant-engine test -- assistant-turn-input.test.ts
```

## Batch 2: Assistant Input Store

Preferred write scope:

- assistant-engine state/store files if the store is shared by local and hosted
  assistant surfaces
- otherwise a narrow assistant-runtime adapter layer that delegates to
  assistant-engine-owned state helpers
- focused input-store tests

Work:

- Store versioned JSON records under:

  ```text
  .runtime/operations/assistant/input-events/
  ```

- Deterministic `inputId`.
- Idempotent upsert by source ref.
- List by conversation and cursor.
- Projection status update.
- Read-after-restore behavior.
- Corrupt-record fail-closed or quarantine behavior.
- Existing assistant-state file-permission helpers.

Rules:

- No raw auth headers.
- No secrets.
- No unnecessary raw payload duplication.
- No mailbox cursor changes.

Focused checks:

```bash
pnpm --dir packages/assistant-engine test -- assistant-input-store.test.ts
pnpm --dir packages/assistant-engine typecheck
```

If implementation places the store in `packages/assistant-runtime`, use:

```bash
pnpm --dir packages/assistant-runtime test -- hosted-runtime-assistant-input-store.test.ts
pnpm --dir packages/assistant-runtime typecheck
```

## Batch 3: Accepted Input Journal And Terminal Evidence

Write scope:

- `packages/assistant-engine/src/assistant/active-turn-input-journal.ts`
- `packages/assistant-engine/src/assistant/automation/evidence.ts`
- focused journal/evidence tests

Work:

- Add accepted input source for assistant input events.
- Add content ref kind for assistant input events.
- Allow hosted input records without capture ids.
- Add source/input cursor effects with input ids and mailbox refs.
- Key terminal evidence by input id or handling group id.
- Keep legacy capture-keyed evidence readable during migration.

Rules:

- Schema changes must be additive.
- Do not hard-cut existing capture-backed journal records.
- Do not persist raw prompt bodies.
- Do not refactor `automation/reply.ts` here.

Focused checks:

```bash
pnpm --dir packages/assistant-engine test -- assistant-active-turn-input-journal.test.ts
pnpm --dir packages/assistant-engine test -- assistant-auto-reply-evidence.test.ts
```

## Batch 4: Runtime Source Adapters

Write scope:

- new adapter files under `packages/assistant-runtime/src/hosted-runtime/events/`
  or `packages/assistant-runtime/src/hosted-runtime/assistant-input-*`
- minimal source-specific helper exports if needed
- focused hosted-runtime adapter tests

Work:

- Convert decoded hosted wakes into engine-neutral assistant input data.
- Implement Linq first.
- Represent Telegram metadata later.
- Treat email as prompt-ready or durably deferred.

Linq adapter requirements:

- stable input id from mailbox item/event identity
- channel `linq`
- conversation/thread ref from chat id
- directness
- sender/actor ref
- text from message parts
- link and attachment descriptors
- delivery reply-to id from the Linq message id
- accepted input source ref from mailbox lane and sequence

Rules:

- No inbox writes in source adapters.
- Do not require attachment bytes for Linq assistant input.
- Do not enable Telegram/email delivery until required metadata is represented.

Focused checks:

```bash
pnpm --dir packages/assistant-runtime test -- hosted-runtime-linq-event.test.ts
pnpm --dir packages/assistant-runtime typecheck
```

## Batch 5: Hosted Mailbox Ingest

Exclusive write scope:

- `packages/assistant-runtime/src/hosted-runtime/mailbox-conversation-import.ts`
- mailbox cursor/checkpoint files only if required:
  - `packages/assistant-runtime/src/hosted-runtime/mailbox-import.ts`
  - `packages/assistant-runtime/src/hosted-runtime/mailbox-checkpoint.ts`
  - `packages/assistant-runtime/src/hosted-runtime/mailbox-state.ts`
  - `packages/assistant-runtime/src/hosted-runtime/workspace-runner.ts`
- focused hosted-runtime mailbox tests

Work:

- Resolve payload.
- Decode payload.
- Verify decoded wake matches mailbox item.
- Write `AssistantInputEvent`.
- Checkpoint the workspace with the input event.
- Advance ingest cursor only after durable checkpoint.
- Attempt inbox projection best-effort afterward.
- Keep decode/match failures fail-closed.

Rules:

- Runtime-only capture is not import success.
- Projection failure is not `source_unavailable` after input event durability.
- Do not change assistant-engine scanner/reply behavior in this batch.

Focused checks:

```bash
pnpm --dir packages/assistant-runtime test -- hosted-runtime-mailbox-conversation-import.test.ts
pnpm --dir packages/assistant-runtime test -- hosted-runtime-mailbox-import.test.ts
pnpm --dir packages/assistant-runtime test -- hosted-runtime-workspace-runner.test.ts
```

## Batch 6: Automation Scanner

Write scope:

- `packages/assistant-engine/src/assistant/automation/scanner.ts`
- narrow scanner/grouping/shared helpers if needed
- focused assistant automation scanner tests

Work:

- Replace initial scanner candidate listing with `AssistantInputSource`
  candidates.
- Group by conversation, directness, and channel.
- Skip terminal evidence by input id.
- Preserve capture-backed inbox adapter behavior.
- Prove Linq-style assistant input candidate can be selected with no inbox
  capture.

Rules:

- Avoid `automation/reply.ts` except for type-level plumbing approved by the
  integrator.
- Do not modify hosted runtime ingest.

Focused checks:

```bash
pnpm --dir packages/assistant-engine test -- assistant-automation-runtime.test.ts
pnpm --dir packages/assistant-engine test -- assistant-auto-reply-grouping.test.ts
```

## Batch 7: Active-Turn Admission

Exclusive write scope:

- `packages/assistant-engine/src/assistant/turn-input.ts`
- `packages/assistant-engine/src/assistant/active-turn-input-controller.ts`
- `packages/assistant-runtime/src/hosted-runtime/turn-input.ts`
- focused active-turn tests

Work:

- Replace `listNewConversationCaptures` with `listNewConversationInputs`.
- Refresh hosted mailbox into assistant input events.
- Dedupe late same-conversation input by `inputId`.
- Steer provider using candidate prompt/content.
- Checkpoint accepted input before final reply intent creation.
- Ensure checkpoint rejection aborts before delivery.

Rules:

- This batch lands after scanner and mailbox ingest are stable.
- Avoid broad reply-flow refactors.

Focused checks:

```bash
pnpm --dir packages/assistant-engine test -- assistant-turn-input.test.ts
pnpm --dir packages/assistant-runtime test -- hosted-runtime-turn-input.test.ts
```

## Batch 8: Projection Demotion

Write scope:

- `packages/assistant-runtime/src/hosted-runtime/events/conversation.ts`
- narrow projection helpers under `packages/assistant-runtime/src/hosted-runtime/`
- focused assistant-runtime projection tests
- `packages/inboxd` tests only if inbox projection behavior changes directly

Work:

- Move canonical inbox persistence behind projection status.
- Move parser drain and attachment materialization behind projection status.
- Update assistant input projection status on success/failure.
- Allow later retry to attach `inboxCaptureId`.
- Ensure projection success does not cause duplicate assistant handling.

Rules:

- Projection failures do not hide durable assistant input.
- Do not widen into scanner/reply code.

Focused checks:

```bash
pnpm --dir packages/assistant-runtime test -- hosted-runtime-conversation-event.test.ts
pnpm --dir packages/assistant-runtime test -- hosted-runtime-mailbox-conversation-import.test.ts
```

## Batch 9: Integration And Hosted Linq Proof

Exclusive write scope:

- `packages/assistant-engine/src/assistant/automation/reply.ts`
- delivery/outbox/receipt/provider-cleanup touchpoints only as needed
- hosted Linq E2E tests/helpers only as needed

Work:

- Wire scanner candidate, accepted input, reply intent, terminal evidence, and
  delivery metadata together.
- Make delivery idempotency use input ids or handling group ids.
- Preserve capture ids as optional projection metadata.
- Ensure provider cleanup uses `replyTarget` and delivery source metadata, not
  required capture ids.
- Prove hosted Linq can reach Codex and delivery without inbox capture being
  the admission gate.

Rules:

- This is the hot integration batch. Do not parallelize code landing here.
- No user-visible delivery without durable accepted input and reply intent.

Focused checks:

```bash
pnpm test:diff packages/assistant-engine packages/assistant-runtime apps/cloudflare
pnpm --dir apps/cloudflare test:e2e:linq-delivery:local
```

## Batch 10: Live Docs Update

Write scope:

- `ARCHITECTURE.md`
- `agent-docs/references/hosted-runtime-protocol.md`
- `packages/assistant-runtime/README.md`
- `packages/inboxd/README.md`
- `agent-docs/references/testing-ci-map.md` if verification map changes

Work:

- Update live docs after code is true.
- Replace capture-first wording with assistant-input ingest wording.
- Document inbox as projection for hosted assistant input.
- Document runtime-only capture removal or remaining compatibility status.
- Document focused tests added by the implementation.

Rules:

- Do not update live architecture docs before implementation is real.
- Do not list point-in-time planning docs in `agent-docs/index.md` unless they
  are promoted to live canonical references.

Focused checks:

```bash
pnpm docs:drift
git diff --check -- ARCHITECTURE.md agent-docs/references/hosted-runtime-protocol.md packages/assistant-runtime/README.md packages/inboxd/README.md
```

## Parallel Subagent Pattern

For each implementation batch:

1. Coordinator opens a batch plan and exact ledger row.
2. Coordinator assigns exclusive write scope.
3. Read-only subagents run in parallel for:
   - code seam review
   - test matrix design
   - security/privacy risk review
   - simplification review
4. At most one write-capable worker patches a given batch scope.
5. Coordinator reviews patch, resolves integration, and runs focused checks.
6. Required audit subagents run after implementation is stable.
7. Coordinator commits with `scripts/finish-task`.

Subagent handoff packet must include:

- scope and files inspected
- proposed patch or findings
- invariants checked
- tests to add or run
- direct scenario proof needed
- ledger conflicts noticed
- blocked assumptions

## Must Stay Serial

- Contract freeze.
- Mailbox cursor/checkpoint semantics.
- Accepted-input journal schema materializer decision.
- Terminal evidence key migration.
- Active-turn admission.
- `automation/reply.ts` integration.
- Runtime-only capture removal from reply eligibility.
- Live architecture doc updates.
- Audit-finding fixes.
- Commits.

These are correctness and recovery boundaries. Parallel landing can create
false confidence and difficult rollback paths.

## Hot Files

Treat these as exclusive unless the active batch plan says otherwise:

- `packages/assistant-engine/src/assistant/automation/reply.ts`
- `packages/assistant-engine/src/assistant/turn-input.ts`
- `packages/assistant-engine/src/assistant/active-turn-input-journal.ts`
- `packages/assistant-engine/src/assistant/automation/evidence.ts`
- `packages/assistant-runtime/src/hosted-runtime/mailbox-conversation-import.ts`
- `packages/assistant-runtime/src/hosted-runtime/mailbox-import.ts`
- `packages/assistant-runtime/src/hosted-runtime/mailbox-checkpoint.ts`
- `packages/assistant-runtime/src/hosted-runtime/mailbox-state.ts`
- `packages/assistant-runtime/src/hosted-runtime/workspace-runner.ts`

## Verification Strategy

Per batch, run the narrowest truthful owner checks.

After Batch 3:

```bash
pnpm typecheck
pnpm --dir packages/assistant-engine test:coverage
```

After Batch 5:

```bash
pnpm typecheck
pnpm --dir packages/assistant-runtime test:coverage
pnpm test:diff packages/assistant-runtime
```

After Batch 7:

```bash
pnpm typecheck
pnpm test:diff packages/assistant-engine packages/assistant-runtime
```

Final integration:

```bash
pnpm typecheck
pnpm test:diff packages/assistant-engine packages/assistant-runtime packages/inboxd apps/cloudflare
pnpm --dir packages/assistant-engine test:coverage
pnpm --dir packages/assistant-runtime test:coverage
pnpm --dir apps/cloudflare verify
pnpm --dir apps/cloudflare test:e2e:linq-delivery:local
pnpm verify:acceptance
```

If `apps/web` changes during the rollout:

```bash
pnpm --dir apps/web verify
```

Avoid running broad build/verification commands concurrently in the same
checkout. Several commands share build artifacts, runner bundles, app output
directories, or workspace locks.

## Required Completion Reviews

Implementation batches touch persisted runtime state, hosted ingress,
user-message data, accepted input, delivery, and trust boundaries. Code batches
therefore require the repo completion workflow's relevant audit passes:

- `security-privacy-review`
- `coverage-write` when owner coverage is part of the verification lane
- `task-finish-review`
- `simplify` when the locally developed implementation diff is large enough to
  meet the workflow threshold

Docs-only planning batches can use the docs fast path.
