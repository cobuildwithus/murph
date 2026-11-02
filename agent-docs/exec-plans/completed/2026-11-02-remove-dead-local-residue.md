# Remove dead local residue and retired ChatGPT linking

Status: completed
Created: 2026-11-02
Updated: 2026-11-02

## Goal

- Delete the audited unsupported APIs, write-only status projection, obsolete lifecycle helpers, stale support material, and retired member ChatGPT linking consumers. Preserve hosted replies, canonical state, runtime-write locking, startup laziness, and the runner bundle budget.

## Success criteria

- Recheck reachability at base `c04ccc04cc`, including Web/Ops/scripts, Cloudflare, runner entrypoints, hosted prompts/skills, and CLI.
- Make four scoped commits; generate artifacts through their owners; complete the requested builds, typechecks, tests, guards, and prompt measurements.

## Scope

- In scope: audit A slices 1–3 and B1 only. The audit was pinned to `480b53eb1c`; lock acquisition is already absent.
- Out of scope: device/npm retirement, migration machinery, Stripe, Fitbit, other product candidates, completed plans, and other checkouts.

## Constraints

- Technical constraints: no casts suppressing type errors; no sibling source imports; no schema drops; retain hosted config writes and reads.
- Product/process constraints: local commits only, no push/PR/production access, no stash. Use provided zero-population evidence for retired linking, not new production queries.

## Risks and mitigations

1. Hidden status consumer: trace files, events, snapshots, logs, Ops, and projections before deletion.
2. Deployment skew: route retired mailbox items through existing unknown-kind handling and test consumption; document callback rejection and retained schema.
3. Live prompt change: preserve navigation guidance, measure o200k_base tokens and UTF-8 bytes, regenerate hashes, and run focused assistant proof.

## Tasks

1. Prune unsupported exported APIs and their detached tests.
2. Remove status projection and obsolete lifecycle helpers after consumer proof.
3. Remove dashboard wrapper/test scaffolding and update prompt/docs.
4. Remove retired linking consumers and verify unknown mailbox behavior.
5. Complete requested checks, review, record limitations, and close this plan in the fourth commit.

## Decisions

- No member-visible release note: this task removes unsupported internal code and corrects internal navigation wording.
- External review tied to a pushed PR is unavailable under the explicit no-push/no-PR boundary; parent review remains required.

## Verification

- Baseline `pnpm install` and `pnpm build`: passed.
- Required final proof: build; workspace boundaries/cycles; dependencies; source hygiene; CLI; touched package typechecks/tests; Web typecheck/focused tests; Cloudflare typecheck/Node tests/full runner bundle; docs drift; complexity diff.
- Record actual results and any baseline comparison below as work proceeds.

## Slice 1 evidence

- Current gateway production imports are limited to assistant channel routing, operator delivery/CLI contracts, and hosted side effects. Removed RPC, IDs, timestamp validation and errors have no production callers. Retained reply-route inference and its vocabulary.
- Model catalog, display config, conversation-open/session-options, operator setup/self-target writers and equality/header-normalization helpers are detached from Web, Cloudflare, runner, CLI and hosted prompts/skills. Retained hosted config persistence, default-vault reads, strict self-target reads and header redaction/persistence.
- Replaced test-only setup writers with synthetic config fixtures; kept hosted provider-routing tests inside the former mixed catalog suite.
- Build, four touched-owner typechecks, operator-config tests (454), focused engine tests (273), and focused CLI tests passed. Initial deletion-induced missing-export type errors were fixed; gateway test failure was an empty suite left by removed route APIs, confirmed against the nonempty base suite.

## Slice 2 evidence

- No production reads of `status.json`, status service methods, or `status.snapshot.refreshed` remain in Web/Ops/scripts, Cloudflare, hosted runtime projections, logs, CLI or hosted instructions. Web workspace `redacted_status_json` comes from the hosted invocation/mailbox progress projection, not the removed file.
- Removed portable status descriptor, writer/read API, service status members, and status-only schemas. Retained hot-snapshot exclusion and historical runtime-event/quarantine vocabulary so old logs remain readable; retained live outbox summary type.
- Automation lock has no producer after the stacked removal; runtime-write lock remains the sole maintained lock. Generic process identity/kill helpers, polling wait and old auto-reply reconciliation have no production callers.
- Full snapshots also used a broad assistant continuity copy; added the retired file to its existing exclusion list and proved omission on restore. Portability and warning assertions initially failed because they expected the deleted behavior, confirmed against the base assertions.
- Slice 2 build and five touched-owner typechecks passed. Runtime-state (297 passed, 21 skipped), inboxd (194 passed, 3 skipped), operator-config, 13 focused engine files (519 tests after targeted correction), and two focused CLI files (34 tests) passed.

