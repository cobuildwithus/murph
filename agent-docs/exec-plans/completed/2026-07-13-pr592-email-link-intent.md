# PR 592 settings email-link proof

## Goal

Make the first settings email-link callback safe and reliable when Privy's browser user snapshot remains stale, without allowing an older provider email to be promoted.

## Scope

- Issue a short-lived, signed email-link intent bound to the active member and Privy principal before opening Privy's link modal.
- Let the settings email sync route prove that the selected server-side email was verified during that exact link attempt.
- Route addressless link callbacks and retries through server-side proof instead of browser-only discovery.
- Add focused route, intent, controller, and helper coverage and update the durable auth-boundary documentation.
- Run required local audits, focused verification, ReviewGPT, and CI; merge only when every required gate is green.

## Non-goals

- No database table, queue, durable intent state, or new identity owner.
- No browser-declared authentication method or browser-selected credential authority.
- No changes to ordinary email resync or recovery semantics outside the active link attempt.

## Completion

- A stale browser snapshot cannot strand a successful first-email link in client-only retries.
- A pre-existing provider email cannot satisfy a newly issued email-link intent.
- Invalid, expired, or cross-principal/member intents fail closed.
- Tests, typecheck, required audits, ReviewGPT, and CI are green on the pushed PR head.
Status: completed
Updated: 2026-07-13
Completed: 2026-07-13
