# Retry Browser Vault refreshes after bounded timeouts

Status: active
Created: 2026-08-28
Updated: 2026-08-28

## Goal

- Preserve bounded Browser Vault refresh work after a production-observed
  timeout so a later foreground-safe invocation can finish the durable refresh
  request without delaying or preempting current conversation work.

## Success criteria

- A forced Browser Vault refresh that returns `deferred_timeout` retains the
  current system-mailbox item and projects one bounded follow-up wake.
- Existing runtime-wake and host-abort preemption behavior remains unchanged.
- Browser Vault refresh deadlines, cancellation joining, write fences,
  publication compare-and-swap, and assistant-liveness precedence remain
  unchanged.
- Focused tests prove the timeout retry, a later successful terminalization,
  and no retry loop after terminal outcomes.
- The runtime contract documents the bounded retry behavior and production
  verification query.

## Scope

- In scope: the assistant-runtime Browser Vault timeout disposition, its
  existing wake owner, focused tests, and the hosted-runtime protocol.
- Out of scope: changing the 20-second deadline, retrying generic failures or
  publication conflicts, adding a queue or state owner, changing canonical
  workspace data, device sync, or production deployment.

## Constraints

- Technical constraints: reuse the existing system-mailbox retention and
  checkpoint wake projection; keep retries bounded by the durable item and
  ordinary runtime admission; do not add database or provider calls.
- Product/process constraints: ReviewGPT exclusively authors production code
  and remediation. The production evidence packet contains only aggregates and
  typed low-cardinality stages.

## Risks and mitigations

1. Risk: an unconditional continuation could spin on permanently slow work.
   Mitigation: retain only `deferred_timeout`, reuse the existing wake/backoff
   owner, and preserve terminal handling for generic failures and conflicts.
2. Risk: dashboard-side work could delay member replies.
   Mitigation: preserve current foreground and runtime-wake preemption and test
   that those paths still win.
3. Risk: active Environment mailbox work touches nearby scheduling code.
   Mitigation: keep this change at the Browser Vault timeout disposition and
   inspect the current PR diff for semantic overlap before applying a patch.

## Tasks

1. Reproduce the current timeout terminalization in a focused test and record
   the natural production stage aggregates plus durable no-wake exposure.
2. Ask ReviewGPT for the smallest patch at the existing Browser Vault/system
   mailbox owner boundary.
3. Inspect the patch for boundedness, liveness, privacy, device-sync isolation,
   and active-PR coexistence before applying it exactly.
4. Run focused tests, affected typechecks, privacy/log guards, and the required
   completion audits.
5. Commit, push, open a draft PR, then run preliminary/final ReviewGPT and CI on
   the exact candidate head. Leave the ordinary functional fix for human merge.

## Decisions

- Natural telemetry after the Browser Vault stage rollout recorded fourteen
  `deferred_timeout` outcomes through 2026-08-28T19:18:50Z: five at replica
  write, four at construction, three at the second source hash, and two at
  serialization.
- The current code classifies `deferred_timeout` as complete, records the
  Browser Vault system-mailbox item, and the focused test requires an idle
  result with no next wake. Durable production aggregates include old refresh
  requests without a projected workspace wake.
- No open PR or issue owns this timeout-retry correction. PR #2448 changes the
  generic Environment/system-mailbox scheduler but does not implement or test
  the Browser Vault timeout disposition; semantic coexistence must still be
  checked after ReviewGPT returns a patch.
- The first ReviewGPT wait/wake completed, but the captured assistant turn was
  an unrelated review for PR #2451 at a different head and contained no patch
  or attachment. It was rejected without applying or reconstructing code.
- The Browser Vault implementation is being retried in a fresh ReviewGPT
  conversation with a unique response marker and an explicit patch-attachment
  request so exact-task and artifact identity fail closed.
- After about one hour of clean attached generation without a completed marker,
  ownership moved to the exact-turn detached watcher. It polls at five-minute
  intervals for at most 260 minutes and will resume this plan only after the
  correct response is complete. ChatGPT reported that its file library is full,
  so the response may need to use the requested complete inline unified-diff
  fallback instead of an attachment.
- The captured retry turn contained the exact completion marker and a complete
  Git-applicable attachment. The production and contract diff was applied
  exactly. Focused verification exposed one test-fixture collision with an
  unrelated 30-second assistant-cron candidate; setting the existing
  `assistantExecutionBlocked` input on that model-free system-mailbox scenario
  isolates the intended 60-second retained-item retry, and the complete
  timeout-to-publication scenario passes without changing production code.

## Verification

- Commands to run: focused Browser Vault replica and workspace-entrypoint
  suites; assistant-runtime typecheck; repository privacy/log guard; diff
  checks; the routed completion audits; exact-head GitHub checks.
- Expected outcomes: timeout retains work and schedules one bounded follow-up;
  wake/abort preemption and terminal outcomes remain unchanged; no private
  values or new production state surfaces appear.
