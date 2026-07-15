# Private-to-group Assistant Ask

Status: completed
Created: 2026-07-15
Updated: 2026-07-15

## Goal

- Let a member's private Murph ask a joined group Murph one bounded question,
  receive a read-only group-context answer asynchronously, and continue the
  original private conversation without exposing or selecting internal ids.

## Success criteria

- `murph.group(action="ask")` resolves membership automatically from the
  authenticated private turn and appends one idempotent encrypted request.
- The group runtime answers through one target-owned, isolated Codex process
  with native read-only filesystem confinement and no target write, delivery,
  tool, route, or recursion authority.
- The resident group Murph remains the sole foreground writer and sender; an
  active group reply and a detached ask can progress independently.
- One idempotent completion returns to the bound private runtime and produces
  at most one output-only follow-up after current membership, expiry, origin,
  and route checks pass.
- The existing hosted mailbox is the only durable queue and operation state;
  no projection, table, workflow, timer, lease, second container, or general
  agent registry is introduced.
- Focused owner coverage, full acceptance, production-like sandbox and
  concurrency proof, green PR CI, and ReviewGPT `ROUND_OUTCOME: PASS` complete.

## Scope

- In scope: paired hosted mailbox contracts; group-tool admission and web-owned
  resolution/completion callbacks; App Server permission fields and isolated
  executor; invocation-local detached controller; private completion; focused
  tests; current architecture, security, reliability, protocol, and testing
  documentation.
- Out of scope: arbitrary assistant discovery, general mailbox parallelism,
  streaming or multi-turn RPC, target writes, projections or snapshots, new
  durable state owners, and additional target-context adapters.

## Constraints

- Preserve the serial foreground authority path and current user-message
  preemption semantics.
- Derive all ids, destinations, membership generations, and return routing in
  trusted owners; the model supplies only a question and optional visible
  group label.
- Use Codex native permission profiles and App Server fields as the OS boundary;
  do not add path guards or a Murph sandbox.
- Keep raw question/answer content inside encrypted mailbox/process state and
  out of normalized rows, logs, analytics, fixtures, and diagnostics.
- Work only in `/private/tmp/murph-assistant-ask` on
  `codex/assistant-ask`; preserve every unrelated ledger row and worktree.

## Risks and mitigations

1. Risk: a detached process inherits foreground authority or interrupts the
   resident App Server.
   Mitigation: a fresh one-shot process receives no dynamic tools or route
   grants, owns its exact process handle, and is independently aborted and
   requeued before root release.
2. Risk: membership changes redirect or disclose stale group context.
   Mitigation: pin the exact membership generation at admission and recheck it
   before group read and completion append; leave/rejoin cannot retarget work.
3. Risk: filesystem or environment configuration silently weakens read-only
   confinement.
   Mitigation: reject legacy sandbox composition, pass the named permission
   profile and exact runtime roots through the pinned App Server schema, use a
   minimal child environment, and prove effective denial in the runner image.
4. Risk: web, Worker, and warm runner deploy out of order.
   Mitigation: land tolerant consumers disabled first, then producer support;
   enable only after an immediate runner rollout and sandbox smoke, and disable
   the producer before rollback/drain.

## Tasks

1. Trace current mailbox, group-tool, runtime, and App Server owners; settle the
   minimum contract and deployment seam against current code.
2. Add paired strict mailbox codecs, stable identity helpers, and web-owned
   admission/completion with exact authority and idempotency checks.
3. Add the native permission-capable one-shot executor and production-like
   filesystem/environment denial proof.
4. Add the single invocation-local detached request controller and output-only
   private completion while preserving foreground authority.
5. Add focused unit/integration/concurrency tests and update current durable
   architecture, security, reliability, protocol, and testing docs.
6. Run coverage-bearing verification and required coverage-write audit, parent
   final review, close the plan with `scripts/finish-task`, push, open the PR,
   and run CI plus the exact-head ReviewGPT loop to completion.

## Decisions

- Use generic `assistant.ask.requested` / `assistant.ask.completed` mailbox
  events with a single typed `joined_group` adapter.
- Keep the user-facing action group-specific; do not expose a generic model
  destination or agent address.
- Run one cold, target-owned App Server child per ask. Startup cost is accepted
  to preserve foreground independence and a simple ownership model.
- Read the live restored group workspace non-transactionally. Retry transient
  read failure through the existing mailbox instead of adding a snapshot.
- Permit only one detached ask per target runtime; further requests remain
  pending in the existing mailbox.

## Verification

- Iteration: focused owner tests and `pnpm test:diff` over the touched package
  and app paths once the slice is stable.
- Completion: `pnpm verify:acceptance`, `git diff --check`, privacy/log guards,
  direct production-like sandbox denial, active-foreground concurrency and
  exact-child cancellation scenarios, required `coverage-write`, parent final
  review, pushed-head preflight, ReviewGPT round(s), CI, and merge-tree proof
  against current `origin/main`.
- Expected outcome: every required check passes and no accepted audit or
  ReviewGPT finding remains unresolved.
Completed: 2026-07-15