## Slice 3 evidence

- Removed the legacy dashboard replica wrapper and package/TypeScript aliases after finding no production importer. Removed unused inbox read-test daemon/connector mocks, preserving current read behavior.
- Corrected only the live direct-conversation navigation sentence. Other non-hosted prompt branches are not certified dead and remain. Updated stale seam-audit scopes and feature ledger rows against the current routes and files.
- `gpt-tokenizer` 3.4.0 with `o200k_base`: the sentence changes from 19 to 14 tokens and 95 to 64 UTF-8 bytes. Full hosted direct prompt changes from 19,723 to 19,718 tokens and 98,603 to 98,572 bytes; retained non-hosted direct changes from 20,687 to 20,682 tokens and 103,772 to 103,741 bytes. Group prompts are unchanged. Navigation is in the stable route-capability layer; static-core hashes are unchanged. Vitest regenerated hash snapshots.
- Build, three owner typechecks, hosted-execution and inbox-services suites, and 57 prompt tests passed. The focused real-Codex event-list journey passed with subscription auth and the configured gpt-6.1-sol; its production prompt assertions prove navigation remains and the obsolete wording is absent.

## Slice 4 evidence

- Provided read-only production evidence dated 2026-11-02 reports zero connection rows and zero linking mailbox rows (including unconsumed and content-retained). No production access or mutation was performed in this task.
- Deleted the member-linking callback/store, wire validators/builders/types, Worker egress allowance, runtime cleanup handler, and checkpoint cleanup reader. Kept platform-managed/local Codex bootstrap authentication, account data export/deletion, and all Prisma schema/migrations.
- Reused `HOSTED_RETIRED_MAILBOX_KINDS` and `skip-retired-mailbox-item`: the parameterized import test proves the old kind never loads payloads, never blocks, and advances through later active work. Snapshot tests cover pending, sending, and recording legacy shapes before removed action/checkpoint parsing. Unknown-kind handling remains unchanged. Worker tests reject the removed callback before network forwarding.
- Mixed scheduling tests formerly used linking fixtures; they now use supported manual runtime controls or member-action/vault-share records. Dedicated retired behavior tests were removed. A missed test-helper importer caused the first runtime typecheck failure; base `c04ccc04cc` exported that fixture, confirming a deletion-induced failure. All affected tests/typechecks passed after updating the remaining importer.
- Skew: new runner plus old Web/Worker sends no retired callbacks. The immediate base runner also sends none (cleanup only). Earlier callback-producing runners against new Web receive 404; a new Worker rejects that path before forwarding even with an old Web. Retry behavior belongs to those old binaries. Provided row counts do not establish image drain; no deployment was attempted.
- Retained schema: `HostedCodexAuthConnection` / `hosted_codex_auth_connection`; `member_id`, `state`, `attempt_id`, `verification_url`, `user_code`, `updated_at`; member relation and cascading foreign key, primary key, and both historical auth migrations. `HostedMember.codexAuthConnection`, `HostedMailboxItem` / `hosted_mailbox_item` and every mailbox column/index/enum remain. Connection state and mailbox kind are String columns, not auth-specific Prisma enums.
- Build, hosted-execution/runtime typechecks, Web/Cloudflare typechecks, the full hosted-execution suite, eight focused runtime files (527 passed, 6 credential-gated skips), and three focused Web files (186 passed) passed.
- Docs drift initially rejected a 37-file change because the already-committed active plan was absent from the current diff. The checker is unchanged from `c04ccc04cc`; updating this plan supplies the required evidence without changing or bypassing the guard.

## PR CI follow-up

Full PR CI on `c66620edc9` found three gaps that the focused local lanes did not run:

