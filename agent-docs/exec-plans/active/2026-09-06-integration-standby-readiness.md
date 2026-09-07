# Let hosted integration smoke observe standby readiness

Status: active
Created: 2026-09-06
Updated: 2026-09-06

## Goal

- Restore hosted foreground integration setup without weakening standby readiness or changing member runtime behavior.

## Success criteria

- Explain the repeated zero-ready, two-provisioning smoke failure from current code and CI evidence.
- Prove the smallest correction with focused regression tests and the real hosted scenario where available.
- Preserve explicit operator smoke overrides and bounded failure behavior.

## Scope

- In scope: hosted-local smoke retry configuration and its verification.
- Out of scope: production standby lifecycle changes, other agents' runtime optimizations, and external deployment-check configuration.

## Constraints

- Keep production smoke and readiness owners authoritative; do not skip or weaken their checks.
- Use an isolated task checkout and synthetic provider fixtures. Preserve active process ownership.

## Risks and mitigations

1. A longer poll window could mask a real preparation failure. Verify whether preparation completes, retain the canonical deadline, and report any later failure independently.

## Tasks

1. Compare failed startup timing with readiness and smoke policy.
2. Exercise a longer existing override before changing source.
3. Remove the premature local override if direct proof supports it; run relevant tests and typecheck.
4. Review and commit the narrow correction and evidence.

## Decisions

- Both failed suites and a later main run failed before their scenarios ran. The local harness caps one-second polling at 30 attempts, while standby preparation permits 75 seconds.
- Remove only the local attempt override. Keep one-second local polling, explicit caller limits, canonical wall-clock failure, and all readiness checks.
- The real local probe completed standby provisioning after 25 failed polls and passed managed-container smoke. This confirms the path works locally but does not reproduce the slower CI timing; the synthetic 45-poll regression isolates that timing boundary.

## Verification

- Focused hosted-local stack tests, smoke-client regression tests, and harness typecheck.
- Hosted foreground-priority E2E with synthetic providers; distinguish setup proof from full scenario proof.
- Harness composition regression fails on the old default of 30 and passes after deletion. All 82 stack tests pass, including explicit override and proof-recording coverage; harness typecheck passes.
- All 54 smoke-client tests pass, including the paired 30-attempt failure/canonical-policy success regression, deadlines, explicit limits, manifest checks, and live-turn no-retry behavior.
- Complexity guard passes with unchanged existing debt and maximum. Real foreground-priority scenarios are still running after successful startup.
