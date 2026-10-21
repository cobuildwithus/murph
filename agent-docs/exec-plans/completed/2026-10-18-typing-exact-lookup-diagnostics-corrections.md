# Correct exact-lookup diagnostic review findings

Status: completed
Created: 2026-10-18
Updated: 2026-10-18

## Goal

- Apply candidate-review corrections to the exact-lookup diagnostics and
  first-fetch CPU copy. They stay observation-only.

## Success criteria

- Emitted exclusion reasons are limited to the declared finite codes at runtime.
  Unknown or malformed reason data reads as `invalid`, never `none`.
- A missing peer, which skips the batch replyable filter, is named
  `replyability_not_evaluated` and kept apart from a real replyability rejection.
- `over_limit` is executed by a genuinely truncating exact lookup, and the
  returned prefix is unchanged.
- The composed test's watcher always stops, and is awaited, before temp cleanup.
- `exactLookupCalled` derives from the executed exact branch.
- Docs state the limits of `not_grouped_with_anchor` and of process CPU.

## Scope

- In scope:
  - the engine input-source reason constant and type;
  - `reply.ts` exact branch;
  - runtime `turn-input.ts` reason naming and the `over_limit` comment;
  - `maintenance.ts` summary;
  - focused tests; the log database doc; the Cloudflare README wording.
- Out of scope:
  - any admission, selection, grouping, replyable, window, typing or ordering change;
  - new instrumentation.

## Constraints

- Technical constraints: one owner constant (the type derives from it); no
  broad redaction framework; strict -> exact -> route order unchanged.
- Product/process constraints: keep the PR Draft; coordinator reviews before
  Ready/ReviewGPT; no merge or deploy.

## Risks and mitigations

1. Risk: the summary validator rejects valid source output.
   Mitigation: empty and all-zero reports stay `none`; real-path composed rows
   still report `none` and `not_grouped_with_anchor:1`.

## Tasks

1. Reason constant and validated summary.
2. Missing-prerequisite naming.
3. Truncating `over_limit` test and invariant comment.
4. Unconditional watcher stop.
5. Branch-derived `exactLookupCalled`.
6. Docs, focused tests, typechecks, mutations, commit and draft push.

## Decisions

- The invalid summary is a single fixed code, `invalid`. Partial salvage of
  malformed reports is not attempted.
- A total above `requestedCount` is invalid. Zero counts are allowed and omitted.
- The new composed test's type-only imports were corrected to the runtime-control
  owner (a typecheck miss in the first commit).

## Verification

- `pnpm typecheck`: assistant-engine, assistant-runtime, apps/cloudflare pass.
- Engine reply-event-path, automation-runtime and local-service-live-input: 362/362.
- Runtime turn-input, maintenance, group-draft-window-admission,
  workspace-entrypoint-foreground-input, mailbox-conversation-import,
  mailbox-import and fetch-transport-log: 383/383.
  Cloudflare collector and mailbox-port: 20/20.
- Mutations, each restored and each caught:
  - source keys emitted unchecked;
  - an oversized total accepted;
  - the missing-peer stage named `not_replyable`;
  - `over_limit` not counted;
  - `exactLookupCalled` not tied to the branch.
- `pnpm complexity:diff` (base df2e9ec4ea): pass, no debt change.
  `docs:drift` and `verify:workspace-boundaries`: pass.
- Coordinator candidate review passed on source head 2b0641b7ae61, with three
  independent typechecks.
- Final ReviewGPT round 1 on 2b0641b7ae61: PASS, no findings.
- This closeout adds only this plan's closure. Exact-head CI remains a merge gate.
Completed: 2026-10-18
