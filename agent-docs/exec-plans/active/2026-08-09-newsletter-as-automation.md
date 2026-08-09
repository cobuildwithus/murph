# Newsletter as an ordinary automation

Status: active
Owner: Codex
Started: 2026-08-09

## Goal

Collapse newsletter setup and current-chat execution into the existing group automation and shared-projection primitives. Keep only the security-sensitive, reusable group-email effect.

## Scope

- Make the public `group-newsletter` skill the canonical setup and editorial recipe.
- Add a typed `delivery` option to ordinary `murph.automation save`.
- Translate `group_email` into a parser-owned reserved tag; keep current chat ordinary.
- Stop appending a newsletter execution prompt for current-chat records.
- Keep legacy `save_newsletter` and legacy email tags only during migration.
- Preserve existing email authorization, revocation revalidation, occurrence identity, and outbox retry semantics.
- Update product documentation and focused tests.

## Non-goals in this changeset

- Changing recipient consent semantics.
- Replacing the underlying email provider or durable outbox.
- Rewriting historical completed execution plans.
- Migrating or deleting production records from application code without an inventory-backed rollout.

## Invariants

- User/model-authored tags cannot grant managed email authority.
- Current-chat delivery never receives email authority.
- Existing email newsletter records remain executable.
- One scheduled occurrence can accept at most one email effect.
- Shared health facts remain grant- and consent-scoped.

## Verification

Focused local/static verification:

- TypeScript parse checks for changed TypeScript files.
- Skill contract phrase assertions against the existing skill test expectations.
- Focused automation-delivery tests added for current chat, group email, forged tags, and legacy chat behavior.

Exact-head CI owns repository typecheck, lint, and full test execution.

## Follow-up removal condition

Delete the compatibility `save_newsletter` schema/compiler and legacy `system:group-newsletter:*` handling after:

1. production inventory shows zero callers using `save_newsletter`, and
2. all persisted email newsletter automations carry `system:automation-delivery:group-email`, while chat newsletters carry no delivery tag.
