# Hosted Managed Seed Route

## Goal

Managed automation seeds should be created when the hosted runtime can derive a trusted default assistant delivery target, even if the vault has no saved assistant self-delivery target.

Success criteria:

- Hosted managed seeding passes the derived hosted default route to `applyMurphManagedAutomations`.
- Fresh foreground user input does not run managed seeding on the reply path; writes are deferred to post-checkpoint work.
- Existing assistant self-target fallback remains available when no hosted route is available.
- No route identifiers are logged, documented, or exposed.

## Constraints

- Preserve foreground reply priority.
- Do not add a scheduler, queue, or new persisted route owner.
- Keep web as owner of hosted control/routing facts; Cloudflare/runtime only consume routes already recorded on imported assistant input.
- Keep the change narrow and covered by focused regression tests.

## Plan

1. Inspect hosted execution context route hydration and managed seed call site.
2. Pass the hosted default route into the managed seed helper without blocking fresh replies.
3. Add regression tests for hosted default route handoff, save-failure redaction, and mixed-route fail-closed behavior.
4. Run focused tests, typecheck, and diff-aware verification.
5. Run required completion reviews and commit the scoped fix.
Status: completed
Updated: 2026-06-16
Completed: 2026-06-16
