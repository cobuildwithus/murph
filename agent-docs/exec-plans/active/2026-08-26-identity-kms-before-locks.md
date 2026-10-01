# Move public invite identity KMS outside database locks

Status: active
Created: 2026-08-26
Updated: 2026-08-26

## Goal

- Preserve public invite phone-code verification while ensuring saved-phone decryption completes before any database transaction or row lock begins.
- Keep authorization and concurrency decisions inside their existing owners by revalidating exact prepared row fingerprints under the existing lock order.

## Success criteria

- Invite verification prepares any private identity outside the transaction; confirm and abort paths remain scalar-only under the lock.
- Confirm and abort read only the plaintext attempt scalar under the lock and never project private identity.
- Focused tests prove delayed KMS completes before transaction entry, transaction-local provider calls are disabled, stale preparations fail closed, and replay/cooldown behavior remains valid.
- Hosted Web focused tests and typecheck pass; exact pushed PR head receives the required ReviewGPT gates and required CI.
- A separate draft PR is opened for this owner and is not merged or marked Ready.

## Scope

- In scope: public invite send-code, confirm, and abort identity handling; directly required hosted identity helpers; focused tests; and current transaction-catalog documentation when its owner row changes.
- Out of scope: phone-transfer retirement, mailbox append migration, device credentials, billing provider effects, account-deletion lock ordering, provider or schema changes, caches, managers, queues, new services, or new durable state.

## Constraints

- Technical constraints: prepare/decrypt before checkout; revalidate exact raw-row fingerprints under existing locks; preserve sorted lock order, privacy, authorization, provider-disabled behavior, and product-critical flows.
- Product/process constraints: ReviewGPT must independently agree before any implementation patch is applied; supplied patches are behavioral intent; prefer deletion and existing prepared-root/raw-fingerprint patterns; keep the PR draft and do not merge.

## Risks and mitigations

1. Risk: a preparation becomes stale before the locked commit.
   Mitigation: compare the exact raw database row fingerprint under the existing lock and fail closed on drift.
2. Risk: moving projection work changes authorization or callback semantics.
   Mitigation: keep scalar authority decisions and mutations in the current transaction owner and add focused provider-disabled and drift tests.
3. Risk: a broad helper introduces another state owner.
   Mitigation: reuse current preparation/projection helpers and pass immutable prepared values directly; add no cache, manager, service, queue, or persisted state.

## Tasks

1. Capture the fresh ReviewGPT implementation disposition and attachment metadata for the exact current-main bundle.
2. Trace invite transaction boundaries, current fingerprints, and test seams; verify the returned patch against those owners.
3. Apply only an agreed, scoped patch and simplify it to the smallest explicit data flow.
4. Run focused delayed-KMS, disabled-provider, drift, lock-ordering, and typecheck proof; inspect the final diff and privacy boundary.
5. Commit and push an intermediate exact-head candidate, open a separate draft PR, and start required exact-head ReviewGPT gates concurrently with CI.
6. Resolve all accepted review findings, complete the parent final review, then close the plan with `scripts/finish-task` and push the final scoped commit.

## Decisions

- Use the existing identity and billing projection owners; this change introduces no new runtime owner or durable state.
- Treat the ReviewGPT patch as a proposal requiring local code-path and test verification before application.
- Fresh ReviewGPT implementation review agreed with the invite-only finding (`IMPLEMENTATION_DISPOSITION: AGREE_PATCHED`) against main `a56b39f829767108cd3d842c0590eda46a96b28a`; its returned artifact had SHA-256 `5133bbc4dd5db28aaa15c1778cb8895703a8830594793cc20b111c4d5b7145db`.
- Apply only the invite send-code/confirm/abort artifact: three production owners and two focused test files. The worktree copies were verified byte-for-byte against a clean temporary-index application of that exact artifact.
- Keep the scoped unwrap cache around confirm and abort. `runWithHostedDomainRootProviderCallsDisabled` fails closed only while an unwrap cache is present; removing that scope would make a cache miss call the provider directly.
- No transaction-catalog row changes: the existing identity/authentication owner entries remain broader than this narrow invite correction.

## Verification

- `pnpm --dir apps/web exec tsx scripts/run-hosted-web-vitest.mts test/hosted-onboarding-invite-send-code.test.ts` — passed, 9 tests.
- `pnpm --dir apps/web exec tsx scripts/run-hosted-web-vitest.mts test/hosted-onboarding-member-service.test.ts` — passed, 17 tests.
- `pnpm --dir apps/web typecheck` — passed, including generation and TypeScript lanes.
- Targeted ESLint over the three production files and two focused tests — passed.
- `git diff --check` and the task-path privacy scan — passed.
- The fresh task worktree lacked its reviewed toolchain links, so an offline frozen install was required before focused proof; the public-safe repository friction is captured in `.agents/friction-log/20260826133951-reviewgpt-preflight-cannot/friction.md`.
- Remaining: exact-head preliminary specialist review, final cross-cutting ReviewGPT round, GitHub required checks, current-base merge-tree proof, and final plan closure.
