# Run the Garmin canary in headed Kernel Chromium

Status: active
Created: 2026-08-22
Updated: 2026-08-22

## Goal

- Make the protected Junction Garmin canary complete unattended through Kernel
  despite Garmin's Cloudflare challenge while preserving exact callback,
  persisted-state, disconnect, and deregistration proof.

## Success criteria

- Kernel runs remote Chromium in headed mode without enabling manual CI input.
- Focused config and workflow tests prove the headed unattended contract.
- ReviewGPT and required exact-head CI pass.
- The merged `main` workflow completes the real Garmin canary successfully.

## Scope

- In scope: the Kernel transport headless restriction, protected workflow config,
  focused tests, and directly affected operational documentation.
- Out of scope: provider-specific CAPTCHA solving, credential changes, retries,
  Junction production behavior, and Oura/WHOOP flow rewrites.

## Constraints

- Technical constraints: keep the browser remote and stealth-enabled, keep CI
  unattended and fail-closed on provider challenges, and preserve secret
  partitioning and the source-specific persistent profile.
- Product/process constraints: smallest maintainable correction, no new
  dependency or runtime owner, PR lane with ReviewGPT, exact-head CI, and a
  post-merge protected canary pass.

## Risks and mitigations

1. Risk: Headed mode could accidentally permit manual authorization in CI.
   Mitigation: derive manual authorization independently from `CI`; add a
   regression test proving headed Kernel in CI remains unattended.
2. Risk: The change could weaken challenge detection.
   Mitigation: leave challenge classification and fail-closed behavior intact;
   change only Chromium display mode.

## Tasks

1. Update the Kernel config boundary and protected workflow to use headed remote
   Chromium for Garmin.
2. Add focused regression coverage and align the operational contract.
3. Run focused tests, typecheck, docs drift, and privacy/diff review.
4. Open the follow-up PR, run required ReviewGPT/CI gates, merge, and prove the
   protected `main` Garmin canary succeeds.

## Decisions

- Treat the two reproduced Cloudflare challenge failures as root-cause evidence;
  do not add retries or classify the challenge as success.
- Use Kernel's existing headed automation capability; do not add a CAPTCHA
  solver or a new browser service.

## Verification

- Commands to run: focused web browser tests, workflow contract tests, web and
  harness typechecks, `pnpm docs:drift`, `git diff --check`, required PR CI, and
  the protected post-merge workflow.
- Expected outcomes: all static/focused checks green; ReviewGPT resolved; exact
  PR head green; real Garmin connect, callback, reload, disconnect, and provider
  deregistration green on `main`.
