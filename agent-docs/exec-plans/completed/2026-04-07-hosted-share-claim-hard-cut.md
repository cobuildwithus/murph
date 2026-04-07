# Hard-cut hosted share accept/import to tiny refs and Cloudflare-owned pack hydration

Status: completed
Created: 2026-04-07
Updated: 2026-04-07

## Goal

- Remove the live Cloudflare share-pack read from the hosted web claim transaction and stop duplicating the opaque share pack into staged dispatch payload storage.

## Success criteria

- `acceptHostedShareLink()` no longer reads the Cloudflare share pack while holding the Postgres claim transaction.
- The canonical `vault.share.accepted` web/outbox dispatch carries only a tiny durable share reference, not the full share pack.
- `execution_outbox` can persist hosted share acceptance inline because the event is now small.
- Cloudflare hydrates the opaque share pack immediately before runner execution and fails closed when the pack is missing.
- Assistant runtime share import still imports the same canonical share pack and the hosted-web completion callback still finalizes and deletes the consumed pack.
- Hosted docs/tests describe the new boundary truthfully.

## Scope

- In scope:
- `apps/web/src/lib/hosted-share/**`
- `apps/web/src/lib/hosted-execution/**`
- `apps/web/test/**`
- `apps/cloudflare/**`
- `packages/hosted-execution/**`
- `packages/assistant-runtime/**`
- `ARCHITECTURE.md`
- `apps/web/README.md`
- `apps/cloudflare/README.md`
- `agent-docs/exec-plans/active/COORDINATION_LEDGER.md`
- This active plan
- Out of scope:
- Broad hosted onboarding UX changes
- Reworking the Cloudflare share-pack storage format beyond what the claim/import hard cut needs
- Reintroducing runner-side generic share payload proxy routes

## Constraints

- Keep Postgres as the durable owner of share lifecycle and preview metadata only.
- Keep Cloudflare as the only durable owner of the opaque share pack payload.
- Preserve the runner trust boundary; do not widen the runner proxy surface so an isolated run can fetch arbitrary owner-bound share packs directly.
- Preserve unrelated dirty worktree edits and active hosted lanes.
- Follow the repo high-risk verification and audit workflow, including direct scenario proof.

## Risks and mitigations

1. Risk: Changing the shared dispatch contract could break queue, runner, or callback code paths.
   Mitigation: Update the shared hosted-execution parsers/builders/tests together and add focused Cloudflare plus assistant-runtime coverage.
2. Risk: Hydrating the share pack in the wrong layer could weaken runner isolation.
   Mitigation: Keep hydration inside Cloudflare worker/DO code immediately before runner invocation instead of adding a new generic runner-outbound share route.
3. Risk: Missing share packs could now fail later than the web claim.
   Mitigation: Fail closed in Cloudflare before runner import, preserve retries where appropriate, and keep the hosted-web release/finalize lifecycle coherent.

## Tasks

1. Narrow the hosted share dispatch contract from inline pack payloads to tiny share refs.
2. Remove the claim-time Cloudflare pack read from hosted web acceptance and switch share acceptance outbox payloads to inline storage.
3. Hydrate the share pack inside Cloudflare just before runner invocation, then keep assistant-runtime import behavior unchanged from the hydrated runner request.
4. Update focused tests and durable docs to match the new ownership split.
5. Run required verification, collect direct scenario evidence, complete the required audit review, and finish with a scoped commit.

## Decisions

- Reuse the existing durable share identity (`senderMemberId` plus `shareId`) as the share-pack reference instead of inventing a second persisted pack-ref column.
- Keep the opaque share pack out of Postgres and out of staged dispatch payload storage.
- Hydrate the pack in Cloudflare before runner execution rather than teaching the isolated runner to fetch sender-owned share payloads directly.

## Verification

- Completed:
- `pnpm --dir apps/web prisma:generate`
- `pnpm --dir apps/web lint`
- `pnpm --dir packages/hosted-execution exec vitest run test/share-reference.test.ts test/outbox-payload.test.ts --no-coverage`
- `pnpm exec vitest run --config apps/web/vitest.config.ts apps/web/test/hosted-share-service.test.ts apps/web/test/hosted-share-import-complete-route.test.ts apps/web/test/hosted-share-import-release-route.test.ts apps/web/test/hosted-execution-outbox.test.ts apps/web/test/hosted-execution-outbox-payload.test.ts apps/web/test/hosted-execution-contract-parity.test.ts --no-coverage`
- `pnpm exec vitest run --config apps/cloudflare/vitest.config.ts apps/cloudflare/test/business-outcomes.test.ts --no-coverage`
- `pnpm exec vitest run --config apps/cloudflare/vitest.config.ts apps/cloudflare/test/runner-queue-confidentiality.test.ts --no-coverage`
- `pnpm --dir packages/assistant-runtime exec vitest run test/hosted-share.test.ts --no-coverage`
- Direct proof: `pnpm exec vitest run --config apps/cloudflare/vitest.config.ts apps/cloudflare/test/node-runner.test.ts -t "ignores hosted web env when importing a runner-hydrated share pack" --no-coverage`
- Required simplify review completed; both findings were fixed locally.
- Required final completion review completed; both findings were fixed locally, including stale callback replay coverage.

- Blocked outside this task:
- `pnpm typecheck`
  - Fails in workspace boundary checks before TypeScript because `packages/assistant-runtime/src/hosted-runtime/internal-http.ts` and `packages/hosted-execution/test/hosted-execution.test.ts` still import `@murphai/hosted-execution/callback-hosts`, which is outside this hosted-share seam and already inconsistent with current public entrypoints.
- `pnpm --dir packages/hosted-execution exec vitest run test/share-reference.test.ts test/outbox-payload.test.ts test/hosted-execution.test.ts --no-coverage`
  - `test/hosted-execution.test.ts` now hits the same unrelated missing `@murphai/hosted-execution/callback-hosts` import in the dirty tree; the two directly affected share-contract tests still pass.

- Still pending:
- Scoped commit/plan closeout.
Completed: 2026-04-07
