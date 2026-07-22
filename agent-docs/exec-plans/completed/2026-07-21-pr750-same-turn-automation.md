# Collapse PR 750 to one ordinary scheduled turn

Status: completed
Created: 2026-07-21
Updated: 2026-07-21

## Goal

- Replace the delayed scheduled Assistant Ask continuation workflow with one
  ordinary bounded Codex turn in the existing Murph group runtime.

## Success criteria

- A scheduled group turn starts a consented member ask through the existing
  encrypted request mailbox, may wait with ordinary Codex shell execution, and
  repeats the same `ask_member` call to read the reviewed result.
- The repeated call returns the result only while the original occurrence,
  membership, grant, permission, target runtime, request, completion, and expiry
  still match; successful tool return is the disclosure boundary.
- A missing result remains pending and never starts a second provider turn or a
  late group delivery.
- Scheduled group tools are injected through the existing
  `createScheduledGroupTools` seam without a separate scheduled operation-scope
  method.
- Interactive accepted-input Assistant Ask and legacy private-to-group Assistant
  Ask behavior remain unchanged.
- Scheduled-continuation-only notification, fallback, outbox,
  provider-isolation, and retry plumbing is deleted. Accepted-input exact
  delivery keeps its existing outbox fallback and final egress checks.

## Scope

- In scope: PR 750 scheduled Assistant Ask contracts, Web replay/result reads,
  group-tool guidance, cron/runtime capability scoping, completion handling,
  continuation-only delivery plumbing, focused tests, and durable architecture,
  security, reliability, protocol, and product-spec documentation.
- Out of scope: replacing the consent/grant tables, weakening private candidate
  or reviewer isolation, changing accepted-input exact delivery, or adding a new
  scheduler, queue, coordinator, result table, or compatibility lifecycle.

## Constraints

- Prefer deletion and derive behavior from the trusted origin kind rather than
  new modes or state owners.
- Reuse the current deterministic request/completion identities and encrypted
  mailbox rows.
- Preserve unrelated active work, especially the mailbox consumed-at lane; do
  not change generic mailbox consumption semantics.
- Keep provider-returned member content explicitly untrusted and never expose a
  private vault to the group runtime.

## Tasks

1. Add result-on-replay semantics to scheduled `ask_member` with exact live
   authority validation.
2. Reuse the ordinary bounded group tool through the existing scheduled
   group-tool factory and remove scheduled operation-scope indirection.
3. Delete delayed scheduled continuation execution and downstream
   continuation-only fallback/provider/outbox plumbing while preserving the
   interactive exact-delivery path.
4. Update prompts/specs to the start-asks, wait once, retry-once ordinary Codex
   behavior.
5. Run focused and diff-aware verification, coverage-write, ReviewGPT, CI, and
   parent final review; close the plan with the scoped final commit.

## Decisions

- The normal scheduled Codex process owns the entire occurrence. A reviewed
  result returned by the repeated tool call is ordinary current-turn data.
- Codex may start multiple selected member asks, wait once, and retry each exact
  request once; no recursive continuation or per-result provider turn exists.
- A late completion remains bounded encrypted mailbox data for retention and is
  ignored by scheduled completion handling.

## Audit outcomes

- The implementation audit removed the delayed provider continuation, its
  scheduled operation-scope method, completion-derived cron delivery path,
  special notification profile, no-session/no-receipt handling, and related
  fallback/config plumbing. The remaining scheduled seam only binds the
  ordinary group tools to a currently authorized non-direct route.
- Parent review confirmed that cron rechecks canonical automation and route
  authority before every Murph tool call, while Web keeps the disclosure/result
  boundary under the existing group/member locks and live runtime fences.
- The required `coverage-write` pass found one missing edge proof and added a
  Web regression showing that a stored scheduled completion is not revealed
  after the group runtime fence becomes inactive. It reported no other
  actionable coverage gap.
- PR-lane ReviewGPT remains the sole cross-cutting gate and will run against the
  exact pushed head in parallel with CI; no local `deep-review` pass was run.

## Verification

- `NODE_OPTIONS=--max-old-space-size=8192 MURPH_VITEST_MAX_WORKERS=25% pnpm --dir packages/assistant-engine test:coverage`
  passed 2,543 tests with 89.65% statement coverage.
- The equivalent owner coverage commands passed 1,756 Assistant Runtime tests
  with 88.31% statement coverage and 378 Hosted Execution tests with 88.78%
  statement coverage.
- The focused hosted Web group-tool/Assistant Ask lane passed 106 tests.
- Assistant Engine, Assistant Runtime, Hosted Execution, and prepared Web
  typechecks passed. The diff-aware lane independently passed repository guards
  and every affected typecheck; its default unbounded Assistant Engine worker
  exceeded Node's 4 GB heap after 169 files and 2,533 passing tests, so the
  bounded full owner coverage command above supplied the completed proof.
- `pnpm test:scenario-integrity` passed 204 scenarios, `pnpm docs:drift`
  passed, and `git diff --check` passed.
- The group-chat skill's repo asset tests passed inside Assistant Engine
  coverage. The standalone skill validator could not start because its local
  Python environment lacks the `yaml` module; no validation failure was
  reported against the skill itself.
Completed: 2026-07-21
