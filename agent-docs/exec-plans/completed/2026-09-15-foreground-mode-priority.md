# Preserve foreground priority after background promotion

Status: completed
Created: 2026-09-15
Updated: 2026-09-15

## Outcome and owner

Outcome: Fresh messages retain foreground priority after a system invocation
promotes into conversation processing.
Reaches: Warm replies, checkpoint interruption, and deferred background work.
Proof: Synthetic production-entrypoint regressions, existing provider and
shutdown coverage, assistant-runtime typecheck, and parent diff review.

Foreground wakes are compared against immutable startup mode. A repeated default
wake after promotion requests an unnecessary handoff, shortens the quiet window,
and disables foreground work. Derive effective mode at the existing foreground
owner; preserve the original request and true provider authority changes.
No persisted state, protocol, scheduler, dependencies, or new I/O is needed.

## Tasks and constraints

1. Add regression tests and verify failure before the fix.
2. Correct effective foreground mode, preserving genuine handoff and shutdown.
3. Prove repeated admission, quiet-window reset, snapshot interruption, and
   eventual deferred-effect completion without duplicate handling.
4. Run focused suites, typecheck, and complexity review; update owner docs.
5. Review the diff, close the plan, and create a scoped commit.

No production mutation or deployment. Use synthetic evidence only.
Prompt, tools, model input, and reply policy are unchanged; scheduling proof is
fully deterministic and does not benefit from a stochastic model journey.

## Verification

Before the fix, both conversation regressions failed at the assertion that a
duplicate default wake must not bypass the foreground quiet window. The tests
exercise the production entrypoint, mailbox import, system-work promotion, and
checkpoint coordinator; assistant execution and snapshot storage are test ports.

The permanent cases cover repeated input during the quiet window, arrival
during snapshot construction, provider-authority changes, and actual shutdown.
They verify three distinct assistant admissions, reset of the full 180-second
quiet window, snapshot cancellation, and eventual durable effects plus the
required follow-up checkpoint. Authority changes and shutdown checkpoint
promptly without processing the next input under the old owner.

Focused verification:

- Assistant-runtime priority, system-preemption, collapse, scheduling, and
  shutdown suites: 5 suites, 136 tests passed, including 4 new regressions.
- `pnpm --dir packages/assistant-runtime typecheck`: passed.
- `pnpm complexity:diff`: passed; source debt decreased from 493 to 492,
  maximum unchanged at 233. The affected wake helper decreased to 22.
  Existing outer-function hotspots do not justify a broader refactor here.
- `pnpm docs:drift` and `git diff --check`: passed.
- Final candidate review: source, regression proof, owner docs, privacy,
  unchanged authority boundaries, and scoped paths reviewed; no findings.

## Completion review and release boundary

Product UX: Ready at the deterministic runtime scheduling boundary. The replay
covers repeated warm messages, input during a checkpoint, deferred background
completion, and required authority/shutdown handoffs. Provider generation and
external message delivery are unchanged and are not proved by these test ports.
No model prompt, tool, provider request, or group-specific input is changed.

The fix reuses the existing qualified promotion evidence at both foreground
handoff checks. It preserves the original invocation request and controller
fence. No additional I/O, polling, timers, stored mode, or abstraction is added.
The fix changes no wire or persisted record shape. Existing warm invocations
retain old code until normal turnover after a future deployment.

Changelog decision: member-visible reply reliability improvement, eligible for
a same-PR release note when publishing a PR. This task ends with a local commit;
there is no source PR or shipped release to announce yet.
ReviewGPT and exact-head CI belong to the future pushed PR. Production rollout
and live latency confirmation remain outside this local fix.
Completed: 2026-09-15
