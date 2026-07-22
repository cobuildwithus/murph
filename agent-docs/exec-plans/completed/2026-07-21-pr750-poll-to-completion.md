# Let scheduled Codex poll consented asks to completion

Status: completed
Created: 2026-07-21
Updated: 2026-07-21

## Goal

- Remove the prompt-level fixed 60-second wait and one-retry policy from PR 750.
- Let the existing scheduled Codex turn poll the same idempotent `ask_member`
  call until Web returns a terminal result.

## Success criteria

- After `accepted`, Codex waits with ordinary shell execution and repeats the
  exact same call while it remains accepted.
- `completed` supplies ordinary current-turn data and `unavailable` ends the
  wait without an answer.
- The existing Web-owned request expiry remains the hard safety bound.
- No long-held callback, second provider turn, scheduler, queue, continuation,
  or new state owner is introduced.

## Scope

- Group tool and skill guidance, matching durable docs, and focused prompt
  contract tests.
- No change to the existing idempotent request/completion protocol or its
  ten-minute expiry.

## Tasks

1. Replace fixed wait/retry wording with terminal-result polling guidance.
2. Align the security, protocol, and product-spec docs.
3. Update focused prompt tests and run scoped plus diff-aware verification.
4. Run the required prompt-review pass, commit the scoped cleanup, fast-forward
   `main`, and close this plan.

## Decision

- Codex owns the short polling loop inside the ordinary scheduled turn. Web
  continues to answer each short idempotent tool call and never holds an HTTP
  request open while the member runtime works.

## Audit outcome

- The required prompt-review pass reported zero evidence-backed findings. It
  confirmed that the skill and tool description consistently start all asks,
  exactly replay accepted calls, stop on completed or unavailable, retain the
  server-owned expiry, and preserve authority and privacy boundaries.
- Residual evaluation risk is limited to model-selected polling cadence and
  exact-argument preservation across concurrent asks; prompt contract tests
  cover the intended wording and terminal statuses.

## Verification

- `pnpm test:diff` passed every affected guard and typecheck plus 7,560 tests
  across Assistant Engine, Assistant CLI, Assistant Runtime, assistantd, CLI,
  Setup CLI, and Cloudflare Node/Workers lanes.
- The focused group skill/tool command passed 81 tests after the final wording
  and assertion cleanup.
- Assistant Engine typecheck, `pnpm docs:drift`, and `git diff --check` passed.
Completed: 2026-07-21
