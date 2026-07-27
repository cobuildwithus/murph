# Bound local Crabbox verification spend

Status: active
Created: 2026-07-26
Updated: 2026-07-26

## Goal

- Stop ordinary local verification from silently creating paid Blacksmith
  Testboxes, while preserving one explicit, bounded remote escape hatch when
  the shared local verifier cannot admit work promptly.

## Success criteria

- Automatic executor selection stays local even when Blacksmith is configured.
- Explicit Crabbox runs always stop their Testbox and carry short idle and
  overall lifetime limits.
- The hydration workflow has a matching fail-safe timeout.
- Focused dispatcher/config tests and canonical local diff verification pass.
- Live verification docs and the Crabbox skill describe the same policy.

## Scope

- In scope: verification dispatcher selection and invocation arguments,
  Blacksmith Testbox profile/workflow limits, focused tests, and live
  verification guidance.
- Out of scope: reusable lease state, a coordinator, Testbox caching, runner
  right-sizing experiments, billing-dashboard settings, and production runtime
  behavior.

## Constraints

- Technical constraints: keep the dispatcher as the single executor-selection
  owner; preserve the existing secret-free sync and trusted-entrypoint boundary.
- Product/process constraints: verify trust-root workflow changes locally until
  the exact workflow lands on the default branch; do not create a paid Testbox
  while implementing this cost control.

## Risks and mitigations

1. Risk: shortening limits interrupts a legitimately long verification run.
   Mitigation: keep the explicit remote lane, set the ceiling well above the
   observed normal run duration, and fail visibly instead of leaking spend.
2. Risk: documentation and runtime defaults drift.
   Mitigation: update dispatcher tests, profile/workflow checks, the live
   verification docs, and the Crabbox skill in one change.

## Tasks

1. Make automatic executor selection local-only and keep explicit Crabbox
   selection available.
2. Add explicit Testbox cleanup, idle, and maximum-lifetime arguments and align
   the profile/workflow limits.
3. Update focused tests and durable guidance.
4. Run canonical local verification, direct config checks, review, and the
   scoped PR completion path.

## Decisions

- Prefer deleting automatic remote escalation over introducing reusable lease
  state or another scheduler.
- Keep the existing 16-vCPU job in this change; local-first selection removes
  the dominant invocation-frequency cost without adding a second hydration job.
- Accepted the preliminary review finding that an absolute admission-wait rule
  conflicted with mandatory trust-root validation. Ordinary remote escalation
  requires the wait; workflow or entrypoint changes require one post-landing
  proof without manufacturing a wait.

## Verification

- Commands to run: focused dispatcher/config tests, `git diff --check`, and
  `MURPH_VERIFY_EXECUTOR=local pnpm test:diff` for every touched path.
- Expected outcomes: automatic mode resolves locally; explicit remote mode
  contains cleanup and lifetime flags; profile/workflow bounds match; all
  selected checks pass without provisioning a Testbox.
