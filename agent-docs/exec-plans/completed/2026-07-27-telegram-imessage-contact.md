# Give Telegram Murph its iMessage contact number

Status: completed
Created: 2026-07-27
Updated: 2026-07-29

## Goal

- Let Murph answer Telegram questions about its iMessage number with the
  member's assigned Murph line and a short, practical contact/group setup
  explanation. If a private Telegram-only member has no home line yet, assign
  exactly one on explicit request and reuse it afterward.

## Success criteria

- Telegram conversation wakes carry the current member-assigned Murph text
  number when one exists.
- The assistant prompt identifies that trusted number as Murph's iMessage
  contact and tells the model to use it for contact or group-add questions.
- Missing numbers remain absent rather than guessed.
- A current direct Telegram request can atomically assign one healthy pool
  line when the member has no existing or pending Linq route authority.
- Repeated or concurrent requests return the durable existing line and never
  consume another pool line.
- Direct and authenticated group Telegram paths keep their current identity,
  route, privacy, and delivery behavior.
- Focused tests, canonical diff verification, acceptance verification, and
  required completion reviews pass.

## Scope

- In scope:
  - Telegram wake contract and parser projection.
  - Existing member-routing lookup projection.
  - Telegram assistant-input metadata and prompt rendering.
  - A current-input-bound hosted tool and authenticated Web control route for
    read-or-assign behavior.
  - Existing member-row serialization, routing authority, and Linq line-pool
    selection primitives.
  - Focused Web, hosted-execution, assistant-runtime, and assistant-engine
    regression coverage.
- Out of scope:
  - New contact-card delivery or automatic outbound messages.
  - Reassigning, rotating, or selecting a caller-provided line.
  - New storage, settings, or frontend UI.

## Constraints

- Use the existing encrypted member-routing phone source of truth.
- Never guess or hard-code a Murph phone number.
- Only the current private direct Telegram input may authorize assignment.
- Lock and reread the member's route before consulting the pool; only
  `none` route authority may claim a line.
- Keep the optional field backward compatible across gradual Web/runner
  deployment.
- Do not expose member phone identity or provider credentials.

## Risks and mitigations

1. Risk: A user-controlled Telegram value could be presented as a trusted
   Murph number.
   Mitigation: Web derives the value only from decrypted member routing and the
   runtime accepts only normalized E.164-shaped phone data.
2. Risk: Old Web or runner versions disagree during deployment.
   Mitigation: Make the field optional; old producers omit it and old
   consumers ignore it.
3. Risk: Murph announces the number without relevance.
   Mitigation: Prompt guidance says to use it only for questions about
   contacting or adding Murph on iMessage.
4. Risk: Repeated or concurrent requests exhaust the shared number pool.
   Mitigation: Web locks the durable member route, rereads the assignment, and
   persists the chosen line in the same transaction. Only route authority
   `none` can reach the pool.
5. Risk: A model tool call assigns a line for another member or stale input.
   Mitigation: The tool accepts no member or phone argument, binds one current
   assistant input id, and Web verifies it belongs to the authenticated member
   and a direct Telegram wake.

## Tasks

1. [x] Add failing focused regressions for Telegram wake and prompt behavior.
2. [x] Carry the assigned Murph number through the existing optional contract.
3. [x] Add current-input-bound, atomic read-or-assign behavior.
4. [x] Run focused and canonical verification.
5. [x] Complete the required specialist pass and parent final review; the
   final PR gate follows plan closure.
6. [x] Commit, push, open the PR, and close this plan.

## Verification

- Focused tests for:
  - Web Telegram wake production.
  - Hosted execution parsing/building.
  - Runtime assistant-input projection.
- Assistant Telegram prompt rendering.
- Hosted tool authorization, request/response parsing, and transport.
- Existing-number reuse, first assignment, repeat idempotency, pending-route
  refusal, and non-direct/non-Telegram refusal.
- `pnpm test:diff` for all touched source, tests, and plan paths.
- `pnpm verify:acceptance`.

