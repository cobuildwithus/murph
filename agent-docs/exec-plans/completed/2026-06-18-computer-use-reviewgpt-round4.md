# Computer Use ReviewGPT Round 4 Fixes

## Goal

Resolve accepted ReviewGPT round 4 findings for PR 214 with the smallest
durable changes that preserve the computer-use primitives and keep Kernel
browser/session authority owned by `apps/web`.

## Constraints

- Keep the architecture simple and composable; delete unsafe/general surfaces
  before adding new ones.
- Keep Kernel API keys, live-view URLs, browser/session ids, cookies, and local
  paths out of prompts, logs, fixtures, docs examples, and user-facing output.
- Preserve `computer_pause_for_user` as the durable user checkpoint primitive.
- Do not keep long-lived Codex turns blocked on human input.
- Avoid new lock-manager abstractions unless a failing proof shows short atomic
  state transitions are insufficient.

## Accepted Findings

1. `computer_eval` exposes arbitrary Playwright execution to the model.
2. Awaiting-run resume can be triggered by an unrelated later member message.
3. Computer tool timeouts can hide unknown browser side effects behind a generic
   unavailable error.
4. Kernel calls run inside database transactions and the member lock does not
   serialize concurrent starts.
5. Finish/login-checkpoint races can orphan an authenticated replacement browser.
6. Local deep review found stale checkpoint, terminal pause, ambiguous Kernel
   failure, and suspension edge cases in the first fix pass.
7. Audit reruns found persisted handoff-link tokens, missing handoff-page
   suspension checks, stale cleanup terminal overwrites, and failed-start
   browser cleanup leaks.
8. Final local audit found missing server-side resume proof, expired open
   handoffs that could strand resume, stale login-checkpoint resumes that
   returned unusable awaiting handles, and an ungated finish path.
9. Security rerun found resume freshness trusted provider event time, resume
   proof was not bound to the paused delivery context, and pause transport
   failures could leave an undelivered checkpoint awaiting user input.
10. Final state/security reruns found pause cleanup reused an aborted parent
    signal, concurrent cold starts could insert multiple active runs, stale
    handoff expiry could race a fresh checkpoint claim, and concurrent-start
    loser browsers needed durable cleanup ownership.

## Plan

1. Verify each finding against current code and reject only if not reachable.
2. Delete or narrow the unsafe model-facing surface first.
3. Replace implicit resume with explicit run-bound resume semantics plus a
   server-verified newer hosted conversation mailbox item and hidden delivery
   context match before awaiting runs transition back to running.
4. Make timeout/unknown-outcome behavior explicit for mutating tools.
5. Move Kernel calls out of database transactions using short conditional claims.
6. Tighten state transitions with conditional run/handoff predicates, without
   adding a new lock manager.
7. Keep start concurrency to a short profile-row DB claim after browser
   creation; if a loser browser is created, persist it as a cleanup-owned run
   with a guaranteed-stale expiry before returning the winning run.
8. Add focused regression tests for the accepted bug classes.
9. Rerun focused owner tests/typechecks/lint plus required audits and PR review
   loop.

## Verification

- Focused hosted computer-use web tests.
- Focused assistant-engine computer tool tests.
- Focused hosted-execution and Cloudflare outbound tests.
- `apps/web` typecheck/lint where touched.
- `packages/assistant-engine` typecheck.
- `packages/hosted-execution` and `apps/cloudflare` typecheck where touched.
- Diff-aware or owner-level verification after the final diff is stable.

## Working Set

- Computer-use service/store/API contract and assistant dynamic tools.
- Focused hosted computer-use, assistant-engine, hosted-execution, and
  Cloudflare outbound tests.
- Security docs and hosted-web route inventory docs for the removed eval route.
Status: completed
Updated: 2026-06-18
Completed: 2026-06-18