- Deleting `contracts-routes-opaque-ids.test.ts` also removed the edge-case tests for the retained reply-route inference, so gateway-core line coverage fell to 77.77%, under the 80% floor. Those edge cases (explicit routes, directness normalization, requested delivery kinds, participant and thread fallback, Linq and channel-less routing) are now in `packages/gateway-core/test/reply-routes.test.ts`. Coverage is back to 100% lines.
- `scripts/workspace-boundaries/import-policy-rules.test.ts` still expected the removed `zod/v4` owner exception for gateway-core; that case is removed with the exception.
- The route-plan digest snapshot in `test/assistant-codex-turn-planning.test.ts` changed for the direct and scheduled-email plans, which carry the corrected navigation sentence. It was regenerated with Vitest.

## Retained and skipped work

- No requested deletion was skipped for an unexpected production consumer. The audit's required exceptions remain: hosted `local-service.ts`, runtime-write locking, reply-route enums/types, outbox summaries, config reads/hosted writes/default-vault resolution, self-target defaults, and header persistence/redaction.
- `resolveAssistantOperatorDefaultsForPatch` remains because live strict self-target reads use it, even though setup writers were removed. Historical status event/quarantine vocabulary and snapshot exclusions remain for old data readability and exclusion.
- Lock acquisition, its in-process registry, and its conflict error were already removed by the stacked base. No duplicate change was made.
- Non-hosted prompt branches, unrelated product/migration candidates, device/npm work, ignored artifacts in other checkouts, and completed execution plans were left intact.
- Generated config/schema/CLI artifacts were produced with the real package generators and build assembly. Prompt snapshots were regenerated with Vitest, not hand-computed. The core prompt hash remains unchanged because only the stable route-capability layer changed.

## Verification command ledger

Commands ran in this isolated worktree. Tests use focused package invocations or
requested package lanes; no root `pnpm test`, coverage, acceptance, deployment,
push, or PR command ran. Repeated commands retain every observed result below.
Initial baseline `pnpm install` and `pnpm build` also passed before editing.
Intermediate failures are recorded rather than hidden by their later passes.

