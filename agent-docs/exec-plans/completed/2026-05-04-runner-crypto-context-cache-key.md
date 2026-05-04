# Environment-aware runner crypto context cache key

Status: completed
Created: 2026-05-04
Updated: 2026-05-04

## Goal

- Make the runner outbound shared crypto-context cache key environment-aware so
  Worker memory cannot reuse a hosted user crypto context across web base URL,
  signing key, hosted crypto environment, authority-sign version, automation
  recipient key, user, or crypto domain changes.

## Success criteria

- Cache hits still work for the same user/domain/environment tuple until the
  bounded TTL expires.
- Calls with the same user/domain but different hosted crypto environment
  identity refetch instead of reusing the old shared cache entry.
- Focused Cloudflare runner outbound tests and required verification pass.

## Scope

- In scope:
  - `apps/cloudflare/src/runner-outbound/shared.ts`
  - Focused regression coverage in `apps/cloudflare/test/runner-outbound.test.ts`
- Out of scope:
  - Lower-level signed envelope cache behavior.
  - Hosted web crypto provisioning or envelope signing behavior.

## Constraints

- Technical constraints:
  - Preserve plaintext-root lifetime and TTL behavior.
  - Keep the cache key metadata-only; do not include secret material or raw
    envelope JSON.
- Product/process constraints:
  - Treat as trust-boundary-sensitive hosted runtime work.
  - Preserve unrelated active ledger/worktree edits.

## Risks and mitigations

1. Risk: The shared cache reuses context across staged deployments, tests, local
   proxy modes, or key rotations.
   Mitigation: Include the hosted web origin and crypto authority/recipient
   identity in the key.
2. Risk: Over-keying with secret material or unstable objects breaks privacy or
   cache utility.
   Mitigation: Use stable non-secret config strings already used as authority
   metadata.

## Tasks

1. Register plan and ledger row.
2. Inspect existing runner outbound cache and tests.
3. Add environment-aware cache-key components.
4. Add focused regression coverage for same user/domain with changed
   environment identity.
5. Run required verification, audits, and commit path.

## Decisions

- Use metadata-only environment fields: hosted web base URL, callback signing
  key id, hosted crypto env marker, authority signing key version, automation key
  id, user id, and domain.

## Verification

- PASS: `pnpm exec vitest run --config apps/cloudflare/vitest.node.workspace.ts apps/cloudflare/test/runner-outbound.test.ts --no-coverage`
- PASS: `pnpm exec vitest run --config apps/cloudflare/vitest.node.workspace.ts apps/cloudflare/test/runner-outbound.test.ts --no-coverage -t "outbound runtime crypto context"`
- PASS: `pnpm typecheck`
- PASS: `git diff --check -- apps/cloudflare/src/runner-outbound/shared.ts apps/cloudflare/test/runner-outbound.test.ts agent-docs/exec-plans/completed/2026-05-04-runner-crypto-context-cache-key.md agent-docs/exec-plans/active/COORDINATION_LEDGER.md`
- PASS: `pnpm exec vitest run --config apps/cloudflare/vitest.node.workspace.ts apps/cloudflare/test/runner-outbound.test.ts --no-coverage`
- PASS: `bash scripts/workspace-verify.sh test:diff apps/cloudflare/src/runner-outbound/shared.ts apps/cloudflare/test/runner-outbound.test.ts`

## Audits

- Security/privacy review: no findings.
- Coverage-write pass: no additional test changes needed.
- Final task review: no findings for the scoped cache-key change.

## Commit status

- Scoped commit blocked: the task files now contain unrelated concurrent edits
  in the same source/test files, so a safe whole-file commit would mix tasks.
Completed: 2026-05-04
