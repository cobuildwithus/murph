# Replace WHOOP canary browser with Kernel

Status: completed
Created: 2026-08-21
Updated: 2026-08-22

## Goal

- Make the protected-main Junction WHOOP canary use a Kernel stealth browser
  while preserving the existing signed hosted-local connect, callback,
  persisted reload, and provider cleanup proof.

## Success criteria

- The browser runner creates exactly one bounded Kernel session and connects
  the existing Playwright journey to it over CDP.
- The Kernel VM reaches the hosted-local Web origin through one bounded reverse
  SSH port forward without widening the local Web listener.
- Kernel, Junction, and WHOOP credentials remain confined to the final protected
  workflow step and are absent from logs and artifacts.
- Success, browser failure, and tunnel failure await bounded cleanup of
  resources created by the browser runner; process exit synchronously signals
  the exact owned tunnel group and Kernel's bounded inactivity timeout remains
  the final interruption backstop.
- Focused unit/workflow proof and Web typecheck pass; required exact-head CI and
  routed ReviewGPT gates finish without unresolved accepted findings.
- The first credentialed live proof remains protected-main-only.

## Scope

- In scope: the live canary workflow, hosted-local wearable browser runner,
  Kernel client seam needed by that runner, focused tests, and durable canary
  security/verification documentation.
- Out of scope: production member computer-use behavior, Junction/provider
  connection semantics, the hosted callback contract, a new scheduler, a
  generic browser abstraction, configured cross-session proxies, or exposing
  the live canary to pull requests.

## Constraints

- Technical constraints: keep `apps/web` as the Kernel credential owner; use
  Kernel stealth mode with session recording disabled; preserve the exact local
  origin and callback URL through reverse forwarding; do not terminate any
  process that this browser runner did not start; keep all waits and cleanup
  bounded.
- Product/process constraints: use a sanctioned task worktree and active plan;
  preserve the protected Environment and non-canceling concurrency; run focused
  proof locally and broad proof in exact-head CI; run the preliminary coverage
  lens and the final sensitive ReviewGPT gate concurrently with CI.

## Risks and mitigations

1. Risk: the remote browser cannot reach the random hosted-local Web port.
   Mitigation: derive and validate the loopback port from the existing Web base
   URL, then establish Kernel's documented `-R` forward before navigation.
2. Risk: tunnel or browser cleanup leaks a paid session or signals another
   process.
   Mitigation: retain exact child/session ownership, await graceful cleanup, and
   use only the owned process handle and exact Kernel session id.
3. Risk: credentials or capability URLs reach logs or non-Web runtimes.
   Mitigation: keep credential references on the final workflow step, sanitize
   errors, disable session recording, and never print the API key, CDP URL, SSH
   connection details, live-view URL, or provider page contents.
4. Risk: Kernel removes the Cloudflare challenge but changes callback proof.
   Mitigation: preserve the existing response-status, connected-state, reload,
   disconnect, and after-test deregistration assertions unchanged.

## Tasks

1. Inspect the installed Kernel SDK and CLI contracts and existing client/test
   seams.
2. Add the smallest owned Kernel browser/tunnel lifecycle and connect the
   existing Playwright runner over CDP.
3. Update the protected workflow and its drift tests for Kernel prerequisites
   and secret scoping.
4. Update durable canary security, verification, and testing ownership docs.
5. Run focused tests/typecheck, inspect the diff, commit and push the candidate,
   then complete PR CI and routed ReviewGPT gates.

## Decisions

- Keep the every-protected-main-push trigger because the requested change is a
  browser replacement; scheduling changes are independent policy and out of
  scope.
- Use Kernel's included stealth proxy for the first live proof. Do not add a
  configured proxy or Start-Up-tier requirement without production evidence.
- Preserve the current fresh Junction connect/disconnect canary semantics. A
  dedicated persistent Kernel profile reduces repeated WHOOP credential entry
  without bypassing the OAuth consent/connect journey being proved; clear the
  hosted-local cookie before saving the profile.
- Install the exact Kernel CLI and `websocat` releases in the credential-free
  workflow setup with pinned checksums; do not add an application dependency
  for two canary-only binaries.

## Verification

- Passed focused Web browser/Kernel tests: 30 tests.
- Passed focused hosted-local harness workflow/environment tests: 23 tests.
- Passed Web, Cloudflare, and hosted-local harness typechecks, scoped Web ESLint,
  frozen dependency installation, and `git diff --check`.
- Exact-head required CI, preliminary `completion-specialists`, and final
  ReviewGPT remain PR gates. The real WHOOP authorization remains an explicit
  post-merge protected-main proof; the protected GitHub Environment currently
  lacks `KERNEL_API_KEY`, so that external prerequisite must be configured
  before the first live run can pass.
Completed: 2026-08-22
