# Reconcile Privy session on homepage hydration

Status: active
Created: 2026-07-30
Updated: 2026-07-30

## Goal

- Preserve the ordinary pre-ready homepage sign-in form while ensuring that a
  Privy session discovered during hydration takes priority over an
  unsubmitted method selection.

## Success criteria

- Selecting Email before Privy readiness, without submitting, cannot hide an
  existing email/Telegram resumable session or phone-session recovery after
  hydration.
- The stale Email form cannot send a new code after that hydration transition.
- A deliberate method selection made after session recovery has been presented
  remains available.
- Submitted phone, email, and Telegram queues retain their existing
  exact-once/cancellation behavior.
- Focused tests, web typecheck, scoped lint, design-proof checks, exact-head CI,
  and the required review gates pass.

## Scope

- In scope: the homepage hosted auth panel's in-memory presentation
  reconciliation and focused regression coverage.
- Out of scope: Privy provider ownership, session policy, backend auth
  contracts, new persistence, and unrelated authentication surfaces.

## Constraints

- Technical constraints: keep one existing auth journey owner; use a
  transition-scoped in-memory correction and do not add a durable state owner,
  queue, service, or compatibility path.
- Product/process constraints: preserve product-critical authentication
  success paths, do not dispatch real SMS/email/Telegram side effects during
  verification, and land this as a focused follow-up to merged PR #1154.

## Risks and mitigations

1. Risk: resetting presentation after a real provider journey has started.
   Mitigation: reconcile only the transition to ready-and-authenticated while
   no code, queued method, active/completing journey, or pending completion
   exists.
2. Risk: permanently forcing the default method for authenticated clients.
   Mitigation: consume only the hydration transition so later deliberate
   method selection remains possible.

## Tasks

1. Add a failing real-panel regression for selected-but-unsubmitted Email
   across ready/authenticated hydration.
2. Implement the smallest transition-scoped presentation reconciliation in
   `HostedAuthPanel`.
3. Cover email-only and phone-linked existing sessions plus deliberate
   post-hydration selection.
4. Run focused verification and required preliminary/final review gates.
5. Push an exact-head follow-up PR, require green CI, archive this plan, and
   hand off the merged production status.

## Decisions

- The ReviewGPT finding is accepted after static code-path proof: hydration
  alone sends nothing, but the stale form's next submit can invoke `sendCode`.
- No open PR currently changes `HostedAuthPanel` or fixes this path.
- The correction uses one guarded render-phase transition in the existing panel
  rather than an effect: React resolves it before committing the hydrated view,
  the repository lint accepts the bounded update, and the transition is
  consumed even when hydration resolves unauthenticated.
- Existing queued phone, email, and Telegram ownership remains unchanged; the
  correction applies only while the panel has no code, queue, active/completing
  journey, or pending completion.

## Verification

- Commands to run: focused Vitest for `hosted-auth-panel.test.ts`, scoped
  ESLint, `pnpm --dir apps/web typecheck`, frontend design proof, diff/privacy
  checks, preliminary ReviewGPT specialists, final ReviewGPT if required, and
  exact-head GitHub Actions.
- Expected outcomes: the new regression fails before the correction and passes
  after it; existing auth readiness/session tests remain green; no new
  dependency, persisted state, secret, or private identifier appears.
- Red proof: the selected-but-unsubmitted regression failed because mocked
  `sendCode` received the hydrated email address.
- Current green proof: 8 focused auth files / 143 tests, web typecheck, scoped
  ESLint, frontend-design-proof unit checks, diff check, and privacy/secret/cast
  scans pass.
- Rendered proof: desktop and mobile catalog captures show the synthetic
  hydrated email recovery state; no production data or provider side effect is
  used.
