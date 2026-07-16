# WHOOP direct-connect capacity fallback

Status: completed
Created: 2026-07-16
Updated: 2026-07-16

## Goal

- Keep direct WHOOP connection available while Murph is below WHOOP's
  10-member development cap, then guide additional members through WHOOP's
  Apple Health sync and the Murph iPhone app.

## Success criteria

- The authenticated Web connect-start boundary counts distinct current WHOOP
  members across direct WHOOP and Junction `whoop_v2` connections.
- A member already counted can reconnect at capacity; a new member receives a
  stable, non-retryable capacity error when 10 members are already counted.
- Both dashboard starts and assistant-issued connect intents use the same gate.
- The connect page recognizes only that capacity error and shows an accessible,
  focused Apple Health setup path with the official Murph App Store link.
- No assistant-runtime behavior, migration, reservation, lock, feature flag,
  dependency, or new persisted state is introduced.
- Focused tests, Web typecheck, browser proof, required specialist audits,
  green PR CI, and the exact-head ReviewGPT loop all pass.

## Scope

- In scope: the Web-owned connect-start policy, typed error recognition,
  connect-page fallback UI, focused tests, and existing durable product copy if
  implementation proof finds it stale.
- Out of scope: assistant runtime prompts, WHOOP OAuth-session reservations,
  concurrency locking, provider-account deletion, schema changes, and native
  app changes.

## Constraints

- Prefer one bounded read at the authenticated start boundary and reuse the
  existing source identity model.
- Treat `disconnected` connections and sources as not occupying a current
  member slot; do not expose member counts or identifiers to the browser.
- Preserve existing consent, authentication, intent-claim, and provider-start
  ordering and release behavior.
- Reuse installed shadcn/Base UI primitives and semantic theme tokens.

## Risks and mitigations

1. Risk: direct WHOOP and Junction WHOOP rows could double-count one member.
   Mitigation: query distinct member IDs across both canonical storage paths.
2. Risk: a page-only check could be bypassed by dashboard starts or stale UI.
   Mitigation: enforce at the shared authenticated server start boundary and
   use the page only to present the typed error.
3. Risk: two new members could race for the last slot.
   Mitigation: accept this low-scale theoretical race explicitly; do not add a
   lock or reservation unless observed usage makes that complexity necessary.
4. Risk: provider-specific fallback behavior could leak into assistant runtime.
   Mitigation: keep link issuance unchanged and contain the policy in the Web
   device-connect owner.

## Tasks

1. Prove the current WHOOP target identities, persisted connection statuses,
   error transport, and connect-page state transitions.
2. Implement the minimal server capacity assertion and typed error.
3. Add the inline Apple Health fallback and exact error recognition.
4. Add focused server, helper, and UI coverage; run typecheck and browser proof.
5. Run frontend and coverage audits, parent final review, then commit, push, open
   the PR, and complete CI plus the ReviewGPT loop.

## Decisions

- Enforce at the shared Web connect-start boundary so all Web entry points share
  one policy while assistant link generation remains unchanged.
- Count distinct current members, not concurrent requests or historical rows.
- Allow an already-counted member to reconnect even when capacity is full.
- Present Apple Health as the supported fallback only after the server reports
  that direct WHOOP capacity is full.

## Outcome

- Added one Web-owned admission check at the shared authenticated connect-start
  seam. It counts distinct current WHOOP members across the direct provider and
  Junction `whoop_v2`, preserves reconnects, and returns one typed capacity
  error before provider work begins.
- Kept assistant link issuance unchanged. The existing connect page handles the
  typed error for both manual starts and assistant-issued intents and presents
  the Apple Health fallback inline.
- Added no schema, persisted state, lock, reservation, feature flag, dependency,
  or assistant-runtime behavior.

## Verification results

- Focused Vitest: 3 files and 110 tests passed, including the ninth-to-tenth
  member boundary, rejection at 10, reconnect at 10, intent release, and both
  fallback entry paths.
- Scoped Web verifier passed dependency and boundary guards, typecheck, dev
  smoke, lint with no errors, 5,283 tests, and the production Next build.
- Final targeted typecheck and lint passed after audit remediation.
- Desktop 1440×900 and mobile 390×844 browser proof passed with no horizontal
  overflow, correct external-link semantics, visible keyboard focus, and no
  inherited link underline.
- `coverage-write` passed after the exact last-slot test was added.
- `frontend-review` passed after contrast and prose-link styling findings were
  remediated and re-verified.
- Parent final review, identifier/credential scans, and `git diff --check`
  passed locally. PR CI and ReviewGPT remain the required post-push gates before
  merge-readiness.
Completed: 2026-07-16