| Command | Attempts and result |
| --- | --- |
| `pnpm --filter @murphai/operator-config --filter @murphai/assistant-engine --filter @murphai/gateway-core typecheck` | slice1-typecheck: FAIL |
| `pnpm --filter @murphai/operator-config --filter @murphai/assistant-engine --filter @murphai/gateway-core --filter @murphai/murph --no-bail typecheck` | slice1-typecheck2: FAIL; slice1-typecheck3: FAIL; slice1-typecheck4: PASS |
| `pnpm install` | slice1-install: PASS |
| `pnpm build` | slice1-build: PASS; slice2-build: PASS; slice3-build: PASS; slice4-build: PASS |
| `pnpm --dir packages/cli exec vitest run --config vitest.config.ts --no-coverage test/assistant-cli.test.ts test/assistant-codex.test.ts test/assistant-cron.test.ts test/gateway-core.test.ts` | slice1-cli-tests: PASS |
| `pnpm --dir packages/assistant-engine exec vitest run --config vitest.config.ts --no-coverage test/assistant-codex-final-coverage.test.ts test/assistant-codex-runtime-config.test.ts test/assistant-service-runtime.test.ts test/assistant-product-small-seams.test.ts test/codex-runtime-helpers.test.ts` | slice1-engine-tests: PASS |
| `pnpm --filter @murphai/gateway-core --filter @murphai/operator-config --no-bail test` | slice1-owner-tests: FAIL |
| `pnpm --dir packages/gateway-core test` | slice1-gateway-tests: PASS |
| `pnpm --dir packages/cli gen:config-schema` | slice1-generate: PASS; slice2-generate: PASS; slice3-generate: PASS |
| `pnpm verify:workspace-boundaries` | slice1-boundaries: PASS; final-boundaries: PASS |
| `pnpm --dir packages/cli exec vitest run --config vitest.config.ts --no-coverage test/cli-entry.test.ts test/cli-entry-program-name.test.ts` | slice1-cli-entry-tests: PASS |
| `pnpm --filter @murphai/runtime-state --filter @murphai/inboxd --filter @murphai/operator-config --filter @murphai/assistant-engine --filter @murphai/murph --no-bail typecheck` | slice2-typecheck: FAIL; slice2-typecheck2: FAIL; slice2-typecheck3: PASS; slice2-final-typecheck: PASS |
| `pnpm --filter @murphai/runtime-state --filter @murphai/inboxd --filter @murphai/operator-config --no-bail test` | slice2-owner-tests: FAIL |
| `pnpm --dir packages/assistant-engine exec vitest run --config vitest.config.ts --no-coverage test/assistant-automation-runtime.test.ts test/assistant-automation-state.test.ts test/assistant-automation-support.test.ts test/assistant-infra-final-coverage.test.ts test/assistant-runtime-thresholds.test.ts test/assistant-runtime-locking.test.ts test/assistant-store-runtime.test.ts test/assistant-service-result.test.ts test/assistant-local-service-delivery.test.ts test/assistant-local-service-failures.test.ts test/assistant-notification-turn-runtime.test.ts test/assistant-notification-audience-authority.integration.test.ts test/assistant-cron-product-feedback.integration.test.ts` | slice2-engine-tests: FAIL |
| `pnpm --dir packages/runtime-state test` | slice2-runtime-tests: PASS |
| `pnpm --dir packages/assistant-engine exec vitest run --config vitest.config.ts --no-coverage test/assistant-notification-turn-runtime.test.ts` | slice2-notification-tests: PASS |
| `pnpm --dir packages/cli exec vitest run --config vitest.config.ts --no-coverage test/assistant-runtime-state-service.test.ts test/assistant-state.test.ts` | slice2-cli-tests: PASS |
| `pnpm --dir packages/assistant-engine exec vitest run --config vitest.config.ts --no-coverage test/model-behavior.test.ts --update` | slice3-prompt-hash: PASS; slice3-prompt-hash2: PASS |
| `pnpm --filter @murphai/hosted-execution --filter @murphai/inbox-services --filter @murphai/assistant-engine --no-bail typecheck` | slice3-typecheck: PASS |
| `pnpm --filter @murphai/hosted-execution --filter @murphai/inbox-services --no-bail test` | slice3-owner-tests: PASS |
| `pnpm exec tsx --tsconfig tsconfig.base.json .tmp/dead-residue/measure-prompt.ts` | slice3-prompt-measure: PASS |
| `pnpm test:assistant:live -- --test event-list isolation recalls two saved facts despite malformed goal frontmatter` | slice3-live: PASS |
| `pnpm --filter @murphai/hosted-execution --filter @murphai/assistant-runtime --no-bail typecheck` | slice4-typecheck: FAIL; slice4-typecheck2: PASS; slice4-final-typecheck: PASS |
| `pnpm --dir apps/web typecheck` | final-web-typecheck: PASS |
| `pnpm --dir apps/cloudflare typecheck` | final-cloudflare-typecheck: PASS |
| `pnpm --dir packages/hosted-execution exec vitest run --config vitest.config.ts --no-coverage` | slice4-hosted-tests: PASS |
| `pnpm exec vitest run --config apps/web/vitest.config.ts --no-coverage apps/web/test/codex-auth-retirement.test.ts apps/web/test/settings-page.test.ts apps/web/test/hosted-account-data-service.test.ts` | final-web-tests: PASS |
| `pnpm docs:drift` | final-docs: FAIL; final-docs2: PASS; final-docs3: PASS |
| `pnpm verify:workspace-package-cycles` | final-cycles: PASS |
| `pnpm deps:guard` | final-deps: PASS |
| `pnpm no-js` | final-no-js: PASS |
| `pnpm complexity:diff --base c04ccc04cc` | final-complexity: PASS |
| `pnpm --dir packages/assistant-runtime exec vitest run --config vitest.config.ts --isolate=true --no-coverage test/hosted-runtime-mailbox-routing.test.ts test/hosted-runtime-mailbox-import.test.ts test/hosted-runtime-mailbox-state.test.ts test/hosted-runtime-events-coverage.test.ts test/hosted-runtime-system-mailbox-notification.test.ts test/hosted-runtime-workspace-assistant-phase-delivery.test.ts test/hosted-runtime-workspace-assistant-phase-foreground.test.ts test/hosted-runtime-codex-config.test.ts` | slice4-runtime-tests: PASS |
| `pnpm verify:cli` | final-cli: PASS |
| `pnpm --dir packages/assistant-runtime exec vitest run --config vitest.config.ts --isolate=true --no-coverage test/hosted-runtime-mailbox-state.test.ts` | slice4-mailbox-test-final: PASS |
| `pnpm --dir apps/cloudflare test:node` | final-cloudflare-tests: PASS |
| `pnpm --dir apps/cloudflare runner:bundle` | final-runner-bundle: PASS |

