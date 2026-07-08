# Group Health Newsletter Pass 1

Status: Release CI gates verified, uncommitted by request
Updated: 2026-07-06

## Why

Implement the mechanism layer for the group health newsletter without adding a
new scheduler, queue, manager, or product-state owner. The group vault remains
the source for shared health projections, hosted web resolves member email
authorization at send time, and Cloudflare keeps outbound email delivery.

## Scope

1. Register `group-email.v0` as a selectable vault-share grant with clear join
   policy copy, default request at group creation, and owner auto-grant.
2. Keep `group-email.v0` payload-free: the record producer and importer skip
   it, while active-grant roster reads still report it.
3. Add a typed reader for `murph.shared-vault-projections.v1` materialized
   projections that feeds the weekly stats engine without redefining the writer
   schema constant.
4. Add a minimal `murph.newsletter` dynamic tool contract and web/Worker ports
   for `read_stats` and `send`.
5. Extend the existing hosted email builder minimally for shared-recipient MIME
   and HTML alternative parts.
6. Add the settings `?addEmail=true` deep-link into the existing email-link
   flow.
7. Add focused tests for the new grant kind, projection reader, skip behavior,
   default-request behavior, and shared MIME builder.

## Constraints

- No Prisma migration unless the existing `HostedVaultShare` table is
  insufficient. Current expectation: no migration.
- Member email addresses stay out of group vault content and tool results.
- No raw address logging.
- No `as any` or lazy `as unknown as T` casts.
- Do not build Pass 2 skill, automation, announcement-window, opt-out command,
  or email-thread behavior.

## Verification

Focused tests passed:

- `packages/hosted-execution`: `pnpm exec vitest run test/vault-share.test.ts --config vitest.config.ts --no-coverage`
- `packages/assistant-runtime`: `pnpm exec vitest run test/vault-share-projection.test.ts --config vitest.config.ts --no-coverage`
- `packages/assistant-engine`: `pnpm exec vitest run test/group-newsletter-projections.test.ts test/assistant-codex-group-tool.test.ts --config vitest.config.ts --no-coverage`
- `apps/cloudflare`: `pnpm exec vitest run apps/cloudflare/test/hosted-email.test.ts --config apps/cloudflare/vitest.config.ts --no-coverage`
- `apps/web`: `pnpm exec vitest run apps/web/test/hosted-group-store.test.ts apps/web/test/hosted-group-tool.test.ts apps/web/test/settings-page.test.ts --config apps/web/vitest.workspace.ts --no-coverage`

Package/app verification:

- Passed: hosted-execution typecheck/build; query typecheck/build; assistant-engine build/typecheck; assistant-runtime build/typecheck; cloudflare build/typecheck; hosted-web build.
- Blocked: hosted-web typecheck fails in unrelated `apps/web/test/hosted-onboarding-linq-observability-store.test.ts` fixtures missing required `userId`.
- Full hosted E2E intentionally not run.

## Round 1 Accepted Findings

1. Gate `murph.newsletter` `send` on server-derived scheduled automation
   authority. Interactive group-chat turns may still use `read_stats`.
2. Fail closed for email-thread self-opt-out when the actor would come only
   from unauthenticated email `From`; keep authenticated Linq sender opt-out.
3. Make group email fanout partial-failure safe without adding per-recipient
   durable ledgers; preserve stable per-occurrence `Message-ID`.
4. Add group-chat skill guidance for zero `read_stats` participants: do not
   send an empty newsletter; explain email sharing and stop that run.

## Round 1 Verification

Focused regression tests now pass:

- `packages/assistant-runtime`: `pnpm exec vitest run test/hosted-runtime-group-tool-linq-context.test.ts --config vitest.config.ts --no-coverage`
- `apps/cloudflare`: `pnpm exec vitest run apps/cloudflare/test/hosted-email.test.ts --config apps/cloudflare/vitest.config.ts --no-coverage`
- `apps/web`: `pnpm exec vitest run apps/web/test/hosted-group-tool.test.ts --config apps/web/vitest.workspace.ts --no-coverage`
- `packages/assistant-engine`: `pnpm exec vitest run test/assistant-skill-assets.test.ts --config vitest.config.ts --no-coverage`
- `packages/assistant-engine`: `pnpm exec vitest run test/assistant-codex-group-tool.test.ts --config vitest.config.ts --no-coverage`
- `packages/hosted-execution`: `pnpm exec vitest run test/hosted-runtime-control.test.ts --config vitest.config.ts --no-coverage`

