# Runtime Crypto Envelope Cache

## Goal

Reduce repeated hosted web crypto-context fetches in Cloudflare by caching only verified, signed/encrypted runtime crypto-context envelope JSON in Worker memory.

## Constraints

- Do not persist decrypted root keys.
- Do not cache failed web responses.
- Store only sanitized envelope response JSON after unwrap/signature verification succeeds.
- Cap Cloudflare-side envelope and returned context TTL to 60 seconds even when web advertises a longer cache age.
- Bound cache entries and approximate stored bytes to protect Worker isolate memory.
- Fall back to a fresh web fetch if a cached envelope fails parse, signature verification, or unwrap.
- Preserve existing root-key-by-id resolution behavior.
- Preserve unrelated dirty work.

## Plan

1. Add a module-scope positive envelope JSON cache to `runtime-user-crypto-context.ts`.
2. Split fetch/parse from unwrap so fresh responses are cached only after successful verification.
3. Add cache keying by hosted web base URL, hosted crypto env, signing/callback/automation key identifiers, domain, and user id.
4. Add tests for successful envelope reuse without plaintext-root reuse, TTL capping, failed response non-poisoning, cached unwrap fallback, and oversized response non-caching.
5. Run focused Cloudflare tests, typecheck/verification, required audits, then commit scoped changes.

## Verification

- PASS: `pnpm exec vitest run --config apps/cloudflare/vitest.node.workspace.ts apps/cloudflare/test/hosted-runtime-crypto-context.test.ts apps/cloudflare/test/hosted-runtime-crypto-context-route.test.ts --no-coverage`
- PASS: `pnpm --dir apps/cloudflare typecheck`
- PASS: `bash scripts/workspace-verify.sh test:diff apps/cloudflare/src/hosted-crypto/runtime-user-crypto-context.ts apps/cloudflare/test/hosted-runtime-crypto-context.test.ts`
- PASS: `git diff --check -- apps/cloudflare/src/hosted-crypto/runtime-user-crypto-context.ts apps/cloudflare/test/hosted-runtime-crypto-context.test.ts agent-docs/exec-plans/active/2026-05-04-runtime-crypto-envelope-cache.md agent-docs/exec-plans/active/COORDINATION_LEDGER.md`
- PASS: privacy scan over touched code/plan found no local paths, account usernames, or legal-name strings.
- DONE: `simplify`, `security-privacy-review`, `coverage-write`, and `task-finish-review` audit passes completed; security/final-review findings were fixed and covered by focused regressions.

## Commit Note

- `scripts/finish-task` was not used because `COORDINATION_LEDGER.md` contains unrelated uncommitted rows from other active tasks. The plan was closed with `scripts/close-exec-plan.sh`; the scoped commit intentionally excludes the shared ledger churn.
Status: completed
Updated: 2026-05-04
Completed: 2026-05-04
