# Web Auth Simplify

## Goal

Simplify hosted web auth so signup and future signin can share one cleaner auth surface with fewer wrappers, fewer props, and one post-Privy completion path.

## Scope

- `apps/web/src/components/homepage/**`
- `apps/web/src/components/hosted-onboarding/**`
- `apps/web/test/**`

## Constraints

- Preserve invite-specific phone shortcut behavior.
- Preserve current homepage/signup behavior while making method state controlled in one place.
- Avoid introducing a large abstraction framework; prefer deleting layers.
- Do not touch unrelated package work already registered in the coordination ledger.

## Planned Shape

1. Replace duplicate homepage/phone completion logic with one shared auth-completion service.
2. Keep one shared client auth chooser/surface for homepage methods.
3. Simplify email and Telegram modules to method-specific logic only.
4. Collapse phone auth layers where possible while keeping invite wrapper narrow.
5. Update tests around the shared surface and completion outcomes.
Status: completed
Updated: 2026-04-14
Completed: 2026-04-14
