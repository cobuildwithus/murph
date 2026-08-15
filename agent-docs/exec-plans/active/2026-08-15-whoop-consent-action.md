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
- Accepted final round 3's coherence finding: separate total, visible, and
  enabled queries could combine observations from different DOM states. Each
  role/frame now derives the positive partition synchronously from one matched
  element set; the dynamic-DOM proof asserts the complete pre-replacement state.
- Accepted final round 4's behavior-preservation finding: the diagnostic union
  had also replaced the existing action-first click precedence with role/DOM
  order. The click owner again evaluates the ordered vocabulary first, while
  the read-only terminal aggregate alone uses the union locator.
- Accepted final round 5's accessibility-semantics finding: a visually rendered
  control inside an `aria-hidden` subtree is absent from the real click/check
  owners but the probe had labeled it visible. Actions and checkboxes now share
  one browser-side structural aggregate that excludes composed ARIA-hidden
  ancestry from visible, enabled, checked, and unchecked classifications.
- Accepted final round 6's frame-exposure finding: child-document geometry does
  not prove that its embedding iframe is exposed. Each child root now receives
  one ephemeral exposure value from its iframe and composed ancestors, inherited
  through nested frames; hidden-frame controls retain structural totals only.
- Accepted final round 7's enabled-semantics finding: the aggregate had treated
  any outer `aria-disabled="true"` as authoritative. It now preserves native
  disablement and stops at the nearest valid composed ARIA value, matching
  Playwright when a descendant explicitly overrides an ancestor with `false`.
- The seven-round hard cap is reached. The accepted round-7 bug is corrected,
  but the automatic ReviewGPT loop is paused until the cap retrospective, local
  audits, parent final review, verification, and CI are complete and the user
  explicitly chooses whether to continue to round 8.

## Verification

- Commands: focused browser-driver and workflow-contract Vitest files; relevant
  Web, hosted-local harness, and Cloudflare typechecks; docs/privacy/diff guards;
  exact-head required GitHub Actions; merge-triggered protected-main canary.
- Passed locally on the first corrected diagnostic head: 13 focused browser-driver
  tests, two real headed-browser smoke scenarios, Web typecheck, targeted ESLint,
  docs drift, diff check, and the privacy scan.
- Passed locally after the bounded-locator remediation: the same 13 focused
  tests, all three real headed-browser scenarios, seven workflow-contract tests,
  Web, hosted-local harness, and Cloudflare typechecks, targeted ESLint, docs
  drift, diff checks, and the privacy scan.
- Passed the same full focused verification set after the coherent-snapshot
  remediation; the dynamic-DOM scenario now asserts the complete emitted action
  partition as well as its elapsed bound and eventual control replacement.
- Passed 13 focused browser-driver tests and all four real headed-browser
  scenarios after restoring action precedence; competing button/link order and
  a positive-plus-negative label now prove the higher-priority safe action wins.
- Passed the same focused and real-browser sets after aligning ARIA-hidden
  semantics; the structural summary counts the background action and checkbox
  but does not classify either as visible, actionable, or checkbox-gating.
- Passed the same sets after propagating embedding-frame exposure; the visible
  child action remains enabled, while an action and checkbox in an ARIA-hidden
  iframe contribute only to structural action/frame and checkbox totals.
- Passed 13 focused tests and all five real headed-browser scenarios after the
  nearest-ARIA correction. The added visible-frame case proves one inherited
  disabled action and one explicitly re-enabled action against Playwright and
  the exact content-free JSON partition.
- Expected outcome: diagnostics first prove the current consent structure, then
  the corrected driver completes the full provider and persisted-state journey.
