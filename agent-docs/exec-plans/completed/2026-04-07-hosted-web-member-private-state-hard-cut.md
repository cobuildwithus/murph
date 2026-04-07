# Hard-cut hosted member private state into encrypted web-owned fields

Status: completed
Created: 2026-04-07
Updated: 2026-04-07

## Goal

- Make `apps/web` the sole owner of hosted member private data by storing encrypted raw identifiers on the Prisma owner tables, removing the Cloudflare `member-private-state` abstraction entirely, and keeping hosted execution inputs sparse/self-contained.

## Success criteria

- `HostedMemberIdentity`, `HostedMemberRouting`, and `HostedMemberBillingRef` store encrypted raw private values locally in Postgres.
- Hosted onboarding and billing reads/writes no longer call Cloudflare `member-private-state` helpers or do remote read/merge/write work.
- `member.activated` still carries `firstContact` directly and Cloudflare no longer depends on hosted member private-state lookups.
- The Cloudflare member-private-state route/store/client/package exports and their tests are removed.
- Architecture/docs describe web-owned encrypted hosted member private state and no longer describe Cloudflare as owner of hosted member private identifiers.
- Required verification and direct scenario evidence pass or any unrelated failures are clearly isolated.

## Scope

- In scope:
- Hosted member private state ownership and storage shape.
- Hosted onboarding/billing/usage callsites that currently depend on `member-private-state`.
- Cloudflare and `@murphai/hosted-execution` control-plane seams that expose `member-private-state`.
- Durable docs that describe the trust boundary.
- Out of scope:
- Re-encrypting or minimizing historical raw Stripe ids already persisted in operational ledger/fact tables such as `HostedBillingCheckout` or `HostedStripeEvent`.
- Broad hosted outbox/business-outcome ownership changes beyond whatever merge compatibility is needed with adjacent work.

## Constraints

- Technical constraints:
- Preserve overlapping hosted-boundary edits already in the worktree.
- Keep the implementation simple and composable: owner-table codecs over a new monolithic private-state abstraction.
- Use the new generic `HOSTED_WEB_ENCRYPTION_KEY*` env seam rather than Cloudflare-owned state projection.
- Product/process constraints:
- Greenfield hard cut is allowed: there are no current users and a destructive/no-backfill assumption is acceptable.
- Keep privacy-preserving storage for raw hosted member identifiers.

## Risks and mitigations

1. Risk: overlapping hosted onboarding/send-code work recently expanded signup-phone private-state fields.
   Mitigation: move the full signup-phone state, including pending send-attempt metadata, into `HostedMemberIdentity` so the hard cut preserves the current behavior.
2. Risk: shared hosted files also have adjacent outbox/business-outcome edits in flight.
   Mitigation: re-read shared files before each edit, keep the private-state deletion scoped, and avoid reverting adjacent changes.
3. Risk: removing the package/Cloudflare seam can leave dead route/client/tests behind.
   Mitigation: search all callsites, remove exports/routes/tests in the same change, and run focused verification on the affected packages/apps.

## Tasks

1. Add the hosted-web encryption env/codec seam and extend Prisma owner tables with encrypted private-state columns plus signup-phone attempt metadata.
2. Refactor hosted member store, invite/auth identity flows, and usage reads/writes to use local encrypted owner-table codecs only.
3. Remove Cloudflare and `@murphai/hosted-execution` member-private-state routes/clients/contracts/tests and update architecture/docs to the new trust boundary.
4. Run required verification, capture direct scenario evidence, complete required audit passes, and land a scoped commit.

## Decisions

- `apps/web` owns authoritative hosted member private data; Cloudflare no longer stores durable hosted member private identifiers.
- Raw private values are colocated with their owner tables instead of a new monolithic encrypted blob table.
- Signup-phone concurrency state (`signupPhoneCodeSendAttemptId` / `signupPhoneCodeSendAttemptStartedAt`) lives on `HostedMemberIdentity` with the rest of signup-phone state.
- `member.activated` remains self-contained with `firstContact`; Cloudflare should not rehydrate hosted member private state on activation.

## Verification

- Completed:
- `./node_modules/.bin/prisma generate` from `apps/web`
- `./node_modules/.bin/tsc -p packages/hosted-execution/tsconfig.json --noEmit --pretty false`
- `./node_modules/.bin/tsc -p apps/cloudflare/tsconfig.json --noEmit --pretty false`
- `./node_modules/.bin/vitest --config apps/web/vitest.config.ts run apps/web/test/hosted-onboarding-member-store.test.ts apps/web/test/hosted-onboarding-member-identity-service.test.ts apps/web/test/hosted-onboarding-member-service.test.ts apps/web/test/hosted-execution-usage.test.ts apps/web/test/hosted-execution-control.test.ts`
- `../../node_modules/.bin/vitest --config vitest.config.ts run test/hosted-execution.test.ts test/member-activated-outbox-payload.test.ts` from `packages/hosted-execution`
- `./node_modules/.bin/vitest --config apps/cloudflare/vitest.config.ts run apps/cloudflare/test/index.test.ts`
- `./node_modules/.bin/vitest --config apps/web/vitest.config.ts run apps/web/test/hosted-onboarding-member-store.test.ts apps/web/test/hosted-onboarding-member-service.test.ts`
- Notes:
- `./node_modules/.bin/tsc -p apps/web/tsconfig.json --noEmit --pretty false` still fails, but only in pre-existing unrelated hosted-share and share-preview files outside this hard-cut scope.
- Direct scenario proof remains targeted unit/integration coverage at the hosted member store, invite send/confirm/abort, hosted-execution usage/control, shared hosted-execution package, and Cloudflare route boundaries; no browser/manual flow was run.
Completed: 2026-04-07