Failure disposition: intermediate typechecks identified stale references or
imports removed during the edits; those definitions/imports existed at
`c04ccc04cc`. Empty gateway-suite, portable-status, and removed-status-warning
assertions were likewise specific to deleted behavior at that base. Their
remaining live coverage passed after targeted correction. No guard was weakened.
The docs-plan failure and its passing correction are described above.

## Per-slice file inventory

Counts below include source, tests, documentation, and generated artifact changes.
Physical deleted lines are gross deletions, not net savings. Git rename detection
is used for the status test and final plan move.

### Slice 1 — `b92b8b53016d`

| File | Lines removed |
| --- | ---: |
| `agent-docs/exec-plans/active/2026-11-02-remove-dead-local-residue.md` | 0 |
| `agent-docs/index.md` | 0 |
| `packages/assistant-engine/package.json` | 4 |
| `packages/assistant-engine/src/assistant-codex.ts` | 2 |
| `packages/assistant-engine/src/assistant-codex/config.ts` | 123 |
| `packages/assistant-engine/src/assistant-provider-catalog.ts` | 6 |
| `packages/assistant-engine/src/assistant/codex-runtime.ts` | 6 |
| `packages/assistant-engine/src/assistant/local-service.ts` | 69 |
| `packages/assistant-engine/src/assistant/provider-catalog.ts` | 189 |
| `packages/assistant-engine/src/assistant/providers/catalog.ts` | 29 |
| `packages/assistant-engine/src/assistant/providers/types.ts` | 16 |
| `packages/assistant-engine/src/assistant/service.ts` | 26 |
| `packages/assistant-engine/test/assistant-codex-final-coverage.test.ts` | 152 |
| `packages/assistant-engine/test/assistant-codex-runtime-config.test.ts` | 47 |
| `packages/assistant-engine/test/assistant-codex-runtime-events.test.ts` | 1 |
| `packages/assistant-engine/test/assistant-codex-runtime-process.test.ts` | 1 |
| `packages/assistant-engine/test/assistant-codex-runtime-recovery.test.ts` | 1 |
| `packages/assistant-engine/test/assistant-codex-runtime-tools.test.ts` | 3 |
| `packages/assistant-engine/test/assistant-codex-runtime-turns.test.ts` | 1 |
| `packages/assistant-engine/test/assistant-codex-runtime.harness.ts` | 1 |
| `packages/assistant-engine/test/assistant-local-service-session.test.ts` | 155 |
| `packages/assistant-engine/test/assistant-product-small-seams.test.ts` | 104 |
| `packages/assistant-engine/test/assistant-service-runtime.test.ts` | 57 |
| `packages/assistant-engine/test/codex-runtime-helpers.test.ts` | 29 |
| `packages/cli/test/assistant-cli.test.ts` | 3 |
| `packages/cli/test/assistant-codex.test.ts` | 44 |
| `packages/cli/test/assistant-cron.test.ts` | 12 |
| `packages/cli/test/cli-entry-program-name.test.ts` | 1 |
| `packages/cli/test/cli-entry.test.ts` | 11 |
| `packages/cli/test/gateway-core.test.ts` | 218 |
| `packages/gateway-core/README.md` | 1 |
| `packages/gateway-core/package.json` | 3 |
| `packages/gateway-core/src/contracts.ts` | 260 |
| `packages/gateway-core/src/errors.ts` | 27 |
| `packages/gateway-core/src/index.ts` | 6 |
| `packages/gateway-core/src/opaque-ids.ts` | 316 |
| `packages/gateway-core/src/routes.ts` | 407 |
| `packages/gateway-core/src/shared.ts` | 23 |
| `packages/gateway-core/test/contracts-routes-opaque-ids.test.ts` | 963 |
| `packages/gateway-core/test/reply-routes.test.ts` | 96 |
| `packages/operator-config/README.md` | 3 |
| `packages/operator-config/src/assistant-backend.ts` | 10 |
| `packages/operator-config/src/assistant/provider-config.ts` | 63 |
| `packages/operator-config/src/operator-config.ts` | 129 |
| `packages/operator-config/src/operator-config/self-delivery-targets.ts` | 79 |
| `packages/operator-config/src/operator-config/storage.ts` | 18 |
| `packages/operator-config/test/assistant-config-helpers.test.ts` | 30 |
| `packages/operator-config/test/assistant-seam-coverage.test.ts` | 27 |
| `packages/operator-config/test/config-env.test.ts` | 26 |
| `packages/operator-config/test/operator-config-seam.test.ts` | 235 |
| `packages/operator-config/test/operator-config-storage.test.ts` | 7 |
| `pnpm-lock.yaml` | 4 |
| `scripts/workspace-boundaries/import-policy-rules.mjs` | 5 |

