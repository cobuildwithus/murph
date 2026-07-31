# Daily wrong-line redirect reminders

Status: active
Created: 2026-07-31
Updated: 2026-07-31

## Goal

- When a member messages a managed Linq conversation that is not their current
  home conversation, remind them where to continue at most once per UTC day
  instead of only once for the lifetime of that route.
- Rotate those reminders through at least 100 distinct, direct message variants.

## Success criteria

- Two wrong-conversation inbound events on the same UTC day converge on one
  durable redirect effect.
- A wrong-conversation inbound on the next UTC day creates a fresh redirect
  effect, while replaying the same inbound remains stable.
- A home-line change still creates a fresh redirect effect.
- Every redirect variant names the current home number and clearly asks the
  member to continue or resend there.
- The redirect bank contains at least 100 unique rendered variants.
- Focused tests and the `apps/web` typecheck pass.

## Scope

- In scope: redirect idempotency identity, trusted occurrence-time plumbing,
  redirect message variants, focused regression tests.
- Out of scope: unsolicited reminders, scheduled sends, route reassignment,
  provider retry policy, schema changes, and other message families.

## Constraints

- Technical constraints: derive the day from the accepted provider occurrence
  time so webhook retries cannot cross server-clock midnight into a new effect;
  preserve the existing delivery owner and provider fence.
- Product/process constraints: remain inbound-triggered, link-free, concise,
  and reciprocal-conversation shaped under the iMessage deliverability policy.

## Risks and mitigations

1. Risk: a retry near midnight sends a second redirect.
   Mitigation: hash the provider event's UTC day, not processing time.
2. Risk: daily eligibility becomes unsolicited daily outreach.
   Mitigation: create effects only while handling a fresh wrong-conversation
   inbound; add no cron, wake, or proactive path.
3. Risk: a large bank becomes filler or obscures the required action.
   Mitigation: keep each variant explicit about moving or resending to the
   interpolated home number and assert the unique rendered bank size.

## Tasks

1. Add the inbound occurrence day to the redirect effect identity and payload.
2. Pass the planner's normalized occurrence time into redirect construction.
3. Expand the redirect copy bank to at least 100 unique direct variants.
4. Add same-day, next-day, replay, line-change, and copy-bank regression proof.
5. Run focused tests and typecheck, then complete the routed PR review gates.

## Decisions

- "Once a day" means at most one reminder per member, wrong Linq chat, current
  home line, and UTC day when that member sends an inbound in the wrong chat.
- Reuse the existing deterministic delivery effect instead of adding persisted
  reminder state.
- Accepted the preliminary specialist's two related findings: continue-only
  copy could imply that the unprocessed inbound moved between threads, and the
  original broad keyword assertion admitted nouns and inflections as false
  positives. Rendering now adds a direct no-transfer/resend sentence whenever
  an authored variant lacks an explicit send/resend construction, and the
  focused assertion matches only that concrete action.
- The preliminary pass returned no patch artifact. The first final ReviewGPT
  attempt failed during draft staging and produced no review verdict or final
  round baseline; final round 1 must start fresh on the corrected pushed head.

## Verification

- Commands to run:
  - focused Vitest for Linq transport, dispatch, and user-facing messages
  - `pnpm --filter web typecheck`
  - `git diff --check`
- Expected outcomes: all focused assertions pass; no type errors or whitespace
  errors; exact-head CI and required ReviewGPT stages pass before completion.
- Local results:
  - PASS: focused transport and user-facing-message Vitest run (84 tests).
  - PASS: focused Linq dispatch redirect scenarios (4 tests; 151 unrelated
    scenarios skipped by the name filter).
  - PASS: `pnpm --filter @murphai/hosted-web typecheck`.
  - PASS: `pnpm docs:drift` and `git diff --check`.
  - CONFIRMED: 104 authored redirect variants; rendered uniqueness and required
    home number/action language are covered by the focused message tests.
- Corrected-head results after specialist remediation:
  - PASS: focused transport and user-facing-message Vitest run (84 tests).
  - PASS: focused Linq dispatch redirect scenarios (4 tests), including proof
    that wrong-line input is not mailbox-enqueued and the provider copy gives
    an explicit resend instruction.
  - PASS: `pnpm --filter @murphai/hosted-web typecheck` and `git diff --check`.
- Corrected-head product-purpose verdict: PASS. The irreducible purpose is to
  prevent a recognized member from waiting on an unprocessed wrong-line
  message. The smallest complete experience remains one immediate, link-free
  redirect in that chat with the current home number and an explicit resend
  action. The corrected renderer makes the no-transfer fact truthful across
  all 104 variants without adding a screen, choice, scheduler, or continuation.
  No material product-experience evidence gap remains: the dispatch scenario
  proves the input is not enqueued and the reply is actionable, while existing
  provider-retry coverage owns delivery recovery.
- Pending: corrected exact-head CI and final ReviewGPT gate for the
  idempotency/external-egress change. The one substantive preliminary pass is
  complete and its accepted findings are resolved locally.
