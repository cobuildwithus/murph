# PR 1367 Scheduled Tool Authority Corrections

## Outcome

Publish a corrected PR candidate in which an exact scheduled automation
occurrence can use only the existing capabilities that its route, audience, and
owner authorize, without fabricating an assistant-input identity or weakening
message-bound effects.

## Protected invariants

- Accepted-message identity and scheduled-occurrence authority remain distinct.
- Scheduled effects reuse existing owners, causal ordering, idempotency, and
  retry boundaries.
- Channel, audience, group, and verified-human restrictions remain authoritative.
- Failed provider or delivery work does not commit misleading product feedback.
- Clinical Records keeps one live short-lived intent and never resurrects an
  OAuth flow that has started or completed.
- No new durable state owner, queue, scheduler, migration, dependency, or
  compatibility layer is introduced.

## Evidence and implementation sequence

1. Compare the existing PR patch with current owner contracts and the supplied
   second-pass findings.
2. Replace synthetic assistant-input identity with a typed accepted-input or
   exact-occurrence invocation scope.
3. Correct personalization, Clinical Records, physical-note, support, and
   feedback behavior at their existing ownership boundaries.
4. Add focused regression coverage and align durable architecture, security,
   reliability, and product-owner documentation.
5. Run focused local proof and inspect the full base-to-head diff.
6. Push the corrected draft head, update the PR intent contract, and run the
   preliminary specialist and final ReviewGPT gates concurrently with CI.
7. Resolve accepted findings, complete parent final review, archive this plan,
   and leave the draft PR on a clean, mergeable, exact reviewed head.

## Verification

- Focused assistant-engine, hosted-execution, Cloudflare, and Web owner tests.
- Touched-owner typechecks or the narrowest truthful diff-aware lane.
- `git diff --check` and privacy/identifier review.
- Exact-head required GitHub Actions.
- Preliminary `completion-specialists` ReviewGPT pass with product-experience
  and coverage lenses.
- Final `pr-review` ReviewGPT loop through `ROUND_OUTCOME: PASS`.
