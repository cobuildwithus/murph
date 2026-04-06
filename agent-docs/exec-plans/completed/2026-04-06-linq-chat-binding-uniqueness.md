# Make Linq chat binding uniqueness explicit

Status: completed
Created: 2026-04-06
Updated: 2026-04-06

## Goal

- Decide whether hosted `HostedMemberRouting.linqChatId` is a one-member-to-one-direct-thread binding and encode that decision in the schema plus durable docs instead of leaving it implicit.

## Success criteria

- The Prisma schema and greenfield migration explicitly reflect the chosen `linqChatId` invariant.
- The write path and tests match that invariant instead of depending on unstated convention.
- Durable docs state why the invariant exists so future changes do not drift silently.

## Scope

- In scope:
  - `apps/web/prisma/schema.prisma`
  - `apps/web/prisma/migrations/2026040604_hosted_member_privacy_greenfield_baseline/migration.sql`
  - `apps/web/src/lib/hosted-onboarding/{hosted-member-store,member-identity-service}.ts`
  - `apps/web/test/hosted-onboarding-{member-store,member-service,privacy-foundation-migration}.test.ts`
  - `ARCHITECTURE.md`
  - `agent-docs/exec-plans/active/COORDINATION_LEDGER.md`
- Out of scope:
  - unrelated hosted onboarding/auth cleanup already in flight
  - broader Linq webhook or Cloudflare runtime behavior changes

## Constraints

- Preserve adjacent dirty-tree edits in hosted onboarding, migration-baseline, and architecture files.
- Treat this as a hosted schema/storage change, so the invariant must be explicit in both code and durable docs.
- Do not invent multi-member sharing semantics for a direct-thread binding without proof.

## Tasks

1. Confirm whether the current hosted onboarding and activation flows already rely on `linqChatId` being one direct thread per member.
2. Encode that invariant in the Prisma schema and greenfield baseline migration.
3. Tighten the write path and focused tests so duplicate bindings do not drift silently.
4. Run focused hosted-web verification, complete the required audit pass, and finish with a scoped commit.

## Decisions

- The current hosted onboarding and activation flows already treat Linq as a direct-thread channel keyed to one member identity, so `HostedMemberRouting.linqChatId` is now explicit unique state rather than an undocumented convention.
- The Linq binding write path now clears any stale owner row before upserting the current member so runtime behavior matches the schema invariant instead of relying on a late unique-index failure.
- After audit, the binding write path also retries once on `P2002` so concurrent exclusive rebind races self-heal instead of surfacing a raw unique-constraint failure on the first conflict.

## Verification

- Commands to run:
  - `pnpm --dir apps/web exec prisma format --config prisma.config.ts`
  - `pnpm --dir apps/web exec prisma generate --config prisma.config.ts`
  - `pnpm exec tsc -p apps/web/tsconfig.json --pretty false`
  - `pnpm exec vitest run --config apps/web/vitest.workspace.ts apps/web/test/hosted-onboarding-member-store.test.ts apps/web/test/hosted-onboarding-member-service.test.ts apps/web/test/hosted-onboarding-privacy-foundation-migration.test.ts --no-coverage`
- Expected outcomes:
  - Prisma schema/migration stay consistent and focused hosted-web tests prove the explicit Linq binding invariant.

## Verification status

- `pnpm --dir apps/web exec prisma format --config prisma.config.ts` passed.
- `pnpm --dir apps/web exec prisma generate --config prisma.config.ts` passed.
- `pnpm exec vitest run --config apps/web/vitest.workspace.ts apps/web/test/hosted-onboarding-member-store.test.ts apps/web/test/hosted-onboarding-privacy-foundation-migration.test.ts --no-coverage` passed before and after the audit-driven retry fix.
- `pnpm --dir apps/web lint` passed with existing warnings only.
- `pnpm typecheck` failed before and after the audit fix for a pre-existing unrelated error in `packages/setup-cli/src/setup-cli.ts` referencing missing `AssistantStatePaths.automationPath`.
- `pnpm test:coverage` failed before and after the audit fix at the same pre-existing unrelated `packages/setup-cli/src/setup-cli.ts` typecheck error during prepared runtime artifact build.
Completed: 2026-04-06