### Slice 2 — `b49d874511e1`

| File | Lines removed |
| --- | ---: |
| `ARCHITECTURE.md` | 1 |
| `agent-docs/exec-plans/active/2026-11-02-remove-dead-local-residue.md` | 0 |
| `agent-docs/index.md` | 1 |
| `agent-docs/operations/verification-and-runtime.md` | 1 |
| `packages/assistant-engine/package.json` | 4 |
| `packages/assistant-engine/src/assistant-automation.ts` | 4 |
| `packages/assistant-engine/src/assistant-runtime.ts` | 1 |
| `packages/assistant-engine/src/assistant-status.ts` | 1 |
| `packages/assistant-engine/src/assistant/ask-continuation.ts` | 7 |
| `packages/assistant-engine/src/assistant/automation-state.ts` | 24 |
| `packages/assistant-engine/src/assistant/automation/run-loop.ts` | 13 |
| `packages/assistant-engine/src/assistant/automation/runtime-lock.ts` | 103 |
| `packages/assistant-engine/src/assistant/local-service.ts` | 12 |
| `packages/assistant-engine/src/assistant/notification-turn.ts` | 20 |
| `packages/assistant-engine/src/assistant/runtime-budgets.ts` | 9 |
| `packages/assistant-engine/src/assistant/runtime-state-service.ts` | 21 |
| `packages/assistant-engine/src/assistant/status.ts` | 266 |
| `packages/assistant-engine/src/index.ts` | 1 |
| `packages/assistant-engine/test/assistant-automation-runtime.test.ts` | 9 |
| `packages/assistant-engine/test/assistant-automation-state.test.ts` | 36 |
| `packages/assistant-engine/test/assistant-automation-support.test.ts` | 52 |
| `packages/assistant-engine/test/assistant-cron-product-feedback.integration.test.ts` | 1 |
| `packages/assistant-engine/test/assistant-infra-final-coverage.test.ts` | 85 |
| `packages/assistant-engine/test/assistant-local-service-delivery.test.ts` | 1 |
| `packages/assistant-engine/test/assistant-local-service-failures.test.ts` | 6 |
| `packages/assistant-engine/test/assistant-local-service-runtime.harness.ts` | 6 |
| `packages/assistant-engine/test/assistant-notification-audience-authority.integration.test.ts` | 5 |
| `packages/assistant-engine/test/assistant-notification-turn-runtime.test.ts` | 49 |
| `packages/assistant-engine/test/assistant-runtime-locking.test.ts` | 68 |
| `packages/assistant-engine/test/assistant-runtime-thresholds.test.ts` | 33 |
| `packages/assistant-engine/test/assistant-service-result.test.ts` | 0 |
| `packages/assistant-engine/test/assistant-status.test.ts` | 741 |
| `packages/assistant-engine/test/assistant-store-runtime.test.ts` | 40 |
| `packages/cli/test/assistant-runtime-state-service.test.ts` | 1 |
| `packages/cli/test/assistant-state.test.ts` | 27 |
| `packages/inboxd/src/shared-runtime.ts` | 24 |
| `packages/inboxd/src/shared.ts` | 2 |
| `packages/inboxd/test/inboxd-parsers-shared-coverage.test.ts` | 28 |
| `packages/inboxd/test/inboxd-shared-barrels-coverage.test.ts` | 2 |
| `packages/operator-config/src/assistant-cli-contracts.ts` | 95 |
| `packages/operator-config/test/assistant-runtime-contracts-coverage.test.ts` | 39 |
| `packages/operator-config/test/config-env.test.ts` | 30 |
| `packages/runtime-state/README.md` | 0 |
| `packages/runtime-state/src/assistant-local-state-descriptors.ts` | 4 |
| `packages/runtime-state/src/assistant-state.ts` | 2 |
| `packages/runtime-state/src/hosted-bundles.ts` | 0 |
| `packages/runtime-state/src/node/index.ts` | 2 |
| `packages/runtime-state/src/process-identity.ts` | 136 |
| `packages/runtime-state/src/process-kill.ts` | 20 |
| `packages/runtime-state/test/assistant-runtime-issues.test.ts` | 5 |
| `packages/runtime-state/test/hosted-bundle.test.ts` | 5 |
| `packages/runtime-state/test/process-identity.test.ts` | 96 |
| `packages/runtime-state/test/process-kill.test.ts` | 28 |

