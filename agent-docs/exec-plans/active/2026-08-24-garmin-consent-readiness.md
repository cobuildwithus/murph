# Stabilize Garmin consent surface readiness

Status: active
Created: 2026-08-24
Updated: 2026-08-24

## Goal

- Make the protected Junction Garmin canary wait for the exact Garmin consent
  surface to settle before validating or acting, without broadening authorized
  controls or weakening callback, persisted-state, or disconnect proof.

## Root-cause evidence

- The protected canary passed the full flow on the merge commit, then failed on
  the next `main` commit while entering Garmin consent.
- The failing run reached the exact Garmin selection route, rejected the
  surface because it did not yet expose exactly three checkboxes, and had
  continued navigating to Garmin sign-in by cleanup. This proves the exact
  shape check sampled a transient navigation state rather than a stable changed
  consent contract.
- The first implementation validated the checkbox count immediately after
  observing the selection URL. It had no readiness window before failing
  closed.

## Scope

- In scope: bounded readiness for the exact three-checkbox/one-enabled-`Save`
  consent surface, route re-evaluation while it settles, focused regression
  coverage, required review/CI, and a green protected post-merge Garmin canary.
- Out of scope: new provider actions, relaxed control counts, credential or
  provider-state repair, retrying submitted actions, or Oura/WHOOP behavior.

## Tasks

1. [x] Prove the transient consent-surface race from the protected canary.
2. [x] Add bounded exact-surface readiness and regression coverage.
3. [ ] Run focused verification and required PR review gates. The preliminary
   specialist review returned two accepted coverage findings: route departure
   must restart the outer authorization guard before any action, and the exact
   controls must be ready and revalidated at the final `Save` boundary. Both
   were remediated. Final round 2 then found the same stale-authority mechanism
   for a challenge appearing without URL departure. The recorded retrospective
   chose one outer-loop owner and deletion of the nested wait machinery.
4. [ ] Merge and prove the latest protected `main` Garmin canary green.

## Decisions

- Reuse the existing outer authorization loop and its 15-second blocked window
  as the sole readiness and admission owner. Delete the nested deadline,
  250 ms cadence, and departure status protocol.
- Re-evaluate trusted origin, host, provider challenge, Garmin step, and exact
  controls on every outer-loop observation before an action is admitted.
- Click only after the original exact three-checkbox and single enabled `Save`
  contract is simultaneously true, then re-read the route and final `Save`
  after checkbox mutation. A stable changed shape remains untouched and fails
  through the existing content-free blocked-window path.

## Verification

- Browser-runner unit suite, including a transient empty surface that settles
  and stable changed shapes that remain rejected.
- Real headed-Chromium authorization smoke.
- Hosted Web typecheck, docs drift, diff/privacy checks, ReviewGPT, exact-head
  required CI, and protected post-merge Garmin canary.

Completed local proof:

- Browser-runner unit suite: 45 passed, including unexpected-host, same-route
  provider-challenge, and Murph-departure revalidation plus final `Save`
  revalidation.
- Real headed-Chromium smoke: 8 passed, including delayed Garmin consent
  checkbox readiness on the exact route.
- Hosted Web typecheck and scoped ESLint: passed.
- Docs drift and diff checks: passed.
