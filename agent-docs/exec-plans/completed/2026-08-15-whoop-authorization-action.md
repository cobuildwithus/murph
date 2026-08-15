# Restore automated WHOOP authorization canary

Status: completed
Created: 2026-08-15
Updated: 2026-08-15

## Goal

- Restore the protected-main Junction WHOOP canary so its automated browser can
  complete the current WHOOP sign-in and authorization journey and prove the
  persisted connection state.

## Success criteria

- Credential-free browser probes distinguish the failing bundled-browser path
  from the real sign-in surface exposed by headed stable Chrome.
- Automated headed CI launches Playwright's stable Chrome channel while
  headless and headed non-CI operator runs retain their existing browser.
- The workflow proves runner-provided Chrome is available before the
  credential-scoped step and no longer installs redundant bundled Chromium.
- The workflow contract test, browser-driver tests, relevant typecheck, privacy
  review, preliminary specialist review, final ReviewGPT gate, and exact-head
  required CI pass.
- A protected-main canary passes after the reviewed change merges, or the exact
  remaining protected-main merge boundary is reported with the PR left active.

## Scope

- In scope: browser-channel selection in the hosted-local wearable driver, the
  protected canary's browser preflight, focused contract coverage, and owner
  documentation for that executable contract.
- Out of scope: provider credentials, production Junction configuration,
  generic provider lifecycle changes, and broader browser automation rewrites.

## Constraints

- Technical constraints: keep provider credentials step-scoped; preserve headed
  CI automation, artifact prohibition, bounded timeouts, and explicit stage
  diagnostics without page contents or identifiers.
- Product/process constraints: prefer the smallest browser-boundary correction;
  do not add a fallback scheduler, state owner, persisted browser profile, or
  manual CI path.

## Risks and mitigations

1. Risk: the pinned runner image stops supplying stable Chrome.
   Mitigation: fail before credential admission with a credential-free Chrome
   version preflight and retain the runner inventory as the documented contract.
2. Risk: the CI-only channel change alters operator or headless behavior.
   Mitigation: derive the channel from existing headed/automation boundaries and
   lock all three modes in focused configuration tests.
3. Risk: a local fix passes while the real provider still presents a challenge.
   Mitigation: require the protected-main external-provider canary as the final
   live proof after exact-head review and merge.

## Tasks

1. [x] Prove the current failure boundary and inspect exact current browser
   classification code plus focused tests.
2. [x] Compare credential-free bundled and stable-browser provider surfaces.
3. [x] Implement the smallest CI browser-channel correction.
4. [x] Run focused tests, typecheck, syntax, privacy, and diff checks.
5. [x] Commit, push, open the PR, and complete ReviewGPT plus required CI.
6. [x] Reach an authorized, cleanly mergeable boundary with the protected-main
   canary retained as the required post-merge rollout proof.

## Decisions

- Treat the failure as a browser identity boundary: Junction signed-link
  creation and the hosted-local control plane pass, the bundled browser is
  challenged, and headed stable Chrome exposes the sign-in controls.
- Reuse the stable Chrome already supplied by the pinned runner image through
  Playwright's supported branded-browser channel; add no installer or profile.
- Keep live WHOOP credentials and provider-page artifacts out of local and PR
  evidence; use only redacted workflow diagnostics and credential-free probes.

## Verification

- Commands to run: focused browser-driver and workflow-contract Vitest files;
  hosted Web and hosted-local harness typechecks; YAML/docs/privacy/diff guards;
  exact-head required GitHub Actions.
- Expected outcomes: focused proof locks stable Chrome to automated headed CI,
  existing disclosure and authorization boundaries remain intact, and the
  protected-main live canary completes authorization plus persisted-state reload.
Completed: 2026-08-15