### Slice 3 — `3ac06f5bcbf5`

| File | Lines removed |
| --- | ---: |
| `agent-docs/RELIABILITY.md` | 1 |
| `agent-docs/exec-plans/active/2026-11-02-remove-dead-local-residue.md` | 0 |
| `agent-docs/feature-user-story-audit/feature-status.csv` | 4 |
| `agent-docs/index.md` | 1 |
| `agent-docs/prompts/seam-audits/17-inbox-services.md` | 5 |
| `agent-docs/prompts/seam-audits/19-gateway-core.md` | 3 |
| `packages/assistant-engine/src/assistant/system-prompt.ts` | 1 |
| `packages/assistant-engine/test/assistant-codex-real-e2e.test.ts` | 0 |
| `packages/assistant-engine/test/model-behavior.test.ts` | 3 |
| `packages/hosted-execution/README.md` | 0 |
| `packages/hosted-execution/package.json` | 8 |
| `packages/hosted-execution/src/dashboard-replica.ts` | 2 |
| `packages/hosted-execution/src/legacy-dashboard-replica.ts` | 53 |
| `packages/hosted-execution/test/hosted-execution.test.ts` | 29 |
| `packages/inbox-services/test/inbox-app-reads-runtime.test.ts` | 20 |
| `tsconfig.base.json` | 6 |

## Open rollout limits

- This local task does not establish that earlier callback-producing images or
  auth-bearing snapshots have drained. New consumers skip retired work without
  attempting credential deletion. Existing bootstrap credential policy remains
  intact; old credentials outside its normal cleanup rules were not inspected.
- Older callback-producing binaries can retry a 404 according to their own
  policy until they are retired. Current-base runners do not emit callbacks.
- No external ReviewGPT/CI, deployed smoke, or production inventory was run under
  the explicit no-push/no-PR/no-production boundary. Local credential-gated tests
  retain their normal skips; the targeted real-Codex navigation journey passed.

### Slice 4 — retired linking consumers