## Results

- Focused Web, hosted-execution, assistant-runtime, and assistant-engine tests
  passed (221 tests).
- `pnpm verify:acceptance` passed, including 7,054 Web tests, 2,014
  Cloudflare tests, production builds, typechecks, lint, coverage, and guards.
- `pnpm test:diff ...` passed every changed owner before the existing
  hosted-local harness ordering issue: the command's earlier runtime test
  removed `packages/assistant-runtime/dist`, which the later harness requires.
  Rebuilding `@murphai/assistant-runtime` and rerunning the exact blocked
  harness passed (410 tests, 1 skipped).
- Product-experience review returned `NO FINDINGS`. No rendered UI evidence is
  applicable.
- Follow-up review narrowed the source to the member's existing
  `linqRecipientPhone` only. A pending pre-activation line is deliberately
  omitted from ordinary prompt context.
- The expanded requirement adds an explicit-request hosted tool. It returns
  `linqRecipientPhone` when present. Otherwise it locks and rereads the route,
  permits pool selection only for `none` authority, and saves one bare home
  line in the same transaction. Pending or existing chat authority fails
  closed instead of claiming a second line.
- A controlled two-transaction regression holds the first assignment before
  commit and proves the second request waits, rereads the durable number, and
  never reaches the pool. The safe unavailable result tells the model that no
  number was assigned, keeps the member on Telegram, allows a later retry, and
  forbids guesses or availability promises.
- Final focused tests passed: Assistant Engine 22 tests and Web 5 tests. All
  new test and evaluation-style strings are English.
- Canonical `pnpm test:diff ...` passed all affected owners and reverse
  dependents. This included 2,753 Assistant Engine tests, 1,896 Assistant
  Runtime tests, 1,083 CLI tests, 418 hosted-execution tests, 410 hosted-local
  harness tests, 7,058 Web tests, 2,014 Cloudflare Node tests, 2 Cloudflare
  Workers tests, lint, dev smoke, production build, and package boundaries.
- Final acceptance reached green workspace typecheck, all package coverage
  (including 2,754 Assistant Engine and 1,896 Assistant Runtime tests), and
  7,059 green Web tests. Its Web dev-smoke helper timed out once despite Next
  reporting ready; the exact prepared-local-env smoke passed immediately on
  rerun, and the final production Web build passed.
- The final Cloudflare verification encountered one unrelated 60-second
  timeout in the existing configured-AI-binding container test after the full
  test process stalled. That exact test passed alone in 11.8 seconds. The
  prior canonical diff run had already passed all 2,014 Node and 2 Workers
  tests with the final Cloudflare implementation.
- Product-experience review initially requested a safe unavailable contract
  and real concurrent proof. Both were implemented; its remediation review
  returned `PURPOSE_VERDICT: PASS` and `NO FINDINGS`.
- The preliminary ReviewGPT specialist pass inspected exact pushed commit
  `9dfb76a79d2093b28de8f0322925d0f87f1044d3`. Four findings were accepted:
  make transport-failure guidance uncertainty-safe, prove the signed-member
  route composition, prove the complete planner exposure gate, and prove both
  exhausted and unassignable pool results avoid persistence.
- The resulting focused proof passed 68 Assistant Engine tests and 10 Web
  route/service tests. All added test and evaluation-style strings are
  English.
- The post-remediation canonical `pnpm test:diff ...` passed in one prepared
  run: 2,759 Assistant Engine tests, 1,896 Assistant Runtime tests, 1,083 CLI
  tests, 6,876 Web tests, 2,014 Cloudflare Node tests, 2 Cloudflare Workers
  tests, package boundaries, typechecks, lint with zero errors, Web dev smoke,
  and the production Web build.
- Parent final review found no remaining accepted issue. The request parser is
  strict and accepts only the current assistant input id; Web obtains member
  authority from the signed callback, validates a current direct Telegram
  wake, locks and rereads durable routing, and reaches the pool only for
  `none` authority.
Completed: 2026-07-29