Required typecheck/build verification passed:

- `packages/hosted-execution`: `pnpm typecheck`; `pnpm build`
- `packages/assistant-runtime`: `pnpm typecheck`; `pnpm build`
- `packages/assistant-engine`: `pnpm typecheck`; `pnpm build`
- `apps/cloudflare`: `pnpm typecheck`; `pnpm build`
- `apps/web`: `pnpm typecheck`; `pnpm build`

Final diff checks passed:

- `git diff --check`
- Diff privacy scan for local identifiers/secrets

## Round 2 Accepted Findings

1. Enforce the first-send opt-out window inside runtime send authority using
   the canonical automation creation timestamp plus one named minimum window.
2. Make newsletter email send identity depend only on immutable occurrence
   identity: automation id, occurrence time, and group id.
3. Compute shared weekly stats from the scheduled occurrence time and the group
   vault timezone instead of wall-clock UTC.

## Round 2 Constraints

- Add production-faithful failing tests before fixes.
- No new persisted state, manager, queue, migration, or durable recipient
  ledger.
- Keep all authority derived from server-side automation/runtime context, never
  model-supplied instructions.

## Round 2 Verification

Focused regression tests first failed against the accepted findings, then
passed after the minimal fixes:

- `packages/assistant-engine`: `pnpm exec vitest run test/assistant-cron-runtime.test.ts --config vitest.config.ts --no-coverage`
- `packages/assistant-runtime`: `pnpm exec vitest run test/hosted-runtime-group-tool-linq-context.test.ts --config vitest.config.ts --no-coverage`
- `packages/assistant-engine`: `pnpm exec vitest run test/assistant-codex-group-tool.test.ts --config vitest.config.ts --no-coverage`

Affected tests passed:

- `packages/assistant-engine`: `pnpm exec vitest run test/group-newsletter-shared-stats.test.ts test/assistant-codex-group-tool.test.ts test/assistant-cron-runtime.test.ts --config vitest.config.ts --no-coverage`
- `packages/assistant-runtime`: `pnpm exec vitest run test/hosted-runtime-group-tool-linq-context.test.ts --config vitest.config.ts --no-coverage`
- Repo root: `pnpm exec vitest run apps/cloudflare/test/hosted-email.test.ts --config apps/cloudflare/vitest.config.ts --no-coverage`

Required typecheck/build verification passed:

- `packages/assistant-engine`: `pnpm typecheck`; `pnpm build`
- `packages/assistant-runtime`: `pnpm typecheck`; `pnpm build`
- `apps/web`: `pnpm typecheck`; `pnpm build`
- `apps/cloudflare`: `pnpm typecheck`; `pnpm build`

## Release CI Gate Follow-Up

Current task: reproduce and green the host-support release gates for CLI
package shape, assistant/platform package coverage shards, and app
verification without committing.

Constraints:

- Keep coverage thresholds, test execution, callback auth, and product behavior
  intact.
- Add focused real tests for newsletter/runtime-control paths rather than
  gaming coverage.
- Preserve existing uncommitted Round 2 work.

Verification passed:

- CLI package shape: `pnpm --dir packages/cli gen:config-schema`; `pnpm exec tsx packages/cli/scripts/verify-package-shape.ts`
- Release package coverage, assistant shard: workflow package loop over `packages/assistant-engine`, `packages/assistant-cli`, `packages/assistantd`, and `packages/hosted-execution` with `MURPH_VITEST_MAX_WORKERS=50%`
- Release package coverage, platform shard: workflow package loop over the platform shard package list with `MURPH_VITEST_MAX_WORKERS=50%`
- Release app verification: `MURPH_APP_VERIFY_PARALLEL=1 MURPH_VERIFY_STEP_PARALLEL=1 pnpm test:apps`
- Touched package typecheck/build sweep: `packages/cli`, `packages/assistant-engine`, `packages/assistant-runtime`, `packages/hosted-execution`, `apps/cloudflare`, and `apps/web`
