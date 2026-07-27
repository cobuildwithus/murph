# Bound local Crabbox verification spend

Status: completed
Created: 2026-07-26
Updated: 2026-07-27

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

- Direct dispatcher contract: passed; automatic mode stayed local and explicit
  remote arguments contained always-stop, 10-minute idle, and 45-minute
  lifetime controls.
- Focused dispatcher/trusted-entrypoint suites: 2 files and 21 tests passed.
- Canonical local repo-tool diff lane: 29 files and 421 tests passed after two
  unrelated load-sensitive tests passed in isolation.
- Preliminary ReviewGPT specialist pass: one medium prompt-policy conflict
  accepted and fixed; no patch artifact returned.
- Focused release-policy contract after remediation: 40 tests passed and 1
  intentional skip.
- The remediation-scoped canonical lane passed all guards, workspace
  boundaries, and CLI typecheck before unrelated existing 60-second
  `assistant-cli.test.ts` subprocess timeouts and follow-on experiment CLI
  failures; the owned failed verifier was stopped after that boundary was
  established.
- YAML parsing, Node syntax, diff hygiene, and the parent final review passed.
- No verification step provisioned a Blacksmith Testbox. The workflow change
  requires one explicit post-landing remote proof after merge.
Completed: 2026-07-27
