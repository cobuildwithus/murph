# Restore automated WHOOP authorization canary

Status: active
Created: 2026-08-15
Updated: 2026-08-15

## Goal

- Restore the protected-main Junction WHOOP canary so its automated browser can
  complete the current WHOOP sign-in and authorization journey and prove the
  persisted connection state.

## Success criteria

- A focused synthetic browser regression reproduces the current authorization
  page shape and fails against the pre-fix action classifier.
- The browser driver handles that shape without weakening CI fail-closed or
  manual-recovery boundaries.
- The workflow contract test, browser-driver tests, relevant typecheck, privacy
  review, preliminary specialist review, final ReviewGPT gate, and exact-head
  required CI pass.
- A protected-main canary passes after the reviewed change merges, or the exact
  remaining protected-main merge boundary is reported with the PR left active.

## Scope

- In scope: WHOOP authorization-page action discovery in the hosted-local live
  browser driver, focused synthetic coverage, and owner documentation only if
  the executable contract changes.
- Out of scope: provider credentials, production Junction configuration,
  generic provider lifecycle changes, and broader browser automation rewrites.

## Constraints

- Technical constraints: keep provider credentials step-scoped; preserve headed
  CI automation, artifact prohibition, bounded timeouts, and explicit stage
  diagnostics without page contents or identifiers.
- Product/process constraints: prefer the smallest selector/classification
  correction; do not add a fallback scheduler, state owner, or manual CI path.

## Risks and mitigations

1. Risk: a broad text click authorizes an unintended action.
   Mitigation: scope discovery to visible interactive controls and lock accepted
   labels and destinations in synthetic tests.
2. Risk: a fixture encodes confidential provider content.
   Mitigation: retain only minimal generic DOM structure and synthetic labels;
   do not store screenshots, HTML captures, account data, or provider responses.
3. Risk: a local fix passes while the real provider still presents a challenge.
   Mitigation: require the protected-main external-provider canary as the final
   live proof after exact-head review and merge.

## Tasks

1. [x] Prove the current failure boundary and inspect exact current browser
   classification code plus focused tests.
2. [x] Add a failing synthetic regression for the current WHOOP action shape.
3. [x] Implement the smallest authorization-action correction.
4. [x] Run focused tests, typecheck, syntax, privacy, and diff checks.
5. [ ] Commit, push, open the PR, and complete ReviewGPT plus required CI.
6. [ ] Merge when authorized and verify the protected-main canary, or report the
   exact remaining merge boundary.

## Decisions

- Treat the failure as auth/connect browser classification: Junction signed-link
  creation and the hosted-local control plane pass before the browser stops at
  `junction_whoop_authorization`.
- Keep live WHOOP credentials and provider-page artifacts out of local and PR
  evidence; use only redacted workflow diagnostics and synthetic DOM fixtures.

## Verification

- Commands to run: focused browser-driver and workflow-contract Vitest files;
  hosted Web and hosted-local harness typechecks; YAML/docs/privacy/diff guards;
  exact-head required GitHub Actions.
- Expected outcomes: the regression proves current action discovery, existing
  disclosure and automated-CI boundaries remain locked, and the protected-main
  live canary completes authorization plus persisted-state reload.
