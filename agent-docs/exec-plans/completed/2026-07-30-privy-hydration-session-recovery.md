# Reconcile Privy session on homepage hydration

Status: completed
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
3. Risk: Privy can report an authenticated session before its linked-account
   snapshot identifies the actual method.
   Mitigation: keep the hydration transition pending, remove method actions,
   and use the existing timed readiness/restart owner until the snapshot is
   determinate.

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
- The first preliminary specialist pass returned `INVALID` because the
  screenshots showed only the isolated email recovery leaf. The evidence now
  composes the production recovery leaf and shared alternate-method wrapper for
  both email and idle phone recovery; this is an evidence correction, not an
  additional auth-state owner.
- The corrected preliminary pass found that `ready` and `authenticated` can
  coexist with a null user snapshot in Privy's explicit session-repair path,
  even though the installed SDK's ordinary cold boot resolves the user before
  `ready`. The finding is accepted after the real phone controller path proved
  that this indeterminate state exposed an enabled phone continuation and could
  submit the wrong auth method. The existing readiness owner now gates that
  narrow state until the snapshot resolves.
- Existing readiness telemetry now includes the low-cardinality wait reason
  (`action` or `session`) so a future provider-delay incident can distinguish a
  retained user action from an authenticated null-user repair.

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
- Current green proof: 11 focused auth/runtime files / 141 tests, web typecheck,
  scoped ESLint, frontend-design-proof unit checks, and diff check pass after
  specialist remediation.
- Rendered proof: desktop and mobile catalog captures show production-faithful
  session-snapshot waiting, hydrated email recovery, and idle phone recovery
  compositions; no production data or provider side effect is used.
- Preliminary specialist retry: the exact-turn, exact-head response completed
  well above the trust floor on the selected Pro lane and returned two
  substantive findings with no patch artifact. The response model verified as
  the Pro slug despite the wrapper's internal requested-model alias differing;
  both findings were independently proved against the installed SDK and real
  panel path before acceptance.
- Corrected-head product-purpose revalidation: `NO FINDINGS`. The smallest
  complete experience keeps the ordinary unauthenticated form available,
  truthfully pauses only an indeterminate existing session, preserves active
  journeys, and resolves to the exact recovery method with bounded restart.
  The deterministic provider-call boundary is sufficient here because no
  method SDK call or backend completion contract changed.
- Parent final review: no unresolved correctness, auth-boundary, privacy,
  reliability, accessibility, or simplicity finding remains on the pushed
  corrected head.
Completed: 2026-07-30
