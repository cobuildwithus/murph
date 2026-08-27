# Appointment memory reuse and browser recovery

Status: active
Created: 2026-08-27
Updated: 2026-08-27

## Goal

- Reuse relevant canonical member facts before asking the member to repeat them.
- Route appointment check-in and intake through the existing appointment workflow.
- Keep browser execution moving through bounded, state-aware recovery before
  asking the member to take over.

## Product UX Patch

- Outcome: a private member can delegate an appointment administrative task and
  have Murph complete every authorized step it can, without repeat questions or
  premature browser handoff.
- Reaches: private appointment check-in, intake, booking, rescheduling,
  cancellation, waitlist, and related browser forms.
- Proof: prompt-contract tests, appointment-skill tests, and focused real-Codex
  journeys for ordinary control recovery and a legitimate safety stop.

## Scope

- In scope: the base evidence-before-question rule, appointment skill routing
  and readiness language, browser blocker guidance, focused tests, and live
  model proof.
- Out of scope: a new member-data schema, storing sensitive identifiers in
  freeform memory, bypassing access controls, and changing browser runtime
  retry mechanics.

## Constraints

- Read only the relevant canonical source; do not preload the full memory file
  into every turn.
- Reusable evidence is not current permission to disclose it.
- Keep insurance identifiers, full addresses, credentials, and medical details
  out of freeform memory unless an existing structured owner explicitly owns
  them.
- A failed or unresponsive control is not yet a blocker. Re-inspect state before
  retrying, use a safe alternate path and OS fallback when appropriate, and
  refresh only when no side effect is unknown and user-entered state is safe.
- Never bypass CAPTCHA, access controls, credentials, payment entry, an
  unapproved sensitive disclosure, or a real missing user choice.

## Tasks

1. Add the global evidence-before-question rule and align the browser blocker
   rule with the computer-use recovery contract.
2. Extend appointment scheduling semantics to check-in and intake while
   preserving disclosure and persistence boundaries.
3. Add deterministic prompt and skill coverage.
4. Add focused GPT-5.6 TERRA journeys for memory reuse plus ordinary-control
   recovery, and for the real safety-stop boundary.
5. Run focused verification and typecheck, inspect the privacy-sensitive diff,
   then push the exact candidate and run preliminary ReviewGPT concurrently
   with CI.

## Verification

- Focused Assistant Engine prompt and skill tests.
- Focused real-Codex TERRA journeys with inspected replies and tool traces.
- Assistant Engine typecheck and diff-selected verification.
- `git diff --check` plus direct-identifier scan and manual diff inspection.
- Exact-head CI and preliminary Product UX, prompt, and coverage ReviewGPT.

## Progress

- Implemented the evidence-before-question rule, appointment check-in and
  intake routing, bounded browser recovery, and canonical persistence boundary.
- Focused deterministic suite: 28 passed and 109 skipped.
- Assistant Engine typecheck: passed.
- Focused GPT-5.6 TERRA ordinary-control journey: passed after re-opening the
  current page and using a distinct recovery action without member handoff.
- Focused GPT-5.6 TERRA CAPTCHA journey: passed with one scoped pause, a fresh
  handoff URL, and no attempted bypass.
- Preliminary ReviewGPT at the first pushed candidate returned one high and two
  medium findings plus a SHA-identified direct-proof patch. The patch was
  downloaded through the authenticated artifact flow, verified, and applied.
- Review follow-up narrowed the global evidence rule, kept check-in identity
  fields destination-driven, permitted explicitly authorized one-time DOB use
  without storage, made appointment-skill routing explicit, and strengthened
  browser escalation proof.
- Additional focused GPT-5.6 TERRA journeys passed for a form that does not
  require DOB and for a DOB-required form where the member declines storage.
- Final representative first-request measurement against the current base uses
  the prior complete pinned-App-Server capture plus the exact current serialized
  deltas under `gpt-tokenizer` 3.4.0 `o200k_harmony`. The private
  browser-enabled route changes from 28,985 tokens / 132,847 bytes to 29,104 /
  133,470 (+119, +0.4106%; +623 bytes, +0.4690%): +105 tokens / +553 bytes are
  assembled instructions and +14 / +70 are the `computer_act` descriptor. The
  group route, where private computer tools are unavailable, changes from
  25,475 / 116,870 to 25,580 / 117,423 (+105, +0.4122%; +553 bytes, +0.4732%),
  all in assembled instructions. Conversation content, other tool/schema or
  generated guidance, transport framing, provider output, and later turns are
  unchanged or excluded identically.
- Second ReviewGPT on the exact follow-up head confirmed the original global
  evidence and durable-DOB findings were resolved. It returned three medium
  findings plus a SHA-identified coverage patch: split booking-call identity
  from destination-driven check-in identity, reject fake browser recovery
  actions, and seed saved DOB in the no-DOB disclosure probe.
- Applied and verified the ReviewGPT coverage patch, split the call rule, and
  added a focused GPT-5.6 TERRA booking-call journey. The generated brief read
  both owning skills and included exactly the approved patient name and
  normalized DOB even when public instructions omitted identity fields.
- Tightened the browser contract so a safe alternate leads to one targeted OS
  fallback and a refreshed success state forbids repeating it. Clarified that
  specifically authorized DOB and insurance fields may be entered through
  `computer_act` without takeover, while credentials, OTPs, payment, CAPTCHA,
  and unprovided sensitive facts remain handoff boundaries.
- Strengthened the synthetic recovery form to preserve entered fields and
  return the real sanitized OS-control response shape. The resulting TERRA
  journey passed with four act calls, five state inspections, one OS click,
  zero handoffs, verified completion, and no generic insurance-memory write.
- Focused prompt and skill contracts after the second review: 33 passed and 7
  skipped. The saved-DOB/no-DOB live journey also passed with no DOB disclosure
  and zero memory writes.
- Merged the current `origin/main` into the branch without dropping either the
  appointment regressions or the base branch's independent real-provider
  fixture. On that merged candidate, 108 deterministic tests passed with 7
  provider cases skipped, Assistant Engine typecheck passed, and the TERRA
  recovery journey passed with five browser actions, four current-state opens,
  one OS fallback, no takeover, and verified completion.
- A third exact-head preliminary ReviewGPT follow-up applied the current
  official GPT-5.6 guidance and returned two medium findings plus a
  SHA-256-identified test-only patch. Both findings were accepted: the generic
  browser approval/disclosure policy now has one owner in `computer-use`, the
  immediate `computer_act` contract permits specifically authorized
  non-credential health or identity input and approved final terms, and the
  supplied recovery fixture patch rejects duplicate OS effects or a stale
  post-OS browser action.
- ReviewGPT's coverage patch reverse-applies cleanly after application. The
  corrected focused suite passed 40/40, the full changed prompt/skill/tool set
  passed 95 tests with 124 opt-in provider cases skipped, the changed skill
  asset rerun passed 25 tests with 7 skipped, and Assistant Engine typecheck
  passed.
- The strengthened GPT-5.6 TERRA journey passed against the strict recovery
  state machine with five browser actions, four opens, exactly one OS fallback,
  no takeover, verified completion, and a truthful current-task-only statement
  for the synthetic insurance identifier.
