# Deploy smoke HTTP timeout

Status: active
Created: 2026-07-26
Updated: 2026-07-26

## Goal

- Make the production Cloudflare managed-container smoke honor its existing
  wall-clock budget instead of failing at Node's implicit five-minute response
  header timeout.

## Success criteria

- The long-running signed container-smoke request has one explicit timeout owner
  aligned with `HOSTED_EXECUTION_SMOKE_RUNNER_MAX_WAIT_MS`.
- Public Worker smoke, version pinning, runner fingerprint, direct-R2, CLI
  surface, and live-model assertions remain unchanged.
- Focused tests reproduce the transport configuration and the canonical
  Cloudflare verification lane passes.
- Preliminary specialist review, parent review, final ReviewGPT, CI, merge, and
  a production deploy smoke all pass on exact pushed heads.

## Scope

- In scope: the Node deploy-smoke HTTP client, focused tests, dependency/lockfile
  ownership if the supported Node dispatcher API requires it, and deploy docs.
- Out of scope: Worker or container runtime behavior, retry policy, smoke
  assertions, product traffic, Temporal, Web, or persisted state.

## Constraints

- Technical constraints: preserve the 20-minute wall-clock gate, do not make
  non-idempotent POST retries implicit, and keep secret-bearing signature
  headers out of logs and process arguments.
- Product/process constraints: use the isolated worktree/PR lane, retain the
  prior zero-grace deploy-smoke fix, and deploy only after required review and
  CI gates pass.

## Risks and mitigations

1. Risk: disabling the implicit client timer could let a request outlive the
   deploy job.
   Mitigation: keep the existing explicit wall-clock budget as the sole abort
   boundary and test its propagation.
2. Risk: a transport wrapper could change fetch semantics or credential
   handling.
   Mitigation: use Node's documented Undici dispatcher support on the existing
   `fetch` call and retain the existing request construction and response
   parsing.

## Tasks

1. Add the narrow dispatcher-backed timeout alignment and focused regression
   tests.
2. Update the deploy contract and run canonical verification.
3. Complete preliminary and final review gates, merge, deploy, and verify the
   production smoke.

## Decisions

- Keep the Worker/container endpoint synchronous. Cloudflare documents
  HTTP-triggered Worker duration as unlimited while the client remains
  connected; the observed failure is the Node client's response-header timer.
- Do not add a queue, polling endpoint, streaming heartbeat, or retry owner.

## Verification

- Passed:
  - focused Cloudflare smoke-hosted-deploy tests (37 tests)
  - `pnpm --dir apps/cloudflare typecheck`
  - `pnpm deps:guard`
  - canonical `pnpm test:diff apps/cloudflare/scripts/smoke-hosted-deploy.shared.ts apps/cloudflare/test/smoke-hosted-deploy.test.ts apps/cloudflare/package.json pnpm-lock.yaml apps/cloudflare/DEPLOY.md`
  - canonical `pnpm verify:acceptance`
- Reviewed: `pnpm deps:ignored-builds`.
- Pre-existing repository advisory set: `pnpm deps:audit` reports vulnerable
  transitive packages outside this change. The new direct `undici` dependency
  is the already-resolved patched `7.28.0`; the lockfile adds only the
  Cloudflare importer entry.
- Remaining: preliminary specialist review, final ReviewGPT, exact-head CI,
  merge, and the deployed managed-container smoke.
