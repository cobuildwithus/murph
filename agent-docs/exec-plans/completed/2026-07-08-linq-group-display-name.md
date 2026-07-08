# Linq Group Display Name Update

## Goal

Make `murph.group` `update_display_name` update both the hosted group display label and the route-authorized Linq/iMessage group chat title for the current hosted group chat.

## Constraints

- Preserve the existing single action; do not add a separate rename tool.
- Keep model-supplied chat/thread targets rejected. The hosted runtime must inject the current wake's Linq thread authority.
- Fail closed before changing stored group state when the Linq provider request cannot be authorized or accepted.
- Reuse the existing Linq chat update endpoint and owner-active group authority used by avatar updates.
- Do not read or print secrets or `.env` contents.

## Plan

1. Extend the runtime group-tool request contract/parser so `update_display_name` can carry injected Linq thread context.
2. Inject Linq thread context for `update_display_name` in hosted runtime.
3. Add a Linq client helper for `ChatUpdateParams.display_name`.
4. Update the web group tool so `update_display_name` checks owner/chat authority, requests the Linq chat title update, then stores the hosted group label.
5. Update assistant guidance and focused tests.
6. Run typecheck and focused verification, then commit and open a PR.

## Verification

- PASS: Focused hosted-execution parser tests.
- PASS: Focused assistant-runtime group tool context tests.
- PASS: Focused assistant-engine group tool tests.
- PASS: Focused web Linq/group-tool tests.
- PASS: `pnpm typecheck`.
- BLOCKED: `pnpm test:diff` reached an unrelated `packages/cli/test/cli-expansion-intervention.test.ts` failure in `intervention edit/delete mutate and remove the saved intervention_session event`; this task does not touch CLI files.

## State

Implementation complete. Focused verification and typecheck passed; broader affected test verification is blocked by an unrelated CLI test failure.
Status: completed
Updated: 2026-07-07
Completed: 2026-07-07
