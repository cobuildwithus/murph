# Restore WHOOP consent completion

Status: active
Created: 2026-08-15
Updated: 2026-08-15

## Goal

- Restore the protected-main Junction WHOOP canary through provider consent,
  exact callback completion, persisted connection reload, and cleanup.

## Success criteria

- Secret-safe structural diagnostics distinguish a missing, hidden, disabled,
  loading, framed, or challenge-blocked consent action without recording page
  text, HTML, screenshots, credentials, or member data.
- The proven consent failure mechanism has focused regression coverage and the
  smallest fail-closed correction.
- Focused tests, typechecks, ReviewGPT gates, and required PR CI pass.
- The exact merge-triggered protected-main canary passes the real WHOOP sign-in,
  consent, callback, persisted reload, disconnect, and cleanup journey.

## Scope

- In scope: hosted-local provider authorization action discovery, secret-safe
  structural diagnostics, focused tests, and the protected canary contract.
- Out of scope: provider credentials, production Junction configuration,
  screenshots or DOM capture, generic browser profiles, challenge bypasses,
  alternate schedulers, and unrelated wearable flows.

## Constraints

- Keep credentials final-step scoped and cleared before browser launch.
- Preserve protected-main-only execution, sandbox Junction, serialized provider
  sessions, artifact prohibition, trusted authorization hosts, and exact callback
  plus persisted-state assertions.
- Treat hypotheses about the consent page only as questions until live structural
  evidence or a production-faithful regression proves the mechanism.

## Risks and mitigations

1. Risk: diagnostics disclose provider or member content.
   Mitigation: emit only bounded booleans, counts, document readiness, and trusted
   provider path classifications; never emit text, attributes, HTML, or images.
2. Risk: a broad fallback clicks a denial or unrelated provider action.
   Mitigation: retain positive action patterns, explicit negative-action rejection,
   trusted-host checks, visible/enabled requirements, and focused fixtures.
3. Risk: a synthetic correction does not match the current provider surface.
   Mitigation: require a protected-main live run first for structural diagnosis
   and again after the focused correction for terminal proof.

## Tasks

1. [x] Prove stable Chrome advances through WHOOP sign-in and fails at
   `id.whoop.com/consent` without an exposed automated action.
2. [x] Add bounded structural authorization diagnostics and focused coverage.
3. [ ] Complete local verification, commit, PR review gates, and required CI.
4. [ ] Merge the diagnostic boundary and classify the exact live consent shape.
5. [ ] Implement and verify the smallest correction for the proven mechanism.
6. [ ] Merge and obtain a passing protected-main WHOOP canary.

## Decisions

- Keep the stable-Chrome fix: it moved the live run from the sign-in boundary to
  the consent boundary, proving that browser selection solved the first failure.
- Do not broaden selectors from the path alone. Current WHOOP documentation says
  consent is completed with a `GRANT` action already matched by the driver, so
  live structural evidence is required to explain why that action is unavailable.
- Accepted the independent preliminary and final ReviewGPT finding that the
  first probe could count a denial as positive and miss hidden, computed-name,
  or framed actions. The corrected probe reuses Playwright accessible-name
  matching plus the driver's negative veto and has real headed-browser proof.
- Accepted final round 2's boundedness finding: pattern-by-pattern element
  reacquisition could outlive the browser-parent timeout on a changing page.
  The probe now uses one safe positive locator per role/frame plus one negative
  count, with short-timeout dynamic-DOM headed-browser proof.

## Verification

- Commands: focused browser-driver and workflow-contract Vitest files; relevant
  Web, hosted-local harness, and Cloudflare typechecks; docs/privacy/diff guards;
  exact-head required GitHub Actions; merge-triggered protected-main canary.
- Passed locally on the first corrected diagnostic head: 13 focused browser-driver
  tests, two real headed-browser smoke scenarios, Web typecheck, targeted ESLint,
  docs drift, diff check, and the privacy scan.
- Passed locally after the bounded-locator remediation: the same 13 focused
  tests, all three real headed-browser scenarios, Web typecheck, and targeted
  ESLint. Docs and diff/privacy guards are rerun before the next commit.
- Expected outcome: diagnostics first prove the current consent structure, then
  the corrected driver completes the full provider and persisted-state journey.
