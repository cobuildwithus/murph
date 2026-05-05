# Cloudflare Callback Nonce

## Goal

Make the Cloudflare deploy-callback verifier enforce the same minimum nonce strength expected by the hosted web callback verifier.

Success criteria:

- Missing, blank, or too-short callback nonces are rejected before signature acceptance.
- The normal generated callback nonce path continues to work unchanged.
- Focused tests cover a correctly signed request with a short nonce being rejected.

## Constraints

- Keep the change small and local to the existing callback auth seam.
- Do not introduce shared abstractions unless they remove immediate duplication without widening ownership.
- Preserve unrelated working-tree edits.
- Do not expose secrets, local usernames, home paths, or direct personal identifiers in diffs or logs.

## Scope

Planned files:

- `apps/cloudflare/src/web-callback-auth.ts`
- `apps/cloudflare/test/index.test.ts`

Out of scope:

- Changing signing algorithms, key handling, timestamp policy, or nonce storage.
- Reworking hosted web callback verification.
- Broad Cloudflare route/auth refactors.

## Verification

Planned:

- Focused Cloudflare test for short signed nonce rejection.
- Scoped Cloudflare verification for touched files where practical.
- Typecheck unless blocked by unrelated existing worktree state.

Current results:

- `pnpm --dir apps/cloudflare typecheck` passed.
- `pnpm exec vitest run --config apps/cloudflare/vitest.node.workspace.ts --project cloudflare-node-platform apps/cloudflare/test/index.test.ts --no-coverage` passed.
- `pnpm test:diff apps/cloudflare/src/web-callback-auth.ts apps/cloudflare/test/index.test.ts` is blocked by an unrelated existing `apps/cloudflare/test/deploy-automation.test.ts` env-binding failure in the dirty Cloudflare deploy surface.
Status: completed
Updated: 2026-05-06
Completed: 2026-05-06
