# Admit only reply-eligible fresh input

Status: completed
Created: 2026-07-14
Updated: 2026-07-14

## Goal

- Ensure a durably staged hosted conversation message enters foreground assistant work only when the existing reply-eligibility decision says it can produce a reply.
- Prevent an earlier reply-ineligible mailbox row from occupying the single fresh-input slot and stranding a later replyable message.

## Success criteria

- Reply-ineligible messages remain durably staged and projected as today, but do not notify the active turn or return a foreground `assistantInputId`.
- Foreground freshness is derived only from returned assistant input ids, never from a raw conversation import count.
- Focused regressions prove reply-ineligible and consumed rows return no foreground id, while existing batch aggregation continues to retain every later returned eligible id.
- The scoped assistant-runtime verification lane, required coverage audit, parent final review, PR CI, and exact-head ReviewGPT loop complete with no accepted findings.
- The production diff adds no persisted state, owner, queue, scheduler, retry loop, compatibility path, dependency, configuration, or media-parser lifecycle.

## Scope

- In scope:
  - `packages/assistant-runtime/src/hosted-runtime/mailbox-conversation-import.ts`
  - `packages/assistant-runtime/src/hosted-runtime/workspace-assistant-phase.ts`
  - Focused assistant-runtime regression tests for eligibility-aware foreground admission.
- Out of scope:
  - Asynchronous parser maintenance, media parser recovery, SQLite restoration, or media-before-text lane decoupling.
  - Linq route fallback or scheduled-route changes.
  - WhatsApp support.
  - New storage, schemas, lifecycle state, compatibility machinery, or deployment.

## Constraints

- Technical constraints:
  - Preserve durable mailbox staging, mapping, projection, watermark, replay, and terminal handling behavior.
  - Use the existing optional `assistantInputId` as the sole foreground-admission capability instead of adding another boolean or abstraction.
  - Preserve reply-eligible media behavior; this PR does not redesign parser ownership.
- Product/process constraints:
  - Default to deletion and the smallest owner-bound correction.
  - Preserve the old oversized PR and its conflicted worktree for audit history; do not copy or repair it in place.
  - Open a draft replacement PR only. Do not merge or deploy.
  - Do not cancel, duplicate, or interfere with another ReviewGPT/browser run.

## Risks and mitigations

1. Risk: suppressing `assistantInputId` could accidentally suppress durable message storage.
   Mitigation: keep staging, mapping, projection, and imported status unchanged; assert them directly in focused tests.
2. Risk: consumed replay or active-turn behavior could change unintentionally.
   Mitigation: trace both return paths and retain existing consumed guards; add only eligibility predicates at the foreground capability boundary.
3. Risk: adjacent hosted-runtime work overlaps these files.
   Mitigation: stay on current `main`, touch only named symbols and focused tests, inspect the coordination ledger, and rebase before final handoff if the base moves.
4. Risk: review feedback could recreate the oversized architecture.
   Mitigation: require production-path proof for every finding and reject fixes that add owners, queues, state machines, or compatibility machinery without a demonstrated current need.

## Tasks

1. Trace current-main eligibility, staging, import aggregation, and fresh-work selection end to end.
2. Add the smallest production predicates at the existing capability boundaries.
3. Add focused regression coverage for durable-but-ineligible input, consumed replay, and pending-work discovery after count-only imports.
4. Run scoped verification, the required coverage-write audit, and the parent final review.
5. Close the plan with a scoped commit, push the branch, and open a draft PR with the intent and change-shape contract.
6. Run PR CI and the exact-head ReviewGPT loop to its repository-defined terminal outcome.

## Decisions

- Use optional `assistantInputId` as the existing foreground capability; do not add `assistantReplyEligible` or another state field.
- Keep inbox projection unchanged for reply-ineligible messages because it remains durable conversation evidence and is not foreground authority.
- Defer the distinct media-parser lane-blocking edge; solving it requires a separate product/architecture decision and is not needed for the proven mixed-eligibility bug.

## Progress

- Traced durable staging through mailbox aggregation, workspace-runner control signals, assistant-phase freshness, and foreground selection on current `main`.
- Reproduced both defects before changing production code: an unconfigured staged input still notified the active turn and returned an id, and a count-only conversation import suppressed pending-index discovery.
- Added one effective foreground predicate in the conversation importer and removed the raw-count freshness fallback in the assistant phase. Production scope is 17 added and 10 deleted lines across the two owner files.
- Kept staging, mailbox mapping, projection, latency tracing, pending indexing, watermarks, replay, runner control-loop counts, and media-parser behavior unchanged.

## Now

- The focused projected-ineligible, consumed-replay, and count-only pending-discovery regressions pass.
- Full scoped diff verification, the required coverage-write audit, and the independent parent-level static review pass.
- The final commit, draft PR, CI, and ReviewGPT remain.

## Verification

- Commands to run:
  - `MURPH_VERIFY_SHARED_HOST=1 pnpm test:diff <touched assistant-runtime paths>` with `MURPH_VERIFY_HOST_CONCURRENCY` unset.
  - Focused direct scenario tests selected from the existing assistant-runtime test files.
  - `git diff --check` and a base-to-head scope/change-shape inspection.
  - PR CI plus the exact-head `pnpm review:gpt pr-review` loop after the draft PR opens.
- Expected outcomes:
  - All touched-owner and reverse-dependent typechecks/tests pass.
  - The focused regression shows durable import without foreground admission for an ineligible row and admission of the later eligible row.
  - No unrelated source, docs, config, schema, dependency, generated file, or deployment change appears in the final patch.
- Completed focused checks:
  - Pre-fix focused run reproduced both failures; its exact owned Vitest session was stopped with Ctrl-C after the failure evidence was captured.
  - Unconfigured projected input: 1 passed, 58 skipped.
  - Consumed replay plus count-only pending discovery: 2 passed, 277 skipped.
  - `pnpm test:diff` for the four touched assistant-runtime source/test paths passed with the shared-host profile: dependency policy, workspace boundaries, hosted-runtime guards, affected typechecks, 73 assistant-runtime test files with 1,635 passing tests and 2 skips, 104 Cloudflare Node test files with 1,789 passing tests, and 1 Cloudflare Workers test with 1 passing test.
  - `git diff --check` passed.
  - The required coverage-write audit found the current regressions sufficient and made no edits: both importer return branches, durable projection, foreground callback/notification suppression, eligible positive behavior, and count-only pending discovery are covered. It rejected a new mocked mixed-batch test because that test would also pass before the fix and would duplicate existing aggregation proof.
  - Independent final static review found no critical, high, or medium defect and confirmed that the diff adds no state owner, queue, service, retry mechanism, or compatibility path.
Completed: 2026-07-14
