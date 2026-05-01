# Land hosted GCP KMS domain crypto patch

Status: completed
Created: 2026-05-01
Updated: 2026-05-01

## Goal

- Land the supplied hosted crypto patch that introduces signed domain root
  envelopes, web-owned GCP KMS wrapping/signing, and Cloudflare runtime crypto
  context retrieval without giving Cloudflare GCP KMS decrypt authority.

## Success criteria

- Patch intent is applied on top of the current checkout without overwriting
  unrelated active work.
- New persisted hosted crypto tables and app/package code compile.
- Web/control-plane and Cloudflare/execution-plane authority boundaries remain
  fail-closed and documented in code/tests where feasible.
- Required verification and completion-review workflow is run or blockers are
  recorded precisely.

## Scope

- In scope:
  - `packages/runtime-state` pure hosted domain envelope crypto primitives.
  - `apps/web` hosted crypto env, GCP KMS adapter, Prisma migration/store, and
    signed internal runtime crypto-context route.
  - `apps/cloudflare` runtime crypto-context client for ingress/runtime roots.
  - Direct tests or focused checks needed to prove the new behavior.
- Out of scope:
  - Legacy decrypt paths, AWS compatibility, per-lane DEK tables, Cloudflare GCP
    KMS credentials, or broader hosted runner behavior changes.

## Constraints

- Technical constraints:
  - Preserve the existing package-boundary rule: shared crypto is pure and
    app-local deployment adapters stay in app owners.
  - Do not expose secrets, personal identifiers, raw credentials, or private key
    material in files, logs, fixtures, or commits.
  - Public JWK env parsing must reject private key material.
  - Cloudflare may unwrap only its configured P-256 recipient envelope and must
    verify root-envelope signatures before trusting context.
- Product/process constraints:
  - Preserve unrelated dirty work and active ledger rows in the current checkout.
  - Same-turn completion should commit scoped changes only if safe.

## Risks and mitigations

1. Risk: Stored envelope or route design widens hosted crypto authority.
   Mitigation: inspect code paths, run security/privacy review, and keep
   Cloudflare on signed web callback plus recipient unwrap only.
2. Risk: New crypto primitives compile but lack direct regression coverage.
   Mitigation: add focused tests if package/app checks expose gaps, and run the
   coverage workflow review.
3. Risk: Full repo acceptance is already red or too broad because of unrelated
   active work.
   Mitigation: run truthful scoped checks first, capture exact unrelated
   blockers, and run broader checks when feasible.

## Tasks

1. Apply the supplied patch and manually resolve stale hunks.
2. Inspect the new crypto, route, migration, and Cloudflare client code for
   type/runtime/security issues.
3. Add or adjust focused tests/proof where needed.
4. Run required verification and audit passes.
5. Close this plan and create a scoped commit if the touched files can be staged
   safely.

## Decisions

- Use a plan rather than ledger-only handling because the patch adds persisted
  state and trust-boundary surfaces across web, runtime-state, and Cloudflare.
- Required security/privacy review found the signed Cloudflare crypto-context
  route was not wired into production resolution. Follow-up wiring now fetches
  the signed web context for configured Cloudflare runtime paths, selects
  ingress/runtime roots by caller, and guards production static GCP tokens.
- The signed worker context intentionally returns full signed ingress/runtime
  envelopes so Cloudflare can verify web's authority signature before selecting
  only its `cloudflare-automation-secret` recipient wrap.

## Verification

- Passed:
  - `pnpm --dir packages/runtime-state typecheck`
  - `pnpm --dir apps/web typecheck`
  - `pnpm --dir packages/runtime-state test:coverage`
  - `pnpm exec vitest run apps/web/test/hosted-crypto-env.test.ts --config apps/web/vitest.config.ts --no-coverage`
  - `pnpm exec vitest run apps/cloudflare/test/hosted-runtime-crypto-context.test.ts apps/cloudflare/test/runner-outbound.test.ts --config apps/cloudflare/vitest.config.ts --no-coverage`
  - `pnpm --dir apps/web exec eslint src/lib/hosted-crypto app/api/internal/hosted-runtime/crypto-context/route.ts test/hosted-crypto-env.test.ts`
  - `pnpm docs:drift`
  - scoped `git diff --check`
- Failed unrelated:
  - `bash scripts/workspace-verify.sh test:diff <hosted crypto paths>` failed in
    `packages/core` on date-sensitive `audit/2026/2026-04.jsonl` expectations;
    the same failure reproduced with `pnpm --dir packages/core test -- --runInBand test/core.test.ts`.
  - `pnpm --dir apps/cloudflare typecheck` is currently blocked by unrelated
    dirty `apps/cloudflare/test/user-runner-alarm.test.ts` drift:
    `Cannot find name 'sql'`.
Completed: 2026-05-01
