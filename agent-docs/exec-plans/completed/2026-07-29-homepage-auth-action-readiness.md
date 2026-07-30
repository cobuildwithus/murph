# Homepage auth action readiness and Privy warmup

Status: completed
Created: 2026-07-29
Updated: 2026-07-30

## Goal

- Finish PR #1154 on `main` after PR #1127, warming one homepage-scoped Privy
  runtime while keeping the ordinary sign-in form visible and actionable during
  provider initialization.

## Success criteria

- The unauthenticated homepage warms exactly one Privy provider after idle or
  immediately on auth intent, and authenticated homepage visits do not warm it.
- Before Privy reports ready, the ordinary phone, email, and Telegram controls
  remain visible and enabled.
- Selecting an auth method immediately shows method-specific pending feedback
  and retains the intent until readiness. Phone and email start exactly once
  when readiness arrives; Telegram changes to an explicit continuation once
  its popup widget is ready so the popup still opens from a trusted click.
- A compact explanatory status appears only after a noticeable readiness delay;
  the initial click is not replaced by a blocking preparation screen.
- Closing/reopening the homepage dialog reuses the warmed provider, while the
  existing explicit restart remains the only provider remount operation.
- Focused tests, type proof, lint, rendered desktop/mobile catalog proof,
  required audits, exact-head CI, and the final ReviewGPT gate pass.

## Scope

- In scope:
  - Retargeting and merging current `main` into the existing PR #1154 branch.
  - Homepage Privy warmup ownership and shared-dialog reuse.
  - Pre-ready phone, email, and Telegram intent/pending behavior.
  - Delayed inline readiness information, accessibility, focused regressions,
    and design-catalog states.
- Out of scope:
  - New authentication methods or identity policy.
  - Changes to Privy tokens, sessions, completion redirects, billing, or
    persisted product state.
  - Root-layout or application-wide provider warmup.

## Constraints

- Technical constraints:
  - Provider APIs must not be called before `usePrivy().ready`.
  - Telegram popup authentication must start from a fresh trusted click after
    both Privy and `window.Telegram.Login.auth` are ready.
  - A queued action must drain once without surviving cancellation, method
    replacement, provider restart, or component unmount incorrectly.
  - The homepage keeps one provider instance; no hidden auth form or CAPTCHA is
    mounted before explicit dialog intent.
- Product/process constraints:
  - Preserve the product-critical signup path and truthful feedback.
  - Reuse PR #1154 and avoid duplicating another agent or pull request.
  - Keep private auth inputs out of logs, telemetry, fixtures, and durable docs.
  - Follow the frontend catalog, product-experience review, preliminary
    specialist review, Claude UI check, and exact-head final review workflow.

## Risks and mitigations

1. Risk: Multiple fast clicks or readiness effects invoke an auth provider more
   than once.
   Mitigation: One explicit queued-method owner plus focused double-click and
   readiness-transition tests.
2. Risk: A slow provider leaves a clicked action looking stuck.
   Mitigation: Immediate method-specific pending UI followed by one delayed,
   polite status message and the existing bounded recovery path.
3. Risk: Warmup accidentally creates a second provider or ambient app auth
   state.
   Mitigation: Keep the provider in the homepage subtree and prove instance
   reuse, close/reopen behavior, explicit restart, and authenticated bypass.

## Tasks

1. Inspect the merged #1127 state and the full #1154 diff/call graph.
2. Restack the existing #1154 branch on current `main` and retarget the PR.
3. Define the smallest shared pre-ready action lifecycle for phone, email, and
   Telegram without calling Privy early.
4. Implement the enabled controls, immediate pending feedback, delayed status,
   and homepage warmup integration.
5. Add focused regressions and production-component catalog states.
6. Run focused verification and rendered desktop/mobile direct proof.
7. Resolve product, preliminary specialist, Claude UI, parent, and final
   ReviewGPT findings.
8. Finish the scoped plan commit, push the exact head, and wait for required CI.

## Decisions

- Reuse PR #1154 and its branch; do not open a second PR.
- Merge `main` into the published branch instead of rewriting its shared
  history.
- Retire Telegram's trusted-click continuation only after phone successfully
  claims queued or active ownership; a rejected phone claim leaves the current
  Telegram selection intact.
- Give the phone field and country selector native disabled semantics only
  while another auth method owns the journey. A phone-owned readiness queue
  keeps both controls editable so editing can cancel the retained send.

## Verification

- Commands to run:
  - Focused hosted-auth and homepage-runtime Vitest files selected after the
    final call graph is known.
  - `pnpm --dir apps/web typecheck`
  - `pnpm --dir apps/web lint`
  - `pnpm test:frontend-design-proof`
  - Desktop and mobile `/design?tab=sections` browser proof.
  - Required exact-head PR checks and ReviewGPT passes.
- Expected outcomes:
  - Each pre-ready method presents immediate pending state. Phone and email
    invoke Privy exactly once after readiness; Telegram exposes one enabled
    continuation and invokes Privy exactly once from that follow-up click.
  - The delayed explanation appears only while the selected action is still
    waiting for readiness.
  - One homepage provider is warmed and reused without mounting hidden controls.
- Latest focused proof:
  - 10 hosted-auth/runtime Vitest files passed (133 tests).
  - Hosted Web typecheck and scoped ESLint passed again after merging the latest
    `main`.
  - Frontend design-proof tests passed, with refreshed desktop/mobile catalog
    captures covering phone waiting, Telegram waiting, and Telegram's trusted
    continuation.
  - Preliminary specialist findings for stale Telegram continuation and
    misleading phone interactivity were resolved with real-panel boundary
    coverage.
  - Parent final review traced provider ownership, queued-method handoff,
    authenticated hydration, close/restart cancellation, and the trusted-popup
    boundary with no remaining correctness finding.
Completed: 2026-07-30
