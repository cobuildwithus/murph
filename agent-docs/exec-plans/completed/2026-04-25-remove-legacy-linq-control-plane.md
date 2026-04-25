Status: completed
Created: 2026-04-25
Updated: 2026-04-25

## Goal

- Remove the superseded hosted Linq control-plane routes and storage that are no longer used by the product.

## Success criteria

- `/api/linq/**` route handlers are gone.
- The legacy `linq_recipient_binding` and `linq_webhook_event` Prisma models are removed, with a migration that drops the live tables.
- Current hosted onboarding Linq ingress, home-line assignment, and multi-number capacity routing remain intact.
- Tests and docs no longer describe the deleted legacy control-plane surface as live.
- Static search shows no production imports of the deleted control-plane store, routes, or Prisma models.

## Scope

- In scope:
- `apps/web/app/api/linq/**`
- `apps/web/src/lib/linq/{control-plane,errors,http,prisma-store}.ts`
- `apps/web/src/lib/linq/env.ts` only for obsolete control-plane alias cleanup
- `apps/web/prisma/schema.prisma`
- `apps/web/prisma/migrations/**`
- Legacy `/api/linq/**` tests only
- `apps/web/vitest.workspace.ts`
- `apps/web/README.md`
- `ARCHITECTURE.md`
- `agent-docs/operations/verification-and-runtime.md`
- `agent-docs/prompts/seam-audits/30-web-device-sync-messaging-ingress.md`
- Out of scope:
- Current hosted onboarding Linq webhook under `/api/hosted-onboarding/linq/webhook`
- Current hosted Linq API client and env reader used by hosted onboarding
- Hosted member routing and home-line capacity assignment
- Separate RevNet issuance cleanup

## Constraints

- Preserve unrelated dirty-tree edits and active hosted onboarding rows.
- Do not remove `apps/web/src/lib/linq/{api,env}.ts` because hosted onboarding still uses them for outbound Linq API calls and ingress verification config.
- Do not edit already-applied baseline migration contents unless verification proves the repo requires it; prefer an additive drop migration for deployed databases.
- Keep raw phone numbers, chat ids, member ids, and provider payloads out of docs, logs, and handoff.

## Evidence

- Commit `2ee4084f8` introduced `apps/web/app/api/linq/**`, `PrismaLinqControlPlaneStore`, and the two legacy Linq tables as a standalone hosted Linq ingress/control-plane.
- Commit `8c52c03f6` introduced the separate hosted onboarding Linq webhook route under `/api/hosted-onboarding/linq/webhook`.
- Commits `b480bf721`, `df827198f`, and `8e63aa00a` moved active member Linq routing, home-line assignment, and active-member reply planning into hosted onboarding and `HostedMemberRouting`.
- Commit `cd53b48f4` already dropped hosted webhook receipt ownership from the old Linq control-plane.
- Commits `cc67bd0cf` and `505658cc0` removed the local Linq inbox connector/setup surfaces that the old agent polling route supported.
- Live table counts checked before removal showed `linq_recipient_binding = 0` and `linq_webhook_event = 0`, while current hosted member Linq routing rows live in `hosted_member_routing`.

## Tasks

1. Delete the legacy `/api/linq/**` route handlers and control-plane store/helper files.
2. Remove the legacy Prisma models and add a migration that drops the two tables.
3. Delete legacy route/store tests and update migration/docs tests for the new table contract.
4. Update route/docs/audit scope references so only the current hosted onboarding Linq ingress remains live.
5. Run scoped verification plus required completion-workflow audit passes.

## Decisions

- Treat the existing active Linq control-plane hardening row as superseded for `apps/web/src/lib/linq/control-plane.ts`; deleting the obsolete surface removes that hardening target instead of carrying another patch on dead code.
- Keep shared Linq parsing, normalization, API client, and hosted onboarding transport paths because they remain active product code.

## Verification

- Passed:
- `pnpm --dir apps/web exec prisma generate`
- `pnpm --dir apps/web typecheck`
- `pnpm exec vitest run apps/web/test/hosted-onboarding-privacy-foundation-migration.test.ts apps/web/test/hosted-onboarding-linq-route.test.ts apps/web/test/hosted-onboarding-linq-home-routing.test.ts apps/web/test/hosted-onboarding-linq-routing.test.ts --config apps/web/vitest.config.ts`
- `pnpm exec vitest run --config apps/web/vitest.workspace.ts --no-coverage apps/web/test/hosted-onboarding-linq-*.test.ts apps/web/test/hosted-onboarding-webhook-idempotency.test.ts apps/web/test/hosted-onboarding-privacy-foundation-migration.test.ts`
- `bash scripts/workspace-verify.sh test:diff ...` for the legacy Linq cleanup scope
- `git diff --check`
- Required audits:
- `security-privacy-review`: no blocker for the legacy control-plane removal; noted an unrelated hosted first-contact Linq expectation mismatch already owned by another dirty lane.
- `coverage-write`: updated current hosted-onboarding Linq home-routing test coverage for the unrelated dirty first-contact behavior and verified the hosted-onboarding Linq suite.
- `task-finish-review`: no task-blocking findings; confirmed remaining legacy table hits are baseline migration history plus the new drop migration/test.
Completed: 2026-04-25
