# No-Card Signup Default

## Goal

Make no-card Pulse Trial signup the default hosted onboarding payment path when the invite reaches checkout, while preserving messaging setup and billing-readiness gates.

## Scope

- Hosted onboarding checkout stage selection.
- Pulse Trial rollout/default helpers and focused tests.
- No exercise-library, generated image, or unrelated pitch changes.

## Verification

- Passed: focused hosted onboarding tests for billing flags, join invite page rendering, and auto-trial enrollment service.
- Passed: hosted web typecheck.
- Passed: local signup proof reached the no-card auto-trial enrollment endpoint and activated the hosted member.
- Blocked: scoped commit is unsafe in this checkout because unrelated exercise-library files are in an unresolved merge-conflict state.

## Notes

- Existing unrelated exercise-library merge conflicts and generated image artifacts may block a scoped commit.
- Card-based Pulse Trial checkout remains separately gated by `HOSTED_PULSE_TRIAL_CHECKOUT_ENABLED`.
Status: completed
Updated: 2026-06-15
Completed: 2026-06-15
