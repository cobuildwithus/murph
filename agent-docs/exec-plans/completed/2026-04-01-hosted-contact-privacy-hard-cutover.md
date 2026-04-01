## Goal

Land the supplied hosted contact-privacy hard cutover so hosted onboarding/runtime surfaces stop retaining raw phone, Telegram, and email contact identifiers at rest.

## Why

- The supplied patch replaces durable raw contact identifiers with blind lookup keys and masked hints.
- The cutover also sanitizes stored webhook/event payloads and adds a scrubber for existing rows.
- The user explicitly wants this implemented next, but wants the wallet flow left unchanged.

## Scope

- Port the supplied hosted contact-privacy delta across `apps/web` and `apps/cloudflare`.
- Keep wallet creation/binding/auth invariants unchanged.
- Add the migration plus the backfill/scrub script.
- Update tests and verification for the new contact-privacy behavior.

## Constraints

- Preserve unrelated dirty-tree edits already present in the repo.
- Do not broaden into deferred-wallet behavior.
- Verification must include hosted web typecheck and tests, and note unrelated pre-existing failures if they remain.

## Plan

1. Compare the supplied patch against the current tree and map renamed/refactored file owners.
2. Port the contact-privacy runtime/schema/backfill changes without disturbing unrelated in-flight work.
3. Update tests for the new storage/sanitization invariants.
4. Run verification, review for privacy leakage, and commit only the touched paths.
Status: completed
Updated: 2026-04-01
Completed: 2026-04-01