| File | Lines removed |
| --- | ---: |
| `agent-docs/index.md` | 1 |
| `agent-docs/references/hosted-runtime-protocol.md` | 30 |
| `apps/cloudflare/src/runner-outbound/shared-web-control-policy.ts` | 5 |
| `apps/cloudflare/test/hosted-local-foreground-reply-priority-e2e.test.ts` | 8 |
| `apps/cloudflare/test/legacy-codex-auth-callback.test.ts` | 261 |
| `apps/cloudflare/test/runner-outbound.test.ts` | 20 |
| `apps/web/app/api/internal/hosted-runtime/codex-auth/route.ts` | 59 |
| `apps/web/src/lib/codex-auth/store.ts` | 208 |
| `apps/web/test/codex-auth-retirement.test.ts` | 11 |
| `apps/web/test/codex-auth-store.test.ts` | 212 |
| `apps/web/test/support/hosted-web-testkit.ts` | 7 |
| `packages/assistant-runtime/README.md` | 0 |
| `packages/assistant-runtime/src/hosted-runtime/events.ts` | 8 |
| `packages/assistant-runtime/src/hosted-runtime/events/codex-auth.ts` | 26 |
| `packages/assistant-runtime/src/hosted-runtime/mailbox-routing.ts` | 1 |
| `packages/assistant-runtime/src/hosted-runtime/models.ts` | 6 |
| `packages/assistant-runtime/src/hosted-runtime/system-mailbox-state.ts` | 20 |
| `packages/assistant-runtime/src/hosted-runtime/system-mailbox.ts` | 10 |
| `packages/assistant-runtime/src/hosted-runtime/workspace-assistant-phase.ts` | 2 |
| `packages/assistant-runtime/test/hosted-runtime-events-coverage.test.ts` | 82 |
| `packages/assistant-runtime/test/hosted-runtime-mailbox-routing.test.ts` | 0 |
| `packages/assistant-runtime/test/hosted-runtime-mailbox-state.test.ts` | 49 |
| `packages/assistant-runtime/test/hosted-runtime-system-mailbox-notification.test.ts` | 202 |
| `packages/assistant-runtime/test/hosted-runtime-workspace-assistant-phase-delivery.test.ts` | 3 |
| `packages/assistant-runtime/test/hosted-runtime-workspace-assistant-phase-foreground.test.ts` | 60 |
| `packages/assistant-runtime/test/hosted-runtime-workspace-assistant-phase.harness.ts` | 27 |
| `packages/hosted-execution/README.md` | 0 |
| `packages/hosted-execution/src/builders.ts` | 19 |
| `packages/hosted-execution/src/contracts.ts` | 27 |
| `packages/hosted-execution/src/parsers.ts` | 48 |
| `packages/hosted-execution/src/parsers/runtime-control.ts` | 75 |
| `packages/hosted-execution/src/routes.ts` | 2 |
| `packages/hosted-execution/src/runtime-control.ts` | 22 |
| `packages/hosted-execution/test/hosted-execution.test.ts` | 2 |
| `packages/hosted-execution/test/hosted-runtime-control.test.ts` | 57 |
| `packages/hosted-execution/test/parsers.test.ts` | 53 |

The final commit also archives this execution plan and updates its index entry.

## Completion evidence

- All requested local gates passed after the intermediate corrections documented
  above: builds, nine package typecheck/test owners, Web and Cloudflare
  typechecks, focused Web tests, workspace boundaries/cycles, dependency guard,
  JavaScript-source guard, CLI verification, docs drift, and complexity diff
  against `c04ccc04cc`. The final CLI lane passed 348 tests; the full Cloudflare
  Node lane passed 4,619 workspace tests plus 20 container-helper tests (five
  normal skips).
- Full `pnpm --dir apps/cloudflare runner:bundle` passed. Entry: 77,854 bytes
  against 76,589 + 12,000 allowed; static boot closure: 2,011,052 bytes against
  2,047,343 + 96,000 allowed; 22 chunks against 24 allowed. Total bundle:
  12,376,771 bytes. No startup boundary or budget was relaxed. The exact-base
  total-size CI comparison was not available without the prohibited push/PR.
- Static core hash remains
  `76af77f6c1d1efb2f1a0b4e344ed0d8408ca87a4dc236a01c0ebd9b8621feb30`;
  generated route-capability snapshot is
  `603a79aedef59d76214dadbe206613be14157622a5fa9a01fe0bb7ae9e8b64af`.
  The instruction delta reaches direct-conversation prompts in hosted Web/runner
  execution and retained non-hosted direct invocations. Group prompts and
  separate maintenance prompts are unchanged.
- Parent review checked the four-slice diff, remaining call sites, required live
  exceptions, schema zero-diff, generated tooling, and privacy. No forbidden
  cast, sibling-source import, secret, local personal identifier, or guard
  relaxation was introduced. Historical plans were not edited.
- Close this plan with `scripts/finish-task` in the fourth scoped commit. This
  task ends at local commits; no push, PR, publication, or production mutation.
Completed: 2026-11-02
