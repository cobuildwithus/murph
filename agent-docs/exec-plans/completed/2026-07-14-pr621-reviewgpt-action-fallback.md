# PR 621 ReviewGPT action fallback

Status: completed
Created: 2026-07-14
Updated: 2026-07-14

## Goal

Resolve PR #621 ReviewGPT round 1 by keeping optional usage-action eligibility
failures from rejecting Home or Settings and removing private Stripe-field
decryption from the projection path.

## Success criteria

- Usage status still resolves with `recommendedAction: null` when the narrow
  billing-action state read fails for paid exhaustion or trial conversion.
- Action eligibility reads only billing phase/plan/offer and the presence of
  customer/subscription lookup keys; it does not decrypt private Stripe fields.
- A redacted structured diagnostic records the failed optional action lookup
  without member identifiers, encrypted values, or exception messages.
- Home keeps the usage advisory and omits the CTA when the projection returns
  no action.
- Focused and routed web verification, required re-audits, current-main
  reconciliation, CI, and exact-head ReviewGPT round 2 pass.

## Constraints

- Keep the correction at the projection owner; do not add caller fallbacks,
  retries, persisted state, compatibility layers, or new abstractions.
- Billing mutations remain the final authorization and state-validation owner.
- Preserve reply continuity, group privacy, and all unrelated work.

## Verification

- Focused owner/caller coverage passed: 7 files, 144 tests. This includes paid
  exhaustion and trial conversion read failures, redacted diagnostics, Home's
  action-free advisory, the narrow store selector, the presence predicate,
  and the real expired-trial gate integration.
- Diff-aware guards passed dependency policy, workspace boundaries/cycles,
  hosted runtime/Temporal/crypto guards, and raw-log privacy checks.
- Web lint passed with 0 errors and 11 unrelated existing warnings. Prisma and
  Health Commons generation passed. The production Next build and TypeScript
  validation passed and generated all 188 pages.
- The concurrent full web suite passed 408 files with 1 skipped; 4,953 tests
  passed and 146 skipped. Its only failure was the unrelated
  `agent-session-routes.test.ts` setup hook crossing 60 seconds under host load;
  the isolated rerun passed 1 file and 11 tests.
- Concurrent and two isolated dev-smoke attempts reached Next readiness in
  11-13 seconds but did not serve the health route before the fixed 90-second
  deadline while workflow discovery ran on this loaded host. This is an
  explicit local verification gap; the exact pushed head's CI app verification
  remains the controller proof.

## Audit resolution

- ReviewGPT round 1 finding accepted after static reachability proof: the new
  Home projection calls the full Stripe billing snapshot for an optional CTA;
  that snapshot decrypts three private fields and propagates parse, envelope,
  KMS, and database failures through the server component.
- The correction catches only the optional action-state reads at the projection
  owner, emits a sanitized access-kind/error-name/plan-code diagnostic, and
  returns no action while preserving the already-computed usage status. The
  action path now uses only phase/plan/offer plus customer/subscription lookup
  presence; billing mutations still decrypt and revalidate the actual IDs.
- Security/privacy re-audit found no evidence-backed medium-or-higher issue.
  Group projection still exits before personal reads, diagnostics contain no
  member/private/message data, and both billing mutations retain exact-ID and
  Stripe customer ownership checks.
- Coverage-write found no missing stable-boundary proof and made no edits; its
  independent 7-file/144-test run passed.
- Parent final review found no unresolved issue or unnecessary state,
  retry/compatibility layer, dependency, unsafe cast, or caller-side fallback.
Completed: 2026-07-14
