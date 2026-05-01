# Land supplied final greenfield hosted cleanup patch

Status: active
Created: 2026-05-02
Updated: 2026-05-02

## Goal

- Land the supplied final greenfield hosted cleanup patch, preserving its behavior while porting stale hunks to the current hosted web/Cloudflare/runtime code.

## Success criteria

- Mailbox payload encryption/decryption uses item-bound AAD on both web and Cloudflare.
- Hosted secure-box naming and storage path APIs match the patch intent without generic encryption-root-shaped parameters.
- Mailbox decode fetches only the ingress crypto root where appropriate.
- Bundle, artifact, runner-secret, and browser-vault path callers/tests are updated.
- Required security/privacy, coverage, final review, typecheck/test, and diff hygiene checks are run or any unrelated blockers are documented.

## Scope

- In scope:
- `apps/web/src/lib/hosted-crypto/**`
- `apps/web/src/lib/hosted-web/encryption.ts`
- `apps/web/src/lib/device-sync/prisma-store/connection-secrets.ts`
- `apps/web/src/lib/hosted-mailbox/**`
- `apps/cloudflare/src/**` touched by hosted mailbox crypto, runtime crypto context, runtime bridge, storage paths, bundle/browser-vault stores, and user runner callers
- Directly coupled hosted mailbox/storage path/runner tests
- Out of scope:
- Health Commons and browser-vault selector edits already present in the worktree.
- Broader hosted runtime rewrites, schema changes, or generated artifacts not required by the supplied patch.

## Constraints

- Technical constraints:
- Preserve unrelated dirty work in the current checkout.
- Treat stale hunks as behavioral intent and port them against current file shape.
- Keep sensitive payloads, credentials, and user identifiers out of logs, docs, examples, and commits.
- Product/process constraints:
- Follow high-risk repo completion workflow for hosted crypto/trust-boundary changes.

## Risks and mitigations

1. Risk:
   Stale patch hunks accidentally drop current hosted mailbox or runner behavior.
   Mitigation:
   Inspect current code around each failed hunk, port minimally, and run focused tests plus typecheck.
2. Risk:
   Crypto AAD mismatch between web storage and Cloudflare decode.
   Mitigation:
   Verify both sides build AAD from the same mailbox item-bound metadata and keep focused encryption tests green.
3. Risk:
   Scoped commit accidentally includes unrelated dirty work.
   Mitigation:
   Stage only touched patch/plan paths through `scripts/finish-task` after reviewing `git diff --name-only`.

## Tasks

1. Apply matching hunks from the supplied patch.
2. Manually port stale hunks in hosted mailbox store, runtime bridge workspace, storage path tests, and runner alarm tests.
3. Inspect the full resulting diff for privacy leaks, scope, and unintended unrelated edits.
4. Run required audit passes and verification.
5. Close the plan and create the scoped commit.

## Decisions

- Use a dedicated execution plan because the patch changes hosted crypto, mailbox, storage, and runtime trust-boundary surfaces.

## Verification

- Commands to run:
- `pnpm typecheck`
- `pnpm test:diff <touched paths>` or `pnpm verify:acceptance` when feasible for this broad hosted app slice
- Focused hosted mailbox/storage path tests if needed during porting
- `git diff --check`
- Required completion-workflow audit passes: security/privacy, coverage-write, task-finish-review
- Expected outcomes:
- Required checks pass, or any failures are proven unrelated to this diff and documented.
