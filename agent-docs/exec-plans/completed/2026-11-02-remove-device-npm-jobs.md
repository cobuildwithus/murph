# Retire local device tooling, direct providers, npm publishing, and background discovery jobs

Status: completed
Created: 2026-11-02
Updated: 2026-11-02

## Goal and scope

Implement the four owner-approved deletion slices in the assigned isolated worktree, one commit per slice. Preserve hosted device commands, Junction ingestion and provider-labelled reads, runner startup laziness, required CI check names, and every explicitly retained product surface. No pushes, PRs, publishing, production access, migrations, or other-checkout edits.

## Tasks

1. A: Remove local daemon, launcher, HTTP listener, and fixture capture; retain hosted contracts and fixture readers.
2. B: Remove direct WHOOP/Oura/Strava APIs and routes after tracing Junction and read-only iOS callers.
3. C: Capture runner package inventory, replace publish metadata with an explicit bundle closure, and remove npm publishing while retaining CI coverage owners.
4. D: Retire research scout through existing managed automation tombstones; audit the already-retired Personal Patterns machinery and preserve member data.

## Findings and decisions

- Baseline is stacked on 480b53eb1c; worktree started clean.
- Personal Patterns is already documented as retired in the base; verify implementation before deleting anything by name.
- Hosted device mutation services currently reject direct CLI execution in favor of the authenticated root device tool. Preserve that authority boundary and existing CLI paths/flags.
- Web and Worker consume hosted-runtime, service, registry, config, Junction, companion, public-account, source availability, and persistence types from device-syncd. These are retained.
- Completed plans are historical records and remain unchanged.

## Verification

- Owner-authorized coverage repair: 177 recovered declarations; all 129 main runtime declarations (163 executed cases) retained. The amendment below audits 366 removed subjects, including two upstream-only removals, with one-line reasons and per-file counts.

- Baseline pnpm install passed with the existing lockfile.
- Baseline pnpm build and generated artifact verification passed.
- Baseline full runner:bundle passed.
- Final command ledger and remaining verification limits appear below.

## Deployment analysis

No deployment is authorized or performed. The slice-specific and combined rollout order below are requirements for a separately authorized deployment.

### Slice A implementation and verification

Removed daemon binary/listener/launcher, local client transport, continuous worker/scheduler timers, launcher schemas and command registrations, and wearable capture tooling. Kept hosted device command paths/flags, root-tool authority rejection, catalog output, source/account types, finite reconciliation and fixture readers. Shared Web error formatting already lives in errors.ts and remains unchanged.

Passed: pnpm install (baseline and offline refresh); pnpm build; CLI schema/Incur/skill generators; device-syncd typecheck and test (1,596); operator-config typecheck and test (438); CLI focused device/wiring tests (17); assistant-engine CLI-surface/tool-contract tests (44, 38 opt-in skips); assistant-engine and assistant-runtime typechecks; Web and Cloudflare typechecks; workspace boundaries/cycles; deps:guard; no-js; docs:drift. Initial typechecks found stale daemon test references and were corrected. CLI verification passed (329 tests); final checks appear below.

Baseline full runner bundle passed: CLI startup 19,814 bytes, runner static boot 2,017,368 bytes across 22 chunks. Package inventory is retained in ignored task scratch for the publishing-metadata comparison. No hosted provider input claim is made from authored prose size alone.

### Slice B boundaries and rollout

Junction's local import graph from its provider and client contains 35 modules and does not reach the deleted direct transport modules. The client used only the shared API-error formatter; that helper now has its own module. Importer source identities, priorities, mappings, query filters, companion routes, and Fitbit migration remain. No other direct Garmin/Fitbit/Withings/Polar transport was found. No Prisma schema or migration changes are made; provider-generic connection, credential, OAuth-state and audit tables remain.

Read-only native iOS search found no calls to direct WHOOP/Oura/Strava OAuth or webhook paths. Generic Web route files remain registered for Junction; unknown retired provider names fail registry lookup. Native companion callers remain supported. An old native test still mentions the Patterns route already removed on the stacked base; this change does not delete that route.

B deploy order: any. Old runners accept Junction-only snapshots from the new Web. Parent review changed the new runner's provider-config parser: it drops the three retired keys (`oura`, `strava`, `whoop`) when an older Web or an already-created invocation still serializes them, and it still rejects any other unknown provider. `packages/device-syncd/test/config.test.ts` covers both cases. Nothing has to be removed from production configuration first. No direct production connections are claimed from local diagnostics; the owner supplied the all-Junction production inventory. No deployment performed.

B verification: full build and CLI verification passed. Device tests: 1,412 initially passed, two migrated ingress fixtures failed and were corrected; focused rerun passed all 83 ingress tests. Importer typecheck and all 753 tests passed. Runtime focused suite initially passed 667 with nine stale direct fixtures; the corrected suites passed, including all 11 foreground ingestion proofs with explicit Junction source authority. Web focused suites passed after migrating source fixtures; Web/runtime/Cloudflare typechecks passed. Full runner bundle passed with 76 top-level packages captured before C; static boot 2,005,060 bytes across 22 chunks. Its local assembly unexpectedly attempted registry metadata resolution (DNS failure, no download); use a local offline pnpm wrapper for subsequent assembly. No registry mutation or publication occurred.

### Slice C implementation

Removed tag publication workflow, release orchestration, npm trust tooling, public tarball pack/publish helpers, npm notes and CLI changelog. Web's changelog generator does not consume those files. All workspace packages are private; public license/repository metadata remains. `files` lists remain because runner assembly actively consumes them; CLI changelog entry was removed. Replaced the CLI manifest's bundled dependencies with the identical explicit runner closure. Retained artifact secret guard, coverage plan/matrix, and protected `Release checks (ubuntu)` status. The former package-shape verifier is now a runtime artifact verifier, retaining generated artifact and entrypoint checks.

Before/after full runner assembly passed, including offline nested installs: exactly 76 top-level node_modules packages, no additions/removals. No publication or registry mutation. Local npm pack remains part of the authorized runner assembly; it does not publish. Offline wrapper is ignored task scratch; reproducible missing-offline-option friction is logged.

C checks passed: build, offline install and full runner bundle, CLI and Cloudflare typechecks, verify:cli (315 tests), and CI policy tests. Repo tools: 864 passed, 27 failed in unchanged ReviewGPT fixture tests because the machine privacy hook rejects their synthetic non-noreply email; both failing test files are identical to the stacked base and origin/main. No guard was weakened. The obsolete release-only doc exemption test was removed with its implementation.

### Slice D retirement and rollout

Removed scout seed, schedule spread/retry attribution, prompt guidance and availability plumbing, research CLI family and schemas, Exa client/dependency/credential/egress profiles, dedicated diagnostics and benchmark. The seed-only runtime-env requirement abstraction is removed. Generic query/sleep-pattern reads, weekly insight/digest, coaching, journal context, meal closeout, usage optimization, memory and idle maintenance remain.

Personal Patterns was already absent on the stacked base: its exact-ID tombstone remains, as do historical telemetry phase readers and the cycle-health skill's ordinary repeated-pattern reasoning. No feature-specific Prisma model or enum was found for either job; generic automation/vault, runtime, and historical usage data remain. No schema drops or production operations.

Retirement uses the existing immutable-ID set. Maintenance archives active/paused canonical records idempotently. Claimed stale jobs skip before provider work; queued outbound intents fail the existing non-retryable stale-authority gate before delivery. Archived sources disappear from canonical wake projection. Historical runtime/run records may remain as provenance; no active schedule or new work is derived from them. User-authored automations that merely reuse a slug are preserved.

D skew: any deploy order converges. A new runner with an old Web rejects the exact retired ID at cron and outbox entry, and maintenance archives the old canonical records. A new Web with an old runner denies that runner's Exa egress (`authorizeHostedRuntimeProvider` no longer authorizes `exa`). The old scout instructions then hit their hard provenance gate (no retrieved sources means suppress the run and skip the wiki append), so the member sees nothing; the only cost is denied-egress log noise until the runner deploys. Restoring an old runner after this ships has the same suppress-only outcome. No deployment performed.

## Combined rollout requirement

None beyond the repository's normal order (Web, then Cloudflare). Slice B is order-free because of the retired-key drop, and slice D degrades only to suppressed scout runs on old runners. Existing schedules converge through normal maintenance; no production retirement was executed here. The retirement guard does not cancel a provider request or delivery already in flight in an old runner.

## Generated contracts and bundle measurements

Real CLI schema/Incur/skill generators and package builds regenerated derived artifacts. Hosted device paths, flags and authority behavior remain; descriptions now refer to the hosted control plane. Compact CLI surface: 7,029 to 6,889 UTF-8 bytes (minus 140); estimated tokens 2,162 to 2,119 (minus 43). Contract SHA-256 changed from `f260afc132abb05a87aa744426f7bed5bcba175ab441f0199d37472df49eced5` to `d8e528e541225d2dab985b008e1ca43fa0da9f96333f4d8b62ed2b6c56f05f35`.

Removed stable-route scout capability guidance: 1,241 bytes, approximately 310 tokens. These token estimates use tokenx 1.3.0, not a model tokenizer; no claim is made about whole-turn token savings. The static core prompt hash remains `76af77f6c1d1efb2f1a0b4e344ed0d8408ca87a4dc236a01c0ebd9b8621feb30`; production builder and model-behavior tests verify it. Scout seed instructions were also deleted.

C alone preserved all 76 top-level runner dependency package names exactly. D removes Exa from the dependency graph. Final full runner assembly: CLI static startup 19,800 bytes; runner entry 77,854 bytes; static boot 2,004,050 bytes across 22 chunks (budget 24); total 12,224,847 bytes. All local size budgets and bundle parity probes passed. Exact-base hosted CI was not run because this task forbids pushes and PRs.

## Final verification command ledger

Repeated runs are grouped by command and scope; initial failures and their disposition are retained. All commands ran in the assigned checkout. Every pipeline capturing verification output used pipefail. Full root test, coverage and acceptance commands were not run. Logs and before/after inventories are in ignored task scratch.

| Command | Result |
| --- | --- |
| `pnpm install` | Passed before edits, existing lockfile |
| `pnpm install --offline` | Passed after manifest/dependency updates; lockfile synchronized |
| `pnpm build` | Passed baseline, each slice and final; early D stale-source build failures corrected |
| `pnpm --dir packages/cli gen:config-schema` | Passed; real schema, Incur and skill-hash generation; stale research command routing corrected before final generation |
| `pnpm verify:workspace-boundaries` | Final pass; removed an empty contracts import found by the first final run |
| `pnpm verify:workspace-package-cycles` | Passed |
| `pnpm deps:guard` | Passed |
| `pnpm no-js` | Passed |
| `pnpm verify:cli` | Passed A/B 329 tests; C/D 315 tests |
| `pnpm docs:drift` | Passed; C initially found a missing ledger entry, corrected |
| `pnpm complexity:diff` | Passed |
| `pnpm provider-requests:guard` | Passed after removing the complete retired Exa guard owner/catalog entry |
| `pnpm test:repo-tools` | Failed both C and final: 864 passed, 27 known privacy-hook failures, unchanged failing files versus stacked base and origin/main |
| `node --test scripts/pull-request-ci-policy.test.mjs` | Passed 25 tests; protected CI check names retained |
| `pnpm exec vitest run --config scripts/vitest.config.ts --no-coverage scripts/release-verification-lanes.test.ts scripts/check-agent-docs-drift.test.ts` | Final pass, 6 tests; obsolete release exemption test removed with implementation |
| `pnpm exec vitest run --config scripts/vitest.config.ts scripts/check-provider-request-boundaries.test.ts --no-coverage` | Passed 29 tests; retained transport-detection coverage uses Resend instead of retired Exa |
| `pnpm --dir packages/device-syncd typecheck` | Passed, including final simplified Junction factory |
| `pnpm --dir packages/device-syncd test` | Passed A 1,596 and final 1,414; two B ingress fixture failures corrected and focused 83-test rerun passed |
| `pnpm --dir packages/device-syncd exec vitest run test/config.test.ts test/provider-catalog.test.ts --no-coverage` | Passed 9 matching config tests; catalog path did not match a file, full device suite covers catalog |
| `pnpm --dir packages/operator-config typecheck` and `pnpm --dir packages/operator-config test` | Passed; 438 tests |
| `pnpm --dir packages/importers typecheck` and `pnpm --dir packages/importers test` | Passed; 753 tests |
| `pnpm --dir packages/query typecheck` and `pnpm --dir packages/query test` | Passed; 807 tests, 1 opt-in skip |
| `pnpm --dir packages/contracts typecheck` and `pnpm --dir packages/contracts test` | Passed; 403 tests plus artifact checks |
| `pnpm --dir packages/hosted-execution typecheck` and `pnpm --dir packages/hosted-execution test` | Passed; 889 tests, 2 skips |
| `pnpm --dir packages/runtime-state typecheck` and `pnpm --dir packages/runtime-state test` | Typecheck passed; full suite initially 295 passed, 4 retired telemetry expectation failures, 19 skips; corrected focused timing rerun passed 66 with 18 skips |
| `pnpm --dir packages/runtime-state exec vitest run test/cli-timing.test.ts --no-coverage` | Passed after removing scout-only telemetry assertions |
| `pnpm --dir packages/cli typecheck` | Passed |
| `pnpm --dir packages/cli exec vitest run test/cli-timing.test.ts test/cli-typed-agent-inputs-schema.test.ts --no-coverage` | Passed 24 tests; A focused device/wiring run also passed 17 |
| `pnpm --dir packages/assistant-engine typecheck` | Passed |
| `pnpm --dir packages/assistant-runtime typecheck` | Passed |
| `pnpm --dir packages/hosted-local-harness typecheck` | Passed |
| `pnpm --dir packages/hosted-local-harness exec vitest run test/dev-hosted-local/environment.test.ts --no-coverage` | Passed 98 tests |
| `pnpm --dir packages/exercise-library typecheck` and `pnpm --dir packages/exercise-library test` | Passed; 6 tests |
| `pnpm --dir packages/gateway-core typecheck` and `pnpm --dir packages/gateway-core test` | Passed; 15 tests |
| `pnpm --dir packages/health-commons typecheck` and `pnpm --dir packages/health-commons test` | Passed; 144 tests |
| `pnpm --dir apps/web typecheck` | Passed, including final ops allowlist correction |
| `pnpm --dir apps/cloudflare typecheck` | Passed |
| `pnpm --dir apps/cloudflare test:node` | Initial full workspace run: 4,608 passed, 3 stale profile/direct-provider expectations failed, 5 skips. Corrected all three, then targeted affected suites passed 366 tests; helper completed separately below |
| `pnpm --dir apps/cloudflare test:node:containers-helper` | Passed 20 tests |
| `pnpm --dir apps/cloudflare runner:bundle` | Full assembly passed baseline, B, C before/after, D and final; later runs use an ignored offline pnpm wrapper for nested installs |
| `pnpm test:assistant:live -- --test 'preserves provider-labelled sleep reads after scout retirement'` | Passed one real Codex journey, 633 unselected tests skipped; provider-labelled Oura sleep read preserved, no scout prompt/tool, no unintended writes or sends; reviewed Ready |
| `git diff --check` | Passed |

Focused engine commands used `pnpm --dir packages/assistant-engine exec vitest run <files> --no-coverage` with these explicit scopes:

- `test/managed-automations-core.test.ts`, `test/managed-automations.test.ts`, `test/assistant-cron-runtime.test.ts`, `test/assistant-cron-freshness.test.ts`, `test/system-prompt.dynamic-context.test.ts`, `test/assistant-codex-turn-planning.test.ts`, `test/assistant-cli-surface-bootstrap.test.ts`, `test/assistant-tool-failure-diagnostics.test.ts`, `test/cli-timing-profile.test.ts`, `test/knowledge-cli-guidance.test.ts`, `test/assistant-cli-access.test.ts`, `test/assistant-ask.test.ts`: initial 751 passed, 28 stale seed-count assertions failed; corrected core proof rerun passed. Restored mixed-feature coverage remains present.
- `test/managed-automations.test.ts`, `test/model-behavior.test.ts`, `test/assistant-automation-prompt-builder.test.ts`, `test/assistant-codex-scripted-runtime.test.ts`, `test/assistant-cli-surface-bootstrap.test.ts`: final 344 passed, 6 opt-in skips. An initially included `test/assistant-codex-tool-contract.test.ts` path matched no file; the correct input-contract path was then run explicitly.
- `test/assistant-codex-tool-input-contract.test.ts`: passed 20, 38 opt-in skips; A/B paired surface/input-contract runs passed 44.
- `test/assistant-cron-runtime.test.ts test/assistant-outbox-runtime.test.ts -t 'retired|onboarding-blocked'`: final 13 passed, 436 unselected; exact-ID retirement and retained insight/coach onboarding behavior proven. Earlier focused outbox retirement run passed 3.

Focused runtime commands used `pnpm --dir packages/assistant-runtime exec vitest run <files> --no-coverage`:

- `test/hosted-runtime-environment.test.ts test/hosted-runtime-codex-config.test.ts`: 87 passed and one stale include-only assertion failed; corrected config rerun passed 48, 6 skips.
- `test/hosted-device-sync-runtime.test.ts test/hosted-runtime-config.test.ts test/hosted-runtime-device-sync-provider-configs.test.ts test/hosted-runtime-maintenance.test.ts test/hosted-runtime-parsers-coverage.test.ts test/hosted-runtime-workspace-assistant-phase-delivery.test.ts test/hosted-runtime-workspace-assistant-phase-device-sync.test.ts test/hosted-runtime-workspace-assistant-phase-foreground.test.ts test/hosted-runtime-workspace-assistant-phase-scheduling.test.ts test/hosted-runtime-workspace-runner.test.ts`: final 636 passed. Initial B runs exposed nine stale direct-provider fixtures; migrated to explicit Junction source authority before final pass.

Final consolidated Web command: `pnpm exec vitest run --config apps/web/vitest.config.ts apps/web/test/device-connect-intents.test.ts apps/web/test/hosted-connect-start.test.ts apps/web/test/connect-source-routes.test.tsx apps/web/test/device-sync-providers.test.ts apps/web/test/whoop-connect-capacity.test.ts apps/web/test/device-sync-settings-surface.test.ts apps/web/test/agent-session-service.test.ts apps/web/test/hosted-automation-loss-alert-monitor.test.ts --no-coverage` passed all 72 tests across 8 files. Earlier focused Web commands used the same configuration for device connect, source routes, provider assembly, historical capacity, settings/session surfaces and ops monitoring. Initial runs exposed stale direct-provider fixtures; corrected suites passed. Final monitoring command `apps/web/test/hosted-automation-loss-alert-monitor.test.ts` passed 10, including retained weekly insight/digest query entries. The PostgreSQL-backed monitoring suite skipped 16 cases because its database opt-in was not configured; no live database verification is claimed.

Focused Cloudflare command used `pnpm exec vitest run --config apps/cloudflare/vitest.node.workspace.ts <files> --no-coverage` with `apps/cloudflare/test/runner-env.test.ts`, `deploy-automation.test.ts`, `hosted-local-e2e-support.test.ts`, `runner-egress-intercept.test.ts`, `usage-record-port.test.ts`, `runner-bundle-cli-bundle.test.ts`, and `hosted-runner-static-secret-invariant.test.ts`: all 366 passed after full-run failures were corrected. No full-suite second pass is claimed.

## Retained items and limits

All explicitly retained product capabilities remain. Generic Prisma device connection/source/token-audit/OAuth-session storage, automation history, historical usage phases and wiki records remain; no drop migrations. Junction source-labelled normalizers and reads, shared availability types, fixture files, Fitbit migration, and companion endpoints remain. Personal Patterns was already retired on the base, so its tombstone and ordinary member-facing pattern reasoning remain. Historical completed plans and public changelog entries remain immutable evidence.

The protected `Release checks (ubuntu)` name, package coverage plan/matrix, runtime artifact secret guard and runtime-consumed `files` lists remain despite release-era names. Public repository and license remain. No npm publishing/deprecation/unpublishing, push, PR, production access or deployment occurred. One early full bundle unexpectedly attempted optional sharp registry metadata resolution and received DNS failure; subsequent assemblies forced offline nested installs. This was an unintended registry access attempt, not a successful download or mutation.

Open verification limits: 27 known machine-hook failures; opt-in PostgreSQL and other credentialed/live cases not run; no remote exact-head CI or ReviewGPT because pushing/PR work is prohibited. Production retirement and rollout drains remain operational work. The final slice also contains B test-fixture/factory simplification cleanup found by integration verification.
Completed: 2026-11-02

## Coverage repair audit on merged head d5247c23be

Owner-authorized amendment to this completed plan. The original verification history above is preserved; the results below supersede its incomplete coverage claims. No production source changes are part of this repair.

Compared every deleted test file and every test file with more than 150 deleted lines against both `480b53eb1c` and `c04ccc04cc`; also inspected all changed operator-config tests and the assistant-phase device-sync suite. Counts below count test declarations, with a parameterized declaration counted once. The restored main runtime file contains 129 declarations / 163 executed cases; 128 declarations were missing from the merged head. No case from that file is deleted.

| Original file | 480b / c04 / initial head | Restored here | Changed retained cases | Deleted subjects | Final declarations |
| --- | ---: | ---: | ---: | ---: | ---: |
| `apps/cloudflare/test/runner-egress-exa-research-question.test.ts` | 4 / 4 / 0 | 0 | 0 | 4 | 0 |
| `apps/cloudflare/test/runner-egress-intercept.test.ts` | 153 / 153 / 143 | 0 | 1 | 10 | 143 |
| `apps/web/test/device-sync-prepared-webhook-authority-postgres.test.ts` | 16 / 16 / 15 | 1 | 1 | 0 | 16 |
| `packages/assistant-engine/test/assistant-automation-tail-branches.test.ts` | 2 / 0 / 0 | 0 | 0 | 2 | 0 |
| `packages/assistant-engine/test/assistant-codex-real-e2e.test.ts` | 391 / 392 / 386 | 5 | 19 | 1 | 391 |
| `packages/assistant-engine/test/assistant-codex-scripted-runtime.test.ts` | 103 / 103 / 102 | 0 | 0 | 1 | 102 |
| `packages/assistant-engine/test/assistant-codex-turn-planning.test.ts` | 94 / 94 / 93 | 0 | 0 | 1 | 93 |
| `packages/assistant-engine/test/cli-timing-profile.test.ts` | 20 / 20 / 16 | 0 | 1 | 4 | 16 |
| `packages/assistant-engine/test/managed-automations.test.ts` | 66 / 66 / 64 | 0 | 24 | 2 | 64 |
| `packages/assistant-runtime/test/hosted-device-sync-runtime.test.ts` | 128 / 129 / 1 | 128 | 10 | 0 | 129 |
| `packages/cli/test/device-cli.test.ts` | 12 / 12 / 8 | 1 | 3 | 3 | 9 |
| `packages/cli/test/device-daemon.test.ts` | 13 / 13 / 0 | 0 | 0 | 13 | 0 |
| `packages/cli/test/device-sync-client.test.ts` | 11 / 11 / 0 | 0 | 0 | 11 | 0 |
| `packages/cli/test/release-script-coverage-audit.test.ts` | 39 / 39 / 31 | 0 | 1 | 8 | 31 |
| `packages/cli/test/release-workflow-guards.test.ts` | 7 / 7 / 1 | 0 | 1 | 6 | 1 |
| `packages/cli/test/research-question.test.ts` | 8 / 8 / 0 | 0 | 0 | 8 | 0 |
| `packages/cli/test/research-scout-batch.test.ts` | 12 / 12 / 0 | 0 | 0 | 12 | 0 |
| `packages/cli/test/research-scout.test.ts` | 26 / 26 / 0 | 0 | 0 | 26 | 0 |
| `packages/contracts/test/exa-research-question.test.ts` | 6 / 6 / 0 | 0 | 0 | 6 | 0 |
| `packages/contracts/test/exa-research-scout.test.ts` | 10 / 10 / 0 | 0 | 0 | 10 | 0 |
| `packages/device-syncd/test/bin.test.ts` | 8 / 8 / 0 | 0 | 0 | 8 | 0 |
| `packages/device-syncd/test/client.test.ts` | 12 / 12 / 0 | 0 | 0 | 12 | 0 |
| `packages/device-syncd/test/config.test.ts` | 42 / 42 / 10 | 13 | 13 | 21 | 23 |
| `packages/device-syncd/test/connect-targets.test.ts` | 8 / 8 / 3 | 5 | 5 | 1 | 8 |
| `packages/device-syncd/test/http-control-helpers.test.ts` | 8 / 8 / 0 | 3 | 0 | 5 | 0 |
| `packages/device-syncd/test/http-startup.test.ts` | 3 / 3 / 0 | 0 | 0 | 3 | 0 |
| `packages/device-syncd/test/http.test.ts` | 35 / 35 / 0 | 2 | 0 | 33 | 0 |
| `packages/device-syncd/test/oura-provider.test.ts` | 36 / 36 / 0 | 0 | 0 | 36 | 0 |
| `packages/device-syncd/test/oura-webhooks.test.ts` | 8 / 8 / 0 | 0 | 0 | 8 | 0 |
| `packages/device-syncd/test/provider-descriptor-integration.test.ts` | 7 / 7 / 2 | 1 | 1 | 4 | 3 |
| `packages/device-syncd/test/provider-manifests.test.ts` | 26 / 26 / 14 | 12 | 12 | 0 | 26 |
| `packages/device-syncd/test/service.test.ts` | 164 / 165 / 163 | 0 | 2 | 2 | 163 |
| `packages/device-syncd/test/shared-oauth.test.ts` | 13 / 13 / 0 | 1 | 0 | 12 | 0 |
| `packages/device-syncd/test/strava-provider.test.ts` | 24 / 24 / 0 | 0 | 0 | 24 | 0 |
| `packages/device-syncd/test/strava-webhooks.test.ts` | 5 / 5 / 0 | 0 | 0 | 5 | 0 |
| `packages/device-syncd/test/whoop-provider.test.ts` | 31 / 31 / 0 | 0 | 0 | 31 | 0 |
| `packages/operator-config/test/device-daemon-runtime.test.ts` | 12 / 12 / 0 | 1 | 0 | 11 | 0 |
| `packages/operator-config/test/http-linq-device-runtime.test.ts` | 74 / 74 / 71 | 0 | 0 | 3 | 71 |
| `packages/runtime-state/test/cli-timing.test.ts` | 64 / 64 / 59 | 0 | 4 | 5 | 59 |
| `scripts/release-verification-lanes.test.ts` | 8 / 8 / 2 | 0 | 0 | 6 | 2 |
| `scripts/wearable-fixture-capture.test.ts` | 6 / 6 / 0 | 0 | 0 | 6 | 0 |
| `packages/device-syncd/test/http-redirects.test.ts` | 4 / 4 / 0 | 4 | 4 | 0 | 4 |
| `packages/operator-config/test/http-linq-device-runtime-branches.test.ts` | 2 / 2 / 1 | 0 | 0 | 1 | 1 |
| `packages/operator-config/test/runtime-helpers.test.ts` | 29 / 29 / 28 | 0 | 0 | 1 | 28 |
| `packages/assistant-runtime/test/hosted-runtime-workspace-assistant-phase-device-sync.test.ts` | 47 / 47 / 47 | 0 | 18 | 0 | 47 |

Total recovered declarations from the audited files: **177** (including seven relocated/mixed cases). Deleted-subject decisions: **366**, including two upstream-only removals. “Changed retained cases” compares against c04 and includes changes already present in the deletion head; it is not additive with restored counts. Relocated declarations are counted at their original file, so the final-file column excludes their new owner.

Audit findings:

- `client.ts` now contains only shared types. Web imports those types; its typecheck verifies the retained contract. All twelve deleted client cases exercised removed runtime HTTP methods.
- The old `http.ts` server was used by the local daemon. Shared public-error formatting and callback redirect logic remain in separate modules: four error cases, four redirect cases and one loopback-address case were restored against those live owners.
- All ten deleted runner-egress-intercept declarations concern Exa. The remaining 143 declarations retain the other provider/egress boundaries.
- Hosted CLI provider listing, connect, account list/show/disconnect/reconcile remain exercised through the hosted command-coverage test, now using Junction accounts and an Oura-labelled connect target.
- The merged foreground fixture kept `now` and history start/end, but newer historical assertions still expected direct WHOOP metrics/ingest identity. Those now assert Junction sleep metrics and ingest identity; fixture dates/windows derive from the historical input. Publication, acknowledgement, immutable cold objects and recovery assertions remain.
- The PostgreSQL epoch proof now uses a synthetic registered deauthorization provider. All reconnect, credential-preservation, duplicate, trace and no-dirty/no-wake assertions remain; the opt-in database lane is not claimed as executed.
- The native optional-ledger quiet-run case and four generic diagnostics cases are restored; the live Codex lane remains opt-in. Sleep-pattern provider-labelled reads remain covered.

### Every deleted or migrated declaration

### `apps/cloudflare/test/runner-egress-exa-research-question.test.ts`

- Deleted `validates and canonicalizes compact focus before injecting the Worker secret` — Exercises the removed Exa/scout feature or its dedicated telemetry; retained generic behavior remains covered.
- Deleted `rejects injected arbitrary question prose before upstream fetch: %s` — Exercises the removed Exa/scout feature or its dedicated telemetry; retained generic behavior remains covered.
- Deleted `rejects private-shaped values in every focused query field before upstream fetch` — Exercises the removed Exa/scout feature or its dedicated telemetry; retained generic behavior remains covered.
- Deleted `rejects private-shaped values in every legacy batch query field before upstream fetch` — Exercises the removed Exa/scout feature or its dedicated telemetry; retained generic behavior remains covered.

### `apps/cloudflare/test/runner-egress-intercept.test.ts`

- Deleted `injects Exa credentials only for allowed research-scout Search API POST requests with a write fence` — Exercises the removed Exa/scout feature or its dedicated telemetry; retained generic behavior remains covered.
- Deleted `canonicalizes Exa research-scout bodies before forwarding credentials upstream` — Exercises the removed Exa/scout feature or its dedicated telemetry; retained generic behavior remains covered.
- Deleted `forwards the caller's Exa research-scout publication window when it fits the 60-day cap` — Exercises the removed Exa/scout feature or its dedicated telemetry; retained generic behavior remains covered.
- Deleted `authorizes Exa egress from a child process via provider credential with no caller headers` — Exercises the removed Exa/scout feature or its dedicated telemetry; retained generic behavior remains covered.
- Deleted `rejects Exa research-scout requests whose publication window ends in the future beyond clock skew` — Exercises the removed Exa/scout feature or its dedicated telemetry; retained generic behavior remains covered.
- Deleted `injects Exa credentials from a provider egress token without authority headers` — Exercises the removed Exa/scout feature or its dedicated telemetry; retained generic behavior remains covered.
- Deleted `rejects Exa credential injection for unsafe research-scout body: $label` — Exercises the removed Exa/scout feature or its dedicated telemetry; retained generic behavior remains covered.
- Deleted `rejects Exa credential injection when URL query or hash could carry private data` — Exercises the removed Exa/scout feature or its dedicated telemetry; retained generic behavior remains covered.
- Deleted `fails closed when the Exa Worker secret is missing or still a placeholder` — Exercises the removed Exa/scout feature or its dedicated telemetry; retained generic behavior remains covered.
- Deleted `rejects Exa provider egress outside POST /search at the canonical origin` — Exercises the removed Exa/scout feature or its dedicated telemetry; retained generic behavior remains covered.

### `apps/web/test/device-sync-prepared-webhook-authority-postgres.test.ts`

- `terminally settles a signed pre-reconnect Strava deauthorization against the replacement connection` → `terminally settles a prepared pre-reconnect synthetic deauthorization against the replacement connection`. Retained generic/live assertions migrated; removed feature-only portions omitted.

### `packages/assistant-engine/test/assistant-automation-tail-branches.test.ts`

- Deleted `covers runtime-lock held and propagation branches through mocked directory locks` — Removed upstream before c04: the local automation run-lock acquisition implementation no longer exists; retained inspection/cleanup helpers remain covered.
- Deleted `preserves same-process runtime-lock messaging with current metadata` — Removed upstream before c04: the local automation run-lock acquisition implementation no longer exists; retained inspection/cleanup helpers remain covered.

### `packages/assistant-engine/test/assistant-codex-real-e2e.test.ts`

- `answers duration and usable nights from one native sleep-pattern read without other reads or effects` → `preserves provider-labelled sleep reads after scout retirement`. Retained generic/live assertions migrated; removed feature-only portions omitted.
- Deleted `saves research with compressed ledger sources and suppresses repeated research` — Exercises the removed Exa/scout feature or its dedicated telemetry; retained generic behavior remains covered.

### `packages/assistant-engine/test/assistant-codex-scripted-runtime.test.ts`

- Deleted `carries generalized Exa evidence through progress, source mapping, and empty recovery` — Exercises the removed Exa/scout feature or its dedicated telemetry; retained generic behavior remains covered.

### `packages/assistant-engine/test/assistant-codex-turn-planning.test.ts`

- Deleted `exposes grounded research guidance only when Exa is configured across conversation routes` — Exercises the removed Exa/scout feature or its dedicated telemetry; retained generic behavior remains covered.

### `packages/assistant-engine/test/cli-timing-profile.test.ts`

- Deleted `research source codes survive profile and hosted readback without changing native accounting` — Exercises the removed Exa/scout feature or its dedicated telemetry; retained generic behavior remains covered.
- Deleted `actual pre-research hosted reader loses only specificity, not counts or tokens` — Exercises the removed Exa/scout feature or its dedicated telemetry; retained generic behavior remains covered.
- Deleted `research batch rejection category survives profile and hosted readback; native accounting is unchanged` — Exercises the removed Exa/scout feature or its dedicated telemetry; retained generic behavior remains covered.
- Deleted `actual pre-rejection hosted reader drops only the category` — Exercises the removed Exa/scout feature or its dedicated telemetry; retained generic behavior remains covered.

### `packages/assistant-engine/test/managed-automations.test.ts`

- `updates existing research-oriented automations without rewriting their cadence` → `preserves weekly insight cadence and archives the retired scout`. Retained generic/live assertions migrated; removed feature-only portions omitted.
- Deleted `keeps the managed weekly health research scout seed as the baseline Wednesday evening recurrence` — Exercises the removed Exa/scout feature or its dedicated telemetry; retained generic behavior remains covered.
- Deleted `skips the research scout seed when hosted runtime env lacks Exa` — Exercises the removed Exa/scout feature or its dedicated telemetry; retained generic behavior remains covered.

### `packages/assistant-runtime/test/hosted-device-sync-runtime.test.ts`

- `sync hydrates a fresh WHOOP OAuth runtime snapshot before running device jobs` → `sync hydrates a fresh synthetic OAuth runtime snapshot before running device jobs`. Retained generic/live assertions migrated; removed feature-only portions omitted.
- `generic Strava payloads honor local retry timing and survive a cold restore` → `generic synthetic payloads honor local retry timing and survive a cold restore`. Retained generic/live assertions migrated; removed feature-only portions omitted.
- `rebuilds a real Strava scheduler retry from manifest-shaped durable fields` → `rebuilds a real Junction scheduler retry from manifest-shaped durable fields`. Retained generic/live assertions migrated; removed feature-only portions omitted.

### `packages/cli/test/device-cli.test.ts`

- `device daemon commands stay in the generated CLI schema` → `hosted device connect retains its generated return target option schema`. Retained generic/live assertions migrated; removed feature-only portions omitted.
- Deleted `device provider and account list do not start the managed daemon when local credentials are absent` — Exercises the removed local daemon, launcher, or local HTTP client implementation.
- Deleted `device provider and account list tolerate partial local provider credentials` — Exercises the removed local daemon, launcher, or local HTTP client implementation.
- Deleted `device provider and account operations reuse a healthy managed daemon without an explicit base URL` — Exercises the removed local daemon, launcher, or local HTTP client implementation.

### `packages/cli/test/device-daemon.test.ts`

- Deleted `startManagedDeviceSyncDaemon keeps launcher state non-secret and persists the managed bearer separately` — Exercises the removed local daemon, launcher, or local HTTP client implementation.
- Deleted `resolveExistingManagedDeviceSyncControlPlane reuses a healthy managed daemon without provider env` — Exercises the removed local daemon, launcher, or local HTTP client implementation.
- Deleted `startManagedDeviceSyncDaemon fails closed when launcher state is missing but a daemon is reachable` — Exercises the removed local daemon, launcher, or local HTTP client implementation.
- Deleted `startManagedDeviceSyncDaemon fails closed when a daemon is reachable but the managed token was wiped` — Exercises the removed local daemon, launcher, or local HTTP client implementation.
- Deleted `startManagedDeviceSyncDaemon does not send managed tokens to reachable listeners after launcher state is missing` — Exercises the removed local daemon, launcher, or local HTTP client implementation.
- Deleted `startManagedDeviceSyncDaemon maps address-in-use startup logs to a daemon conflict` — Exercises the removed local daemon, launcher, or local HTTP client implementation.
- Deleted `startManagedDeviceSyncDaemon surfaces missing provider credentials with a dedicated error code` — Exercises the removed local daemon, launcher, or local HTTP client implementation.
- Deleted `startManagedDeviceSyncDaemon redacts secret-bearing startup log snippets on failure` — Exercises the removed local daemon, launcher, or local HTTP client implementation.
- Deleted `startManagedDeviceSyncDaemon preserves a distinct DEVICE_SYNC_SECRET when DEVICE_SYNC_CONTROL_TOKEN is also configured` — Exercises the removed local daemon, launcher, or local HTTP client implementation.
- Deleted `ensureManagedDeviceSyncControlPlane honors explicit unmanaged targets without a vault` — Exercises the removed local daemon, launcher, or local HTTP client implementation.
- Deleted `ensureManagedDeviceSyncControlPlane rejects non-loopback explicit control-plane targets when a bearer token is configured` — Exercises the removed local daemon, launcher, or local HTTP client implementation.
- Deleted `getManagedDeviceSyncDaemonStatus reports stale launcher state clearly` — Exercises the removed local daemon, launcher, or local HTTP client implementation.
- Deleted `stopManagedDeviceSyncDaemon stops the managed process and removes launcher state` — Exercises the removed local daemon, launcher, or local HTTP client implementation.

### `packages/cli/test/device-sync-client.test.ts`

- Deleted `createDeviceSyncClient sends bearer auth to control-plane routes` — Exercises the removed local daemon, launcher, or local HTTP client implementation.
- Deleted `createDeviceSyncClient forwards owner and source provider for connection starts` — Exercises the removed local daemon, launcher, or local HTTP client implementation.
- Deleted `createDeviceSyncClient explains missing control-plane auth` — Exercises the removed local daemon, launcher, or local HTTP client implementation.
- Deleted `createDeviceSyncClient surfaces invalid JSON responses from the daemon` — Exercises the removed local daemon, launcher, or local HTTP client implementation.
- Deleted `createDeviceSyncClient validates connection authorization URLs before opening a browser` — Exercises the removed local daemon, launcher, or local HTTP client implementation.
- Deleted `createDeviceSyncClient bounds unavailable requests without leaking transport details` — Exercises the removed local daemon, launcher, or local HTTP client implementation.
- Deleted `createDeviceSyncClient makes ambiguous POST transport recovery explicit` — Exercises the removed local daemon, launcher, or local HTTP client implementation.
- Deleted `createDeviceSyncClient keeps ambiguous POST failures non-retryable` — Exercises the removed local daemon, launcher, or local HTTP client implementation.
- Deleted `createDeviceSyncClient classifies response body failures without echoing causes` — Exercises the removed local daemon, launcher, or local HTTP client implementation.
- Deleted `createDeviceSyncClient keeps malformed connection responses fieldless` — Exercises the removed local daemon, launcher, or local HTTP client implementation.
- Deleted `createDeviceSyncClient rejects non-loopback base URLs when a control-plane bearer is configured` — Exercises the removed local daemon, launcher, or local HTTP client implementation.

### `packages/cli/test/release-script-coverage-audit.test.ts`

- Deleted `runs release checks directly instead of through an env-overridable shell command` — Exercises removed npm publication, tarball, or release orchestration; retained coverage-matrix and artifact guards remain covered.
- Deleted `propagates CLI package coverage failures instead of forcing the release lane green` — Exercises removed npm publication, tarball, or release orchestration; retained coverage-matrix and artifact guards remain covered.
- Deleted `verifies the live release manifest and publish set` — Exercises removed npm publication, tarball, or release orchestration; retained coverage-matrix and artifact guards remain covered.
- Deleted `keeps release script help usage stable for both --help and -h` — Exercises removed npm publication, tarball, or release orchestration; retained coverage-matrix and artifact guards remain covered.
- Deleted `rejects unknown release-script arguments with the stable error text` — Exercises removed npm publication, tarball, or release orchestration; retained coverage-matrix and artifact guards remain covered.
- Deleted `preserves current value-token consumption and missing-value validation branches` — Exercises removed npm publication, tarball, or release orchestration; retained coverage-matrix and artifact guards remain covered.
- Deleted `keeps packages/cli publish-ready as @murphai/murph without package-local release scripts` — Exercises removed npm publication, tarball, or release orchestration; retained coverage-matrix and artifact guards remain covered.
- Deleted `regenerates and verifies the assistant CLI surface contract in the real release tarball` — Exercises removed npm publication, tarball, or release orchestration; retained coverage-matrix and artifact guards remain covered.

### `packages/cli/test/release-workflow-guards.test.ts`

- `derives a complete non-empty release matrix from package coverage owners` → `derives a complete non-empty coverage matrix from package coverage owners`. Retained generic/live assertions migrated; removed feature-only portions omitted.
- Deleted `validates the git tag against the manifest-defined publish set` — Exercises removed npm publication, tarball, or release orchestration; retained coverage-matrix and artifact guards remain covered.
- Deleted `fans the release gate out and packs all publishable tarballs after every shard passes` — Exercises removed npm publication, tarball, or release orchestration; retained coverage-matrix and artifact guards remain covered.
- Deleted `assembles the release CLI surface from the built workspace CLI after compilation` — Exercises removed npm publication, tarball, or release orchestration; retained coverage-matrix and artifact guards remain covered.
- Deleted `keeps the artifact guard ahead of every permanent publication boundary` — Exercises removed npm publication, tarball, or release orchestration; retained coverage-matrix and artifact guards remain covered.
- Deleted `keeps prerelease routing, primary-package release notes, and ordered publish helper usage` — Exercises removed npm publication, tarball, or release orchestration; retained coverage-matrix and artifact guards remain covered.
- Deleted `pins every action ref used by the npm release path` — Exercises removed npm publication, tarball, or release orchestration; retained coverage-matrix and artifact guards remain covered.

### `packages/cli/test/research-question.test.ts`

- Deleted `accepts focused compact categories through the existing scout input parser` — Exercises the removed Exa/scout feature or its dedicated telemetry; retained generic behavior remains covered.
- Deleted `documents focused single-scout input and routes broad discovery to batch` — Exercises the removed Exa/scout feature or its dedicated telemetry; retained generic behavior remains covered.
- Deleted `keeps the static command manifest aligned with the focused-only scout` — Exercises the removed Exa/scout feature or its dedicated telemetry; retained generic behavior remains covered.
- Deleted `gives actionable guidance for arbitrary question input` — Exercises the removed Exa/scout feature or its dedicated telemetry; retained generic behavior remains covered.
- Deleted `uses the existing Exa request path and reports the focused profile kind` — Exercises the removed Exa/scout feature or its dedicated telemetry; retained generic behavior remains covered.
- Deleted `rejects arbitrary question prose before any Exa request: %s` — Exercises the removed Exa/scout feature or its dedicated telemetry; retained generic behavior remains covered.
- Deleted `rejects private-shaped values in every focused field before any Exa request` — Exercises the removed Exa/scout feature or its dedicated telemetry; retained generic behavior remains covered.
- Deleted `rejects mode-less values in every field before any Exa request` — Exercises the removed Exa/scout feature or its dedicated telemetry; retained generic behavior remains covered.

### `packages/cli/test/research-scout-batch.test.ts`

- Deleted `admits at most two requests, refills slots, and preserves ordered full envelopes` — Exercises the removed Exa/scout feature or its dedicated telemetry; retained generic behavior remains covered.
- Deleted `keeps a slot until its response body is consumed` — Exercises the removed Exa/scout feature or its dedicated telemetry; retained generic behavior remains covered.
- Deleted `keeps the one-lane recipe and result envelope unchanged` — Exercises the removed Exa/scout feature or its dedicated telemetry; retained generic behavior remains covered.
- Deleted `validates the entire batch before any egress: $name` — Exercises the removed Exa/scout feature or its dedicated telemetry; retained generic behavior remains covered.
- Deleted `makes no request for a pre-aborted batch` — Exercises the removed Exa/scout feature or its dedicated telemetry; retained generic behavior remains covered.
- Deleted `preserves lane $index failure, cancels and joins sibling bodies, and closes admission` — Exercises the removed Exa/scout feature or its dedicated telemetry; retained generic behavior remains covered.
- Deleted `preserves a transport failure while awaiting a delayed sibling rejection` — Exercises the removed Exa/scout feature or its dedicated telemetry; retained generic behavior remains covered.
- Deleted `preserves caller abort during %s without starting queued lanes` — Exercises the removed Exa/scout feature or its dedicated telemetry; retained generic behavior remains covered.
- Deleted `preserves the per-request timeout during %s and joins cancellation` — Exercises the removed Exa/scout feature or its dedicated telemetry; retained generic behavior remains covered.
- Deleted `does not return success or admit more work when an aborted transport completes anyway` — Exercises the removed Exa/scout feature or its dedicated telemetry; retained generic behavior remains covered.
- Deleted `composes the registered CLI parser, date normalization, client, and ordered JSON output` — Exercises the removed Exa/scout feature or its dedicated telemetry; retained generic behavior remains covered.
- Deleted `uses the real client with empty injected env, zero fetches and unchanged original rejection` — Exercises the removed Exa/scout feature or its dedicated telemetry; retained generic behavior remains covered.

### `packages/cli/test/research-scout.test.ts`

- Deleted `accepts raw profile JSON and an exact profile wrapper for CLI input` — Exercises the removed Exa/scout feature or its dedicated telemetry; retained generic behavior remains covered.
- Deleted `rejects generic tags and full request-shaped input with actionable CLI guidance` — Exercises the removed Exa/scout feature or its dedicated telemetry; retained generic behavior remains covered.
- Deleted `accepts compact research scout batch lane payloads` — Exercises the removed Exa/scout feature or its dedicated telemetry; retained generic behavior remains covered.
- Deleted `rejects full request-shaped batch input with actionable CLI guidance` — Exercises the removed Exa/scout feature or its dedicated telemetry; retained generic behavior remains covered.
- Deleted `attaches only a private finite first-rejection category to the unchanged batch error` — Exercises the removed Exa/scout feature or its dedicated telemetry; retained generic behavior remains covered.
- Deleted `normalizes date-only research scout bounds before provider work` — Exercises the removed Exa/scout feature or its dedicated telemetry; retained generic behavior remains covered.
- Deleted `emits a discoverable payload schema for the research scout input body` — Exercises the removed Exa/scout feature or its dedicated telemetry; retained generic behavior remains covered.
- Deleted `emits a discoverable payload schema for research scout batch lanes` — Exercises the removed Exa/scout feature or its dedicated telemetry; retained generic behavior remains covered.
- Deleted `requires EXA_API_KEY before making an external request` — Exercises the removed Exa/scout feature or its dedicated telemetry; retained generic behavior remains covered.
- Deleted `requires EXA_API_KEY before making batch external requests` — Exercises the removed Exa/scout feature or its dedicated telemetry; retained generic behavior remains covered.
- Deleted `posts one deep-reasoning research-paper search with a finite focused profile` — Exercises the removed Exa/scout feature or its dedicated telemetry; retained generic behavior remains covered.
- Deleted `cancels rejected Exa bodies without exposing provider text` — Exercises the removed Exa/scout feature or its dedicated telemetry; retained generic behavior remains covered.
- Deleted `composes caller cancellation without retrying or exposing the abort reason` — Exercises the removed Exa/scout feature or its dedicated telemetry; retained generic behavior remains covered.
- Deleted `returns redacted structured HTTP failures with retry guidance` — Exercises the removed Exa/scout feature or its dedicated telemetry; retained generic behavior remains covered.
- Deleted `projects retry guidance without echoing a rejected provider body` — Exercises the removed Exa/scout feature or its dedicated telemetry; retained generic behavior remains covered.
- Deleted `classifies Exa authentication, timeout, and malformed success failures` — Exercises the removed Exa/scout feature or its dedicated telemetry; retained generic behavior remains covered.
- Deleted `keeps 2xx response-body transport failures retryable and private` — Exercises the removed Exa/scout feature or its dedicated telemetry; retained generic behavior remains covered.
- Deleted `preserves caller-abort and timeout priority while reading a 2xx body` — Exercises the removed Exa/scout feature or its dedicated telemetry; retained generic behavior remains covered.
- Deleted `posts one bounded research-paper search for each batch lane` — Exercises the removed Exa/scout feature or its dedicated telemetry; retained generic behavior remains covered.
- Deleted `runs one schema-valid managed batch lane through the CLI parser and client` — Exercises the removed Exa/scout feature or its dedicated telemetry; retained generic behavior remains covered.
- Deleted `rejects unsupported batch lane concepts before Exa fetches` — Exercises the removed Exa/scout feature or its dedicated telemetry; retained generic behavior remains covered.
- Deleted `rejects unsafe raw profile tags before Exa fetches: $field` — Exercises the removed Exa/scout feature or its dedicated telemetry; retained generic behavior remains covered.
- Deleted `allows exact finite public concepts` — Exercises the removed Exa/scout feature or its dedicated telemetry; retained generic behavior remains covered.
- Deleted `returns Exa payloads without local candidate filtering` — Exercises the removed Exa/scout feature or its dedicated telemetry; retained generic behavior remains covered.
- Deleted `passes through malformed structured content and unlinked search results` — Exercises the removed Exa/scout feature or its dedicated telemetry; retained generic behavior remains covered.
- Deleted `keeps the Exa structured-output schema within the shallow citation-free contract` — Exercises the removed Exa/scout feature or its dedicated telemetry; retained generic behavior remains covered.

### `packages/contracts/test/exa-research-question.test.ts`

- Deleted `synthesizes and round-trips a canonical focused request from compact categories` — Exercises the removed Exa/scout feature or its dedicated telemetry; retained generic behavior remains covered.
- Deleted `allows useful compact focused scope: %j` — Exercises the removed Exa/scout feature or its dedicated telemetry; retained generic behavior remains covered.
- Deleted `rejects every private-shaped value in every focused field` — Exercises the removed Exa/scout feature or its dedicated telemetry; retained generic behavior remains covered.
- Deleted `rejects arbitrary question prose for every private-person casing: %s` — Exercises the removed Exa/scout feature or its dedicated telemetry; retained generic behavior remains covered.
- Deleted `requires at least one compact category for focused mode` — Exercises the removed Exa/scout feature or its dedicated telemetry; retained generic behavior remains covered.
- Deleted `keeps batch discovery on tag-only profiles` — Exercises the removed Exa/scout feature or its dedicated telemetry; retained generic behavior remains covered.

### `packages/contracts/test/exa-research-scout.test.ts`

- Deleted `builds the current research-paper request recipe from a compact profile` — Exercises the removed Exa/scout feature or its dedicated telemetry; retained generic behavior remains covered.
- Deleted `allows finite focused concepts and rejects mode-less single-scout profiles` — Exercises the removed Exa/scout feature or its dedicated telemetry; retained generic behavior remains covered.
- Deleted `bounds batch lanes while reusing compact profile validation` — Exercises the removed Exa/scout feature or its dedicated telemetry; retained generic behavior remains covered.
- Deleted `defaults batch candidate requests per lane without widening the single-call cap` — Exercises the removed Exa/scout feature or its dedicated telemetry; retained generic behavior remains covered.
- Deleted `rejects drift from the exact request shape` — Exercises the removed Exa/scout feature or its dedicated telemetry; retained generic behavior remains covered.
- Deleted `preserves a well-formed caller window` — Exercises the removed Exa/scout feature or its dedicated telemetry; retained generic behavior remains covered.
- Deleted `preserves arbitrarily wide caller windows; the model decides scope` — Exercises the removed Exa/scout feature or its dedicated telemetry; retained generic behavior remains covered.
- Deleted `rejects until-in-the-future beyond clock skew` — Exercises the removed Exa/scout feature or its dedicated telemetry; retained generic behavior remains covered.
- Deleted `rejects since >= until` — Exercises the removed Exa/scout feature or its dedicated telemetry; retained generic behavior remains covered.
- Deleted `rejects non-canonical ISO timestamps` — Exercises the removed Exa/scout feature or its dedicated telemetry; retained generic behavior remains covered.

### `packages/device-syncd/test/bin.test.ts`

- Deleted `device-syncd bin boots the service and shuts it down on SIGINT` — Exercises the removed local daemon, launcher, or local HTTP client implementation.
- Deleted `device-syncd bin shuts down on SIGTERM` — Exercises the removed local daemon, launcher, or local HTTP client implementation.
- Deleted `device-syncd bin formats startup failures and sets process exit code` — Exercises the removed local daemon, launcher, or local HTTP client implementation.
- Deleted `device-syncd bin closes the service when HTTP startup fails` — Exercises the removed local daemon, launcher, or local HTTP client implementation.
- Deleted `device-syncd bin closes the started server when service.start throws` — Exercises the removed local daemon, launcher, or local HTTP client implementation.
- Deleted `device-syncd bin preserves rollback failures when service.start throws after HTTP startup` — Exercises the removed local daemon, launcher, or local HTTP client implementation.
- Deleted `device-syncd bin formats shutdown failures, still closes the service, and exits non-zero` — Exercises the removed local daemon, launcher, or local HTTP client implementation.
- Deleted `device-syncd bin coalesces duplicate shutdown signals into one cleanup pass` — Exercises the removed local daemon, launcher, or local HTTP client implementation.

### `packages/device-syncd/test/client.test.ts`

- Deleted `resolveDeviceSyncBaseUrl reads the unprefixed env var` — Exercises the removed local daemon, launcher, or local HTTP client implementation.
- Deleted `resolveDeviceSyncBaseUrl falls back to the default base URL when env is unset` — Exercises the removed local daemon, launcher, or local HTTP client implementation.
- Deleted `resolveDeviceSyncBaseUrl rejects non-loopback base URLs when a control-plane bearer is configured` — Exercises the removed local daemon, launcher, or local HTTP client implementation.
- Deleted `assertLocalDeviceSyncControlPlaneBaseUrl allows loopback control-plane targets` — Exercises the removed local daemon, launcher, or local HTTP client implementation.
- Deleted `resolveDeviceSyncControlToken reads the unprefixed control token` — Exercises the removed local daemon, launcher, or local HTTP client implementation.
- Deleted `resolveDeviceSyncControlToken ignores DEVICE_SYNC_SECRET-only configuration` — Exercises the removed local daemon, launcher, or local HTTP client implementation.
- Deleted `resolveDeviceSyncControlToken returns null when no env is set` — Exercises the removed local daemon, launcher, or local HTTP client implementation.
- Deleted `resolveDeviceSyncControlPlane resolves both base URL and token together` — Exercises the removed local daemon, launcher, or local HTTP client implementation.
- Deleted `client JSON helpers normalize payload parsing and auth headers` — Exercises the removed local daemon, launcher, or local HTTP client implementation.
- Deleted `requestDeviceSyncJson merges defaults, attaches auth, and returns parsed objects` — Exercises the removed local daemon, launcher, or local HTTP client implementation.
- Deleted `requestDeviceSyncJson surfaces unavailable, HTTP, and invalid-payload errors through the caller hooks` — Exercises the removed local daemon, launcher, or local HTTP client implementation.
- Deleted `requestDeviceSyncJson applies a fresh deadline and classifies response read failures` — Exercises the removed local daemon, launcher, or local HTTP client implementation.

### `packages/device-syncd/test/config.test.ts`

- Deleted `loadDeviceSyncEnvironment supports Oura-only deployments` — Exercises removed local-daemon/provider credential configuration or a direct-provider reader.
- Deleted `loadDeviceSyncEnvironment supports mixed WHOOP and Oura deployments` — Exercises removed local-daemon/provider credential configuration or a direct-provider reader.
- Deleted `loadDeviceSyncEnvironment supports Strava-only deployments` — Exercises removed local-daemon/provider credential configuration or a direct-provider reader.
- Deleted `loadDeviceSyncEnvironment rejects incomplete provider credentials` — Exercises removed local-daemon/provider credential configuration or a direct-provider reader.
- Deleted `loadDeviceSyncEnvironment supports an explicit control token and public listener` — Exercises removed local listener/daemon configuration.
- Deleted `loadDeviceSyncEnvironment keeps provider-owned webhook secrets off the generic service and http shapes` — Exercises removed local-daemon/provider credential configuration or a direct-provider reader.
- Deleted `loadDeviceSyncEnvironment rejects non-decimal and out-of-range listener ports` — Exercises removed local listener/daemon configuration.
- Deleted `loadDeviceSyncEnvironment rejects non-loopback DEVICE_SYNC_HOST values` — Exercises removed local listener/daemon configuration.
- Deleted `loadDeviceSyncEnvironment rejects URL-bracket control listener hosts` — Exercises removed local listener/daemon configuration.
- Deleted `loadDeviceSyncEnvironment ignores the removed bare PORT alias` — Exercises removed local listener/daemon configuration.
- Deleted `loadDeviceSyncEnvironment rejects partial public listener configuration` — Exercises removed local listener/daemon configuration.
- Deleted `loadDeviceSyncEnvironment rejects URL-bracket public listener hosts` — Exercises removed local listener/daemon configuration.
- Deleted `loadDeviceSyncEnvironment requires at least one provider` — Exercises removed local-daemon/provider credential configuration or a direct-provider reader.
- Deleted `loadDeviceSyncEnvironment requires DEVICE_SYNC_CONTROL_TOKEN` — Exercises removed local listener/daemon configuration.
- Deleted `loadDeviceSyncEnvironment requires DEVICE_SYNC_VAULT_ROOT instead of the removed VAULT_ROOT alias` — Exercises removed local listener/daemon configuration.
- Deleted `readConfiguredOuraDeviceSyncProviderConfig keeps the optional webhook verification token on the provider config` — Exercises removed local-daemon/provider credential configuration or a direct-provider reader.
- Deleted `readConfiguredOuraDeviceSyncProviderConfig trims scopes and parses integer overrides` — Exercises removed local-daemon/provider credential configuration or a direct-provider reader.
- Deleted `readConfiguredOuraDeviceSyncProviderConfig rejects invalid integer overrides` — Exercises removed local-daemon/provider credential configuration or a direct-provider reader.
- Deleted `readConfiguredWhoopDeviceSyncProviderConfig trims scopes and parses integer overrides` — Exercises removed local-daemon/provider credential configuration or a direct-provider reader.
- Deleted `readConfiguredStravaDeviceSyncProviderConfig trims scopes and keeps provider-owned webhook secrets` — Exercises removed local-daemon/provider credential configuration or a direct-provider reader.
- Deleted `loadDeviceSyncEnvironment wires Oura webhook timestamp tolerance into the provider` — Exercises removed local-daemon/provider credential configuration or a direct-provider reader.

### `packages/device-syncd/test/connect-targets.test.ts`

- `connect targets prefer direct providers except Junction-backed WHOOP` → `connect targets resolve provider-labelled data through Junction`. Retained generic/live assertions migrated; removed feature-only portions omitted.
- `reconnect targets retain duplicate direct and Junction routes for exact recovery` → `reconnect targets retain the exact Junction route for recovery`. Retained generic/live assertions migrated; removed feature-only portions omitted.
- `connect target source-id lookups resolve direct and Junction sources` → `connect target source-id lookups resolve Junction sources`. Retained generic/live assertions migrated; removed feature-only portions omitted.
- Deleted `WHOOP stays direct when the Junction provider filter excludes WHOOP` — Requires the removed direct WHOOP fallback when Junction excludes that source.

### `packages/device-syncd/test/http-control-helpers.test.ts`

- `isLoopbackRemoteAddress accepts localhost forms and rejects non-loopback values` → `packages/runtime-state/test/loopback-control-plane.test.ts` (`isLoopbackRemoteAddress accepts localhost forms and rejects non-loopback values`). Shared live assertions restored; removed transport-only portions omitted.
- `buildPublicDeviceSyncErrorPayload exposes only safe numeric status details` → `packages/device-syncd/test/errors.test.ts`. Shared live assertions restored; removed transport-only portions omitted.
- `buildPublicDeviceSyncErrorPayload redacts secret-bearing error text` → `packages/device-syncd/test/errors.test.ts`. Shared live assertions restored; removed transport-only portions omitted.
- Deleted `assertDeviceSyncControlRequest accepts valid loopback bearer auth and rejects malformed authorization headers` — Exercises the removed local HTTP listener, control authentication, callback HTML, or listener-only transport routing.
- Deleted `assertDeviceSyncControlRequest rejects forwarded proxy headers with the specific control-plane error` — Exercises the removed local HTTP listener, control authentication, callback HTML, or listener-only transport routing.
- Deleted `assertDeviceSyncControlRequest rejects non-loopback host headers with the mapped control-plane error` — Exercises the removed local HTTP listener, control authentication, callback HTML, or listener-only transport routing.
- Deleted `assertDeviceSyncControlRequest accepts ipv6 loopback hosts after shared loopback validation` — Exercises the removed local HTTP listener, control authentication, callback HTML, or listener-only transport routing.
- Deleted `renderCallbackHtml escapes title and body content` — Exercises the removed local HTTP listener, control authentication, callback HTML, or listener-only transport routing.

### `packages/device-syncd/test/http-startup.test.ts`

- Deleted `device sync http server rejects URL-bracket public listener hosts before binding` — Exercises the removed local HTTP listener, control authentication, callback HTML, or listener-only transport routing.
- Deleted `device sync http server closes the control listener when the public listener fails to bind` — Exercises the removed local HTTP listener, control authentication, callback HTML, or listener-only transport routing.
- Deleted `device sync http server rejects invalid listener ports before binding` — Exercises the removed local HTTP listener, control authentication, callback HTML, or listener-only transport routing.

### `packages/device-syncd/test/http.test.ts`

- `device sync public error payload keeps only sanitized provider status details` → `packages/device-syncd/test/errors.test.ts`. Shared live assertions restored; removed transport-only portions omitted.
- `device sync startup error formatting omits sensitive provider response details` → `packages/device-syncd/test/errors.test.ts`. Shared live assertions restored; removed transport-only portions omitted.
- Deleted `assertDeviceSyncControlRequest rejects non-loopback callers` — Exercises the removed local HTTP listener, control authentication, callback HTML, or listener-only transport routing.
- Deleted `assertDeviceSyncControlRequest accepts loopback callers with a single-value authorization header array` — Exercises the removed local HTTP listener, control authentication, callback HTML, or listener-only transport routing.
- Deleted `assertDeviceSyncControlRequest rejects forwarded proxy headers` — Exercises the removed local HTTP listener, control authentication, callback HTML, or listener-only transport routing.
- Deleted `assertDeviceSyncControlRequest rejects repeated forwarded proxy headers` — Exercises the removed local HTTP listener, control authentication, callback HTML, or listener-only transport routing.
- Deleted `assertDeviceSyncControlRequest rejects non-loopback host headers` — Exercises the removed local HTTP listener, control authentication, callback HTML, or listener-only transport routing.
- Deleted `assertDeviceSyncControlRequest rejects malformed loopback-like host headers` — Exercises the removed local HTTP listener, control authentication, callback HTML, or listener-only transport routing.
- Deleted `device sync http handler routes control and public requests without sockets` — Exercises the removed local HTTP listener, control authentication, callback HTML, or listener-only transport routing.
- Deleted `device sync http handler respects root and exact base-path routing` — Exercises the removed local HTTP listener, control authentication, callback HTML, or listener-only transport routing.
- Deleted `device sync http handler forwards single-value webhook headers and string body chunks` — Exercises the removed local HTTP listener, control authentication, callback HTML, or listener-only transport routing.
- Deleted `device sync http handler preserves repeated webhook headers` — Exercises the removed local HTTP listener, control authentication, callback HTML, or listener-only transport routing.
- Deleted `device sync http handler validates request bodies and payload limits` — Exercises the removed local HTTP listener, control authentication, callback HTML, or listener-only transport routing.
- Deleted `device sync http handler forwards owner and source provider on connection starts` — Exercises the removed local HTTP listener, control authentication, callback HTML, or listener-only transport routing.
- Deleted `device sync http handler maps URI errors from callback handling to BAD_REQUEST` — Exercises the removed local HTTP listener, control authentication, callback HTML, or listener-only transport routing.
- Deleted `device sync http handler redirects successful callbacks and renders callback failures without returnTo` — Exercises the removed local HTTP listener, control authentication, callback HTML, or listener-only transport routing.
- Deleted `device sync http handler redirects replayed callbacks to returnTo without asserting an outcome` — Exercises the removed local HTTP listener, control authentication, callback HTML, or listener-only transport routing.
- Deleted `device sync http handler renders callback html when a stored success returnTo is unsafe` — Exercises the removed local HTTP listener, control authentication, callback HTML, or listener-only transport routing.
- Deleted `device sync http handler returns not found for unknown accounts` — Exercises the removed local HTTP listener, control authentication, callback HTML, or listener-only transport routing.
- Deleted `device sync http server rejects non-loopback control listener hosts` — Exercises the removed local HTTP listener, control authentication, callback HTML, or listener-only transport routing.
- Deleted `device sync http server requires both public listener fields together` — Exercises the removed local HTTP listener, control authentication, callback HTML, or listener-only transport routing.
- Deleted `device sync http server can start without a public listener and rejects missing control tokens` — Exercises the removed local HTTP listener, control authentication, callback HTML, or listener-only transport routing.
- Deleted `device sync http server wires control and public listeners to the correct handler surfaces` — Exercises the removed local HTTP listener, control authentication, callback HTML, or listener-only transport routing.
- Deleted `device sync http handler redacts provider response bodies from control-plane JSON errors` — Exercises the removed local HTTP listener, control authentication, callback HTML, or listener-only transport routing.
- Deleted `device sync http handler does not expose raw unexpected error text to control-plane clients` — Exercises the removed local HTTP listener, control authentication, callback HTML, or listener-only transport routing.
- Deleted `renderCallbackHtml escapes plain-text body content` — Exercises the removed local HTTP listener, control authentication, callback HTML, or listener-only transport routing.
- Deleted `renderCallbackHtml escapes callback errors once without requiring pre-escaped text` — Exercises the removed local HTTP listener, control authentication, callback HTML, or listener-only transport routing.
- Deleted `device sync http handler redirects OAuth callback errors back to the original returnTo` — Exercises the removed local HTTP listener, control authentication, callback HTML, or listener-only transport routing.
- Deleted `device sync http handler renders callback errors when no returnTo is available` — Exercises the removed local HTTP listener, control authentication, callback HTML, or listener-only transport routing.
- Deleted `device sync http handler redacts secret-bearing callback error text before rendering html` — Exercises the removed local HTTP listener, control authentication, callback HTML, or listener-only transport routing.
- Deleted `device sync http handler renders callback errors when returnTo is malformed` — Exercises the removed local HTTP listener, control authentication, callback HTML, or listener-only transport routing.
- Deleted `device sync http handler serves the Oura webhook verification challenge on the public listener` — Exercises the removed local HTTP listener, control authentication, callback HTML, or listener-only transport routing.
- Deleted `device sync http handler returns the shared Oura mismatch error on the public verification route` — Exercises the removed local HTTP listener, control authentication, callback HTML, or listener-only transport routing.
- Deleted `device sync http handler returns the shared Oura missing-token error on the public verification route` — Exercises the removed local HTTP listener, control authentication, callback HTML, or listener-only transport routing.
- Deleted `device sync http handler short-circuits public webhook POSTs when provider preflight returns a response` — Exercises the removed local HTTP listener, control authentication, callback HTML, or listener-only transport routing.

### `packages/device-syncd/test/oura-provider.test.ts`

- Deleted `Oura provider exchanges an auth code into a refreshable connection` — Exercises a removed direct OAuth/API/webhook transport or its transport-only helper.
- Deleted `Oura provider normalizes extapi-prefixed token scopes from token responses` — Exercises a removed direct OAuth/API/webhook transport or its transport-only helper.
- Deleted `Oura provider requires a replacement refresh token during refresh` — Exercises a removed direct OAuth/API/webhook transport or its transport-only helper.
- Deleted `Oura provider requires an existing refresh token before attempting refresh` — Exercises a removed direct OAuth/API/webhook transport or its transport-only helper.
- Deleted `Oura provider includes safe OAuth diagnostics for token request failures` — Exercises a removed direct OAuth/API/webhook transport or its transport-only helper.
- Deleted `Oura provider revokes access tokens through the OAuth revoke endpoint` — Exercises a removed direct OAuth/API/webhook transport or its transport-only helper.
- Deleted `Oura provider rejects auth exchanges without a refresh token and personal-info ids` — Exercises a removed direct OAuth/API/webhook transport or its transport-only helper.
- Deleted `Oura provider backfills snapshot windows with polling-friendly collection fetches` — Exercises a removed direct OAuth/API/webhook transport or its transport-only helper.
- Deleted `Oura provider rejects repeated pagination tokens before accumulating unbounded records` — Exercises a removed direct OAuth/API/webhook transport or its transport-only helper.
- Deleted `Oura provider rejects excessive unique pagination tokens` — Exercises a removed direct OAuth/API/webhook transport or its transport-only helper.
- Deleted `Oura provider ignores old heartrate-only grants during backfill` — Exercises a removed direct OAuth/API/webhook transport or its transport-only helper.
- Deleted `Oura heartrate resource jobs are ignored for current partial days` — Exercises a removed direct OAuth/API/webhook transport or its transport-only helper.
- Deleted `Oura heartrate resource jobs are ignored for historical days` — Exercises a removed direct OAuth/API/webhook transport or its transport-only helper.
- Deleted `Oura heartrate delete jobs are ignored` — Exercises a removed direct OAuth/API/webhook transport or its transport-only helper.
- Deleted `Oura old heartrate-only backfills ignore invalid dense windows without fetching` — Exercises a removed direct OAuth/API/webhook transport or its transport-only helper.
- Deleted `Oura provider falls back to granted scopes and rejects connections without the personal scope` — Exercises a removed direct OAuth/API/webhook transport or its transport-only helper.
- Deleted `Oura provider best-effort revokes exchanged access tokens when post-token-exchange validation fails` — Exercises a removed direct OAuth/API/webhook transport or its transport-only helper.
- Deleted `Oura provider turns non-operation webhook events into reconcile hints and rejects stale signed deliveries` — Exercises a removed direct OAuth/API/webhook transport or its transport-only helper.
- Deleted `Oura provider validates webhook signatures and turns notifications into resource-scoped hints` — Exercises a removed direct OAuth/API/webhook transport or its transport-only helper.
- Deleted `Oura old heartrate webhooks are accepted and no-op at execution` — Exercises a removed direct OAuth/API/webhook transport or its transport-only helper.
- Deleted `Oura provider accepts uppercase hexadecimal webhook signatures` — Exercises a removed direct OAuth/API/webhook transport or its transport-only helper.
- Deleted `Oura provider keeps the request-time import fallback without claiming a missing event time` — Exercises a removed direct OAuth/API/webhook transport or its transport-only helper.
- Deleted `Oura webhook preflight helper returns the challenge only for the configured token` — Exercises a removed direct OAuth/API/webhook transport or its transport-only helper.
- Deleted `Oura provider webhook admin no-ops without a verification token and reuses the shared subscription client when one is configured` — Exercises a removed direct OAuth/API/webhook transport or its transport-only helper.
- Deleted `Oura provider accepts documented numeric-second timestamps, uses event_time, and imports delete webhooks as deletion snapshots` — Exercises a removed direct OAuth/API/webhook transport or its transport-only helper.
- Deleted `Oura provider imports hosted-narrowed delete wake payloads as deletion snapshots` — Exercises a removed direct OAuth/API/webhook transport or its transport-only helper.
- Deleted `Oura provider fallback trace ids ignore transport timestamps when the webhook body includes event_time` — Exercises a removed direct OAuth/API/webhook transport or its transport-only helper.
- Deleted `Oura provider prefers payload trace_id over fallback trace derivation` — Exercises a removed direct OAuth/API/webhook transport or its transport-only helper.
- Deleted `Oura provider prefers payload event_id when trace_id is absent` — Exercises a removed direct OAuth/API/webhook transport or its transport-only helper.
- Deleted `Oura provider fallback trace ids use the webhook transport timestamp when the body omits ids and event time` — Exercises a removed direct OAuth/API/webhook transport or its transport-only helper.
- Deleted `Oura webhook resource jobs fetch only the hinted collection and keep the matching object id` — Exercises a removed direct OAuth/API/webhook transport or its transport-only helper.
- Deleted `Oura webhook resource jobs keep object scope even when the hinted object is missing from narrow and broader retries` — Exercises a removed direct OAuth/API/webhook transport or its transport-only helper.
- Deleted `Oura webhook rejects malformed timestamp headers even when the signature matches` — Exercises a removed direct OAuth/API/webhook transport or its transport-only helper.
- Deleted `Oura webhook rejects missing or invalid signatures before parsing the payload` — Exercises a removed direct OAuth/API/webhook transport or its transport-only helper.
- Deleted `Oura provider rejects invalid webhook payloads, schedules reconcile jobs, and rejects unsupported job kinds` — Exercises a removed direct OAuth/API/webhook transport or its transport-only helper.
- Deleted `Oura provider exposes the connect URL, forwards webhook verification through the admin surface, and falls back to reconcile for unscoped resource jobs` — Exercises a removed direct OAuth/API/webhook transport or its transport-only helper.

### `packages/device-syncd/test/oura-webhooks.test.ts`

- Deleted `Oura webhook subscription ensure creates missing subscriptions with client credential headers` — Exercises a removed direct OAuth/API/webhook transport or its transport-only helper.
- Deleted `Oura webhook subscription ensure prunes only same-callback duplicates and stale subscriptions` — Exercises a removed direct OAuth/API/webhook transport or its transport-only helper.
- Deleted `Oura webhook subscription ensure retains current subscriptions when renewals and duplicate pruning are disabled` — Exercises a removed direct OAuth/API/webhook transport or its transport-only helper.
- Deleted `Oura webhook subscription ensure does not prune managed subscriptions on a different callback path` — Exercises a removed direct OAuth/API/webhook transport or its transport-only helper.
- Deleted `Oura webhook subscription ensure prunes stale subscriptions for the same exact callback URL` — Exercises a removed direct OAuth/API/webhook transport or its transport-only helper.
- Deleted `Oura webhook subscription client normalizes nested list payloads and callback URLs` — Exercises a removed direct OAuth/API/webhook transport or its transport-only helper.
- Deleted `Oura webhook subscription client validates invalid inputs and malformed responses before or after fetch` — Exercises a removed direct OAuth/API/webhook transport or its transport-only helper.
- Deleted `Oura webhook subscription client rejects missing ensure tokens, preserves other-origin subscriptions, and surfaces delete failures` — Exercises a removed direct OAuth/API/webhook transport or its transport-only helper.

### `packages/device-syncd/test/provider-descriptor-integration.test.ts`

- Deleted `applies Oura runtime overrides onto the shared descriptor shape` — Exercises a removed direct OAuth/API/webhook transport or its transport-only helper.
- Deleted `applies WHOOP runtime overrides onto the shared descriptor shape` — Exercises a removed direct OAuth/API/webhook transport or its transport-only helper.
- Deleted `keeps WHOOP explicit empty scope overrides at the required base scopes only` — Exercises a removed direct OAuth/API/webhook transport or its transport-only helper.
- Deleted `applies Strava runtime overrides onto the shared descriptor shape` — Exercises a removed direct OAuth/API/webhook transport or its transport-only helper.

### `packages/device-syncd/test/service.test.ts`

- `device sync service starts and stops its timers, closes owned stores, and rejects missing provider or account lookups` → `device sync service closes owned stores, and rejects missing provider or account lookups`. Retained generic/live assertions migrated; removed feature-only portions omitted.
- Deleted `device sync service worker batch logs drain failures once and skips reentrant ticks` — Exercises removed daemon timer batching/reentrant ticks.
- Deleted `device sync service durably suppresses WHOOP webhook replays without trace_id even when retry deliveries have a new signature timestamp` — Exercises removed direct WHOOP webhook signature/replay handling.

### `packages/device-syncd/test/shared-oauth.test.ts`

- `shared oauth helpers normalize response parsing, retry metadata, scopes, and expiry helpers` → `packages/device-syncd/test/provider-api-error.test.ts` (`shared API errors preserve retry, status, account policy and bounded diagnostics`). Shared live assertions restored; removed transport-only portions omitted.
- Deleted `shared oauth token request and bearer fetch helpers cover success, optional 404s, and error bodies` — Exercises a removed direct OAuth/API/webhook transport or its transport-only helper.
- Deleted `shared oauth bearer fetch helper honors caller abort signals` — Exercises a removed direct OAuth/API/webhook transport or its transport-only helper.
- Deleted `shared oauth fetch helpers preserve caller abort reasons when fetch reports a generic AbortError` — Exercises a removed direct OAuth/API/webhook transport or its transport-only helper.
- Deleted `shared oauth fetch helpers do not misclassify request timeouts as late caller aborts` — Exercises a removed direct OAuth/API/webhook transport or its transport-only helper.
- Deleted `shared oauth request helpers keep caller abort active through response body parsing` — Exercises a removed direct OAuth/API/webhook transport or its transport-only helper.
- Deleted `shared oauth retry helpers refresh before requests, recover from a first 401, and retry retryable failures` — Exercises a removed direct OAuth/API/webhook transport or its transport-only helper.
- Deleted `shared oauth helper flows cover auth-code exchange, refresh rotation, bearer fetch success, and scheduling` — Exercises a removed direct OAuth/API/webhook transport or its transport-only helper.
- Deleted `shared oauth helpers reject extension parameters that override protocol-owned fields` — Exercises a removed direct OAuth/API/webhook transport or its transport-only helper.
- Deleted `shared oauth adapter exposes nested oauthAdapter and routes refresh and revoke through connectionHandler` — Exercises a removed direct OAuth/API/webhook transport or its transport-only helper.
- Deleted `shared oauth adapter omits revokeAccess when it is not supplied` — Exercises a removed direct OAuth/API/webhook transport or its transport-only helper.
- Deleted `shared oauth refreshing sessions reuse refreshed credentials and rethrow non-retryable request failures` — Exercises a removed direct OAuth/API/webhook transport or its transport-only helper.
- Deleted `shared oauth refreshing sessions update their current account and scheduled helpers stay deterministic` — Exercises a removed direct OAuth/API/webhook transport or its transport-only helper.

### `packages/device-syncd/test/strava-provider.test.ts`

- Deleted `builds an OAuth connect URL with comma-delimited scopes` — Exercises a removed direct OAuth/API/webhook transport or its transport-only helper.
- Deleted `schedules reconcile jobs through the shared generic window seam` — Exercises a removed direct OAuth/API/webhook transport or its transport-only helper.
- Deleted `exchanges authorization codes with Strava's token contract` — Exercises a removed direct OAuth/API/webhook transport or its transport-only helper.
- Deleted `fetches the athlete profile when the token response omits athlete details` — Exercises a removed direct OAuth/API/webhook transport or its transport-only helper.
- Deleted `marks refresh-token invalid grants as reauthorization required` — Exercises a removed direct OAuth/API/webhook transport or its transport-only helper.
- Deleted `marks an incomplete rotated token generation as provider-state unknown` — Exercises a removed direct OAuth/API/webhook transport or its transport-only helper.
- Deleted `rejects authorization when neither the token response nor the athlete profile provides a stable id` — Exercises a removed direct OAuth/API/webhook transport or its transport-only helper.
- Deleted `rejects authorization responses that do not grant an activity scope` — Exercises a removed direct OAuth/API/webhook transport or its transport-only helper.
- Deleted `uses token-response scopes as the authority before accepting callback scopes` — Exercises a removed direct OAuth/API/webhook transport or its transport-only helper.
- Deleted `answers Strava webhook verification challenges through the provider-owned preflight seam` — Exercises a removed direct OAuth/API/webhook transport or its transport-only helper.
- Deleted `covers Strava webhook preflight validation failures and ignored methods` — Exercises a removed direct OAuth/API/webhook transport or its transport-only helper.
- Deleted `rejects Strava webhook events without a valid delivery signature` — Exercises a removed direct OAuth/API/webhook transport or its transport-only helper.
- Deleted `rejects malformed Strava webhook payloads on signature verification before JSON parsing` — Exercises a removed direct OAuth/API/webhook transport or its transport-only helper.
- Deleted `parses Strava activity webhook events into resource or delete jobs` — Exercises a removed direct OAuth/API/webhook transport or its transport-only helper.
- Deleted `does not invent a top-level event occurrence when Strava omits event_time` — Exercises a removed direct OAuth/API/webhook transport or its transport-only helper.
- Deleted `does not invent a top-level event occurrence when Strava event_time is malformed` — Exercises a removed direct OAuth/API/webhook transport or its transport-only helper.
- Deleted `treats Strava athlete authorization revocation as a deauthorize job` — Exercises a removed direct OAuth/API/webhook transport or its transport-only helper.
- Deleted `invokes the disconnect callback when deauthorization jobs execute` — Exercises a removed direct OAuth/API/webhook transport or its transport-only helper.
- Deleted `does not emit delete imports when a resource webhook fetch returns 404` — Exercises a removed direct OAuth/API/webhook transport or its transport-only helper.
- Deleted `executes backfill imports, refreshes tokens, and ignores non-activity resource jobs` — Exercises a removed direct OAuth/API/webhook transport or its transport-only helper.
- Deleted `rejects Strava activity pagination that exceeds page or record caps` — Exercises a removed direct OAuth/API/webhook transport or its transport-only helper.
- Deleted `ensures Strava webhook subscriptions only when a verify token is configured and tolerates benign deauthorization responses` — Exercises a removed direct OAuth/API/webhook transport or its transport-only helper.
- Deleted `revokes stored Strava access without client credentials` — Exercises a removed direct OAuth/API/webhook transport or its transport-only helper.
- Deleted `imports delete jobs, validates malformed jobs and webhook payloads, and handles deauthorize edge cases` — Exercises a removed direct OAuth/API/webhook transport or its transport-only helper.

### `packages/device-syncd/test/strava-webhooks.test.ts`

- Deleted `retains an existing matching app-global subscription without recreating it` — Exercises a removed direct OAuth/API/webhook transport or its transport-only helper.
- Deleted `replaces a stale app-global subscription when the callback URL changes` — Exercises a removed direct OAuth/API/webhook transport or its transport-only helper.
- Deleted `parses wrapped list payloads, prefers the newest managed callback, and deletes duplicates` — Exercises a removed direct OAuth/API/webhook transport or its transport-only helper.
- Deleted `surfaces invalid subscription payloads and provider API failures` — Exercises a removed direct OAuth/API/webhook transport or its transport-only helper.
- Deleted `rejects list responses that omit subscription data` — Exercises a removed direct OAuth/API/webhook transport or its transport-only helper.

### `packages/device-syncd/test/whoop-provider.test.ts`

- Deleted `WHOOP provider builds a connect URL and exchanges an auth code into a refreshable connection` — Exercises a removed direct OAuth/API/webhook transport or its transport-only helper.
- Deleted `WHOOP provider avoids persisting connect-time profile or body measurement metadata` — Exercises a removed direct OAuth/API/webhook transport or its transport-only helper.
- Deleted `WHOOP provider reports connect-time profile failures with a semantic endpoint kind` — Exercises a removed direct OAuth/API/webhook transport or its transport-only helper.
- Deleted `WHOOP provider rejects refresh responses that omit the rotated refresh token` — Exercises a removed direct OAuth/API/webhook transport or its transport-only helper.
- Deleted `WHOOP provider marks invalid refresh-token grants as reauthorization required` — Exercises a removed direct OAuth/API/webhook transport or its transport-only helper.
- Deleted `WHOOP provider includes safe request-shape diagnostics for auth-code token failures` — Exercises a removed direct OAuth/API/webhook transport or its transport-only helper.
- Deleted `WHOOP provider treats token-specific refresh invalid_request errors as reauthorization required` — Exercises a removed direct OAuth/API/webhook transport or its transport-only helper.
- Deleted `WHOOP provider treats generic refresh invalid_request errors as reconnectable when request shape is complete` — Exercises a removed direct OAuth/API/webhook transport or its transport-only helper.
- Deleted `WHOOP provider does not mark client credential token failures as reauthorization required` — Exercises a removed direct OAuth/API/webhook transport or its transport-only helper.
- Deleted `WHOOP provider does not mark opaque token endpoint authorization failures as reauthorization required` — Exercises a removed direct OAuth/API/webhook transport or its transport-only helper.
- Deleted `WHOOP provider treats rate-limited token requests as retryable` — Exercises a removed direct OAuth/API/webhook transport or its transport-only helper.
- Deleted `WHOOP provider includes safe request and response diagnostics for API failures` — Exercises a removed direct OAuth/API/webhook transport or its transport-only helper.
- Deleted `WHOOP provider requires an existing refresh token before attempting refresh` — Exercises a removed direct OAuth/API/webhook transport or its transport-only helper.
- Deleted `WHOOP provider rejects auth exchanges without a refresh token` — Exercises a removed direct OAuth/API/webhook transport or its transport-only helper.
- Deleted `WHOOP provider revokes with the persisted access token even when it is near expiry` — Exercises a removed direct OAuth/API/webhook transport or its transport-only helper.
- Deleted `WHOOP provider backfills snapshot windows and refreshes once after a 401` — Exercises a removed direct OAuth/API/webhook transport or its transport-only helper.
- Deleted `WHOOP provider rejects repeated cursors and excessive pagination` — Exercises a removed direct OAuth/API/webhook transport or its transport-only helper.
- Deleted `WHOOP provider schedules reconcile jobs without profile/body-measurement sync flags` — Exercises a removed direct OAuth/API/webhook transport or its transport-only helper.
- Deleted `WHOOP provider skips body measurement fetches when the account did not grant the body scope` — Exercises a removed direct OAuth/API/webhook transport or its transport-only helper.
- Deleted `WHOOP provider maps webhook events to the same job kinds, priorities, and payload fields` — Exercises a removed direct OAuth/API/webhook transport or its transport-only helper.
- Deleted `WHOOP provider synthesizes a deterministic trace id and job dedupe key when trace_id is missing` — Exercises a removed direct OAuth/API/webhook transport or its transport-only helper.
- Deleted `WHOOP provider keeps the same synthetic trace id across retry deliveries with a new signature timestamp` — Exercises a removed direct OAuth/API/webhook transport or its transport-only helper.
- Deleted `WHOOP provider accepts numeric-second timestamps and leaves unknown webhook events as no-op hints` — Exercises a removed direct OAuth/API/webhook transport or its transport-only helper.
- Deleted `WHOOP provider rejects non-object webhook payloads after signature verification succeeds` — Exercises a removed direct OAuth/API/webhook transport or its transport-only helper.
- Deleted `WHOOP provider does not synthesize delete snapshots when an updated resource fetch returns 404` — Exercises a removed direct OAuth/API/webhook transport or its transport-only helper.
- Deleted `WHOOP provider skips resource imports when the account did not grant the required resource scopes` — Exercises a removed direct OAuth/API/webhook transport or its transport-only helper.
- Deleted `WHOOP provider rejects missing, invalid, stale, and bad-signature webhook deliveries before parsing payloads` — Exercises a removed direct OAuth/API/webhook transport or its transport-only helper.
- Deleted `WHOOP provider rejects profile responses without a stable user id and tolerates already-revoked access` — Exercises a removed direct OAuth/API/webhook transport or its transport-only helper.
- Deleted `WHOOP webhook replay checks use the request context timestamp instead of process wall clock` — Exercises a removed direct OAuth/API/webhook transport or its transport-only helper.
- Deleted `WHOOP provider surfaces revoke failures, rejects payloads missing required fields, and handles direct delete or unsupported jobs` — Exercises a removed direct OAuth/API/webhook transport or its transport-only helper.
- Deleted `WHOOP provider imports sleep-related resources with linked cycle and recovery snapshots` — Exercises a removed direct OAuth/API/webhook transport or its transport-only helper.

### `packages/operator-config/test/device-daemon-runtime.test.ts`

- `device CLI contracts normalize provider keys and parse result payloads` → `packages/operator-config/test/device-cli-contracts.test.ts`. Shared live assertions restored; removed transport-only portions omitted.
- Deleted `device-daemon path, env, process, and state helpers stay deterministic` — Exercises the removed local daemon, launcher, or local HTTP client implementation.
- Deleted `resolveInstalledDeviceSyncPackageEntry falls back only when the bare package request is missing` — Exercises the removed local daemon, launcher, or local HTTP client implementation.
- Deleted `resolveInstalledDeviceSyncPackageEntry does not require a valid file-url base at module load` — Exercises the removed local daemon, launcher, or local HTTP client implementation.
- Deleted `managed device-daemon lifecycle helpers cover explicit, status, start, and stop branches` — Exercises the removed local daemon, launcher, or local HTTP client implementation.
- Deleted `managed device-sync daemon keeps encryption secret stable across stop and restart` — Exercises the removed local daemon, launcher, or local HTTP client implementation.
- Deleted `managed device-sync encryption secret fails closed on invalid existing state` — Exercises the removed local daemon, launcher, or local HTTP client implementation.
- Deleted `device-daemon lifecycle handles startup cleanup and stop edge cases deterministically` — Exercises the removed local daemon, launcher, or local HTTP client implementation.
- Deleted `device-daemon management also covers explicit spawn tokens and default kill/sleep dependencies` — Exercises the removed local daemon, launcher, or local HTTP client implementation.
- Deleted `default unmanaged listener finder requires an exact device-syncd bin path` — Exercises the removed local daemon, launcher, or local HTTP client implementation.
- Deleted `default spawn helper covers pid-less and synchronous child-process failures` — Exercises the removed local daemon, launcher, or local HTTP client implementation.
- Deleted `default spawn helper closes the first log descriptor when opening the second one fails` — Exercises the removed local daemon, launcher, or local HTTP client implementation.

### `packages/operator-config/test/http-linq-device-runtime.test.ts`

- Deleted `device sync client covers list, begin, and browser open paths` — Exercises the removed local daemon, launcher, or local HTTP client implementation.
- Deleted `device sync client resolves Windows authorization URLs without cmd shell parsing` — Exercises the removed local daemon, launcher, or local HTTP client implementation.
- Deleted `device sync client wraps transport and http failures with control-plane context` — Exercises the removed local daemon, launcher, or local HTTP client implementation.

### `packages/runtime-state/test/cli-timing.test.ts`

- ``${owner} parse rejection is gated, finite and separate from research categories`` → ``${owner} parse rejection is gated, finite``. Retained generic/live assertions migrated; removed feature-only portions omitted.
- Deleted `research timing admits only three exact source codes without inferring a stage or retaining private data` — Exercises the removed Exa/scout feature or its dedicated telemetry; retained generic behavior remains covered.
- Deleted `research batch rejection is private own data, finite, gated and inert to hostile metadata` — Exercises the removed Exa/scout feature or its dedicated telemetry; retained generic behavior remains covered.
- Deleted `rejection variants share failure caps, coalesce exactly and drop only detail when malformed on the wire` — Exercises the removed Exa/scout feature or its dedicated telemetry; retained generic behavior remains covered.
- Deleted `actual pre-rejection reader drops only the category and keeps counts` — Exercises the removed Exa/scout feature or its dedicated telemetry; retained generic behavior remains covered.
- Deleted `actual pre-research reader collapses only new evidence and preserves mixed counts` — Exercises the removed Exa/scout feature or its dedicated telemetry; retained generic behavior remains covered.

### `scripts/release-verification-lanes.test.ts`

- Deleted `executes distinct preflight and full release-check tails` — Exercises removed npm publication, tarball, or release orchestration; retained coverage-matrix and artifact guards remain covered.
- Deleted `preserves the complete summary and an explicitly undefined expected version` — Exercises removed npm publication, tarball, or release orchestration; retained coverage-matrix and artifact guards remain covered.
- Deleted ``rejects expected version ${JSON.stringify(expectVersion)} before reading manifest fields`` — Exercises removed npm publication, tarball, or release orchestration; retained coverage-matrix and artifact guards remain covered.
- Deleted `preserves aggregate diagnostic order across manifest, package, version, and primary checks` — Exercises removed npm publication, tarball, or release orchestration; retained coverage-matrix and artifact guards remain covered.
- Deleted `keeps default-export and entrypoint getter short circuits in order` — Exercises removed npm publication, tarball, or release orchestration; retained coverage-matrix and artifact guards remain covered.
- Deleted `reports missing private bundles before undeclared bundled and transitive external dependencies` — Exercises removed npm publication, tarball, or release orchestration; retained coverage-matrix and artifact guards remain covered.

### `scripts/wearable-fixture-capture.test.ts`

- Deleted `removes direct identifiers and shifts provider dates in captured Junction files` — Exercises the removed direct-provider fixture-capture CLI.
- Deleted `allows equivalent loopback hosts and rejects forwarded headers` — Exercises the removed direct-provider fixture-capture CLI.
- Deleted `pins the local capture run to wearable targets and reports allowed Junction resources` — Exercises the removed direct-provider fixture-capture CLI.
- Deleted `reads queued/running/dead job counts from daemon health responses` — Exercises the removed direct-provider fixture-capture CLI.
- Deleted `rejects malformed daemon health responses` — Exercises the removed direct-provider fixture-capture CLI.
- Deleted `allows exports only after jobs are idle and healthy` — Exercises the removed direct-provider fixture-capture CLI.

### `packages/operator-config/test/http-linq-device-runtime-branches.test.ts`

- Deleted `device sync client covers non-loopback passthrough paths` — Exercises the removed local daemon, launcher, or local HTTP client implementation.

### `packages/operator-config/test/runtime-helpers.test.ts`

- Deleted `device sync client helpers trim env values, send bearer auth, and map control-plane failures` — Exercises the removed local daemon, launcher, or local HTTP client implementation.

### `packages/assistant-runtime/test/hosted-runtime-workspace-assistant-phase-device-sync.test.ts`

- `omits Junction source commands when the public connect target resolves direct` → `offers Junction Oura reconnect and refuses retired direct Strava reconnect`. Retained generic/live assertions migrated; removed feature-only portions omitted.

### Additional retained-test fixture repairs

These files were not deleted or reduced by more than 150 lines. Counts compare this repair with the initial merged head; restored shared cases are already counted at their original owners above. No additional cases were deleted.

| File | Restored / relocated | Existing cases migrated or repaired | Deleted |
| --- | ---: | ---: | ---: |
| `apps/web/test/device-connect-intent-route.test.ts` | 0 | 3 | 0 |
| `apps/web/test/device-sync-hosted-runtime-authority.test.ts` | 0 | 1 | 0 |
| `apps/web/test/device-sync-hosted-wake.test.ts` | 0 | 7 | 0 |
| `apps/web/test/device-sync-internal-connect-route.test.ts` | 0 | 2 | 0 |
| `apps/web/test/device-sync-root-and-stripe-cron-routes.test.ts` | 0 | 3 | 0 |
| `apps/web/test/device-sync-settings-routes.test.ts` | 0 | 12 | 0 |
| `packages/assistant-runtime/test/hosted-runtime-concurrent-device-import.integration.test.ts` | 0 | 2 | 0 |
| `packages/assistant-runtime/test/hosted-runtime-device-import-admission.test.ts` | 0 | 1 | 0 |
| `packages/assistant-runtime/test/hosted-runtime-interrupted-system-recording.integration.test.ts` | 0 | 1 | 0 |
| `packages/assistant-runtime/test/hosted-runtime-workspace-entrypoint-progress-generation.test.ts` | 0 | 1 | 0 |
| `packages/assistant-runtime/test/hosted-runtime-workspace-entrypoint-system-mailbox.test.ts` | 0 | 4 | 0 |
| `packages/assistant-runtime/test/hosted-runtime-workspace-runner.test.ts` | 0 | 2 | 0 |
| `packages/cli/test/assistant-cli.test.ts` | 0 | 1 | 0 |
| `packages/cli/test/cli-timing.test.ts` | 0 | 1 | 0 |
| `packages/cli/test/device-knowledge-command-coverage.test.ts` | 0 | 1 | 0 |
| `packages/device-syncd/test/errors.test.ts` | 4 | 0 | 0 |
| `packages/device-syncd/test/provider-api-error.test.ts` | 1 | 0 | 0 |
| `packages/runtime-state/test/loopback-control-plane.test.ts` | 1 | 0 | 0 |
| `packages/operator-config/test/device-cli-contracts.test.ts` | 1 | 0 | 0 |

The shared runtime entrypoint harness also now supplies Junction provider configuration, source snapshots, bounded summary fixtures, and explicit source-authority read accounting. Parameterized cases that consume that harness can change behavior without changing their declaration text.

Two additional baseline title differences are upstream migrations, not deletion-branch losses: `game lifecycle rematch notice names the requester, who takes which task and app choices` became `game lifecycle rematch notice names the requester, tasks and chat or app agreement`; `game chat sends an unaccepted rematch to the app without asking which game` became `game chat keeps an unaddressed bearer invite in the app`. Both c04 replacements remain, together with main's game-chat setup scenarios. They are not counted as deleted subjects.

### Coverage repair verification results

All commands below ran in the assigned worktree. No production source was changed; no push, PR, npm publication, production operation, other-checkout command, stash, root test, coverage, or acceptance run was performed.

Final suite results:

| Lane | Result |
| --- | --- |
| device-syncd full tests | PASS: Tests  1456 passed (1456) |
| assistant-runtime full tests | PASS: Tests  3895 passed \| 7 skipped (3902) |
| operator-config full tests | PASS: Tests  439 passed (439) |
| CLI full tests | PASS: Tests  1264 passed \| 29 skipped (1293) |
| contracts full tests | PASS: Tests  403 passed (403) |
| query full tests | PASS: Tests  808 passed \| 1 skipped (809) |
| importers full tests | PASS: Tests  753 passed (753) |
| assistant-engine: every retained branch-touched file (21 files) | PASS: Tests  1505 passed \| 637 skipped (2142) |
| Web device-sync, settings and ops (79 files) | PASS: Tests  1142 passed \| 109 skipped (1251) |
| Cloudflare full test:node, including container helper suite | PASS: Tests  4615 passed \| 5 skipped (4620); Tests  20 passed (20) |
| shared loopback helper | PASS: Tests  13 passed (13) |
| CLI verification | PASS: Tests  316 passed (316) |

Install, root build, all requested package/app typechecks, workspace boundaries/cycles, dependency guard, no-JS guard, CLI verification, docs drift, complexity diff and provider-request guard passed. The full runner bundle passed: CLI static startup closure 19,800 bytes; runner static boot closure 2,005,219 bytes across 22 chunks. Its nested install used a task-local offline pnpm wrapper and the existing cache; this did not bypass any bundle stage. The existing [Frog report](../../../.agents/friction-log/20261102151023-runner-bundle-assembly/friction.md) already covers the bundler's failure to honor the offline environment setting.

Initial failed runs exposed stale direct-provider fixtures, provider-specific request/identity assumptions, missing synthetic Junction configuration, migration typing mistakes, an initially over-broad shared test resource override (now scoped to the named synthetic fixture), and a CLI timing assertion that compared two wall-clock-dependent JSON results. These were repaired in tests: Junction source-authority reads are counted explicitly, canonical records are asserted by their full live content, and the timing test freezes Date while preserving exact equality. The merged history fixture now derives all record dates and job windows from the history clock. No runtime behavior regression was found by the restored checks.

The first full assistant-runtime run failed (63 stale-fixture failures); the next full run had only three failures caused by the shared test resource override; the final full run below is the completion evidence. Focused retries and inspection probes are recorded honestly rather than presented as passing full-suite runs. Failed intermediate commands have been superseded by the final passing owner lane; no guard was bypassed.

Remaining limits: opt-in live Codex and PostgreSQL/concurrency lanes retain their existing skips. The restored Web epoch case is included in that opt-in PostgreSQL lane and was typechecked, not executed against a database. Provider traffic is synthetic; these tests do not prove live vendor availability. No remote exact-head CI or ReviewGPT was launched because this task explicitly forbids pushes and PRs. No changelog entry is needed for test-only coverage repair.

Every recorded verification invocation (including failed migration iterations):

| Run | Exact command | Exit/result |
| --- | --- | --- |
| `install` | `pnpm install` | 0 / PASS |
| `runtime-restored-initial` | `pnpm --dir packages/assistant-runtime exec vitest run test/hosted-device-sync-runtime.test.ts --no-coverage` | 1 / FAIL; superseded by final owner check |
| `build` | `pnpm build` | 0 / PASS |
| `runtime-migrated` | `pnpm --dir packages/assistant-runtime exec vitest run test/hosted-device-sync-runtime.test.ts --no-coverage` | 1 / FAIL; superseded by final owner check |
| `device-restored-focus` | `pnpm --dir packages/device-syncd exec vitest run test/config.test.ts test/provider-manifests.test.ts --no-coverage` | 1 / FAIL; superseded by final owner check |
| `runtime-migrated-2` | `pnpm --dir packages/assistant-runtime exec vitest run test/hosted-device-sync-runtime.test.ts --no-coverage` | 1 / FAIL; superseded by final owner check |
| `restored-focus` | `pnpm exec vitest run --no-coverage --config packages/device-syncd/vitest.config.ts packages/device-syncd/test/config.test.ts packages/device-syncd/test/provider-manifests.test.ts packages/device-syncd/test/provider-descriptor-integration.test.ts` | 0 / PASS |
| `runtime-focus-final` | `pnpm --dir packages/assistant-runtime exec vitest run test/hosted-device-sync-runtime.test.ts --no-coverage` | 1 / FAIL; superseded by final owner check |
| `retry-inspect` | `pnpm --dir packages/assistant-runtime exec vitest run test/hosted-device-sync-runtime.test.ts -t 'a version retry preserves' --no-coverage` | 1 / FAIL; superseded by final owner check |
| `retry-junction-resource` | `pnpm --dir packages/assistant-runtime exec vitest run test/hosted-device-sync-runtime.test.ts -t 'a version retry preserves' --no-coverage` | 1 / FAIL; superseded by final owner check |
| `retry-inspect-2` | `pnpm --dir packages/assistant-runtime exec vitest run test/hosted-device-sync-runtime.test.ts -t 'a version retry preserves' --no-coverage` | 1 / FAIL; superseded by final owner check |
| `contracts-typecheck` | `pnpm --dir packages/contracts typecheck` | 0 / PASS |
| `cloudflare-typecheck` | `pnpm --dir apps/cloudflare typecheck` | 0 / PASS |
| `contracts-test` | `pnpm --dir packages/contracts test` | 0 / PASS |
| `query-typecheck` | `pnpm --dir packages/query typecheck` | 0 / PASS |
| `restored-runtime-163` | `pnpm --dir packages/assistant-runtime exec vitest run test/hosted-device-sync-runtime.test.ts --no-coverage` | 0 / PASS |
| `device-syncd-typecheck` | `pnpm --dir packages/device-syncd typecheck` | 0 / PASS |
| `operator-config-typecheck` | `pnpm --dir packages/operator-config typecheck` | 0 / PASS |
| `cli-typecheck` | `pnpm --dir packages/cli typecheck` | 0 / PASS |
| `assistant-runtime-typecheck` | `pnpm --dir packages/assistant-runtime typecheck` | 2 / FAIL; superseded by final owner check |
| `assistant-engine-typecheck` | `pnpm --dir packages/assistant-engine typecheck` | 0 / PASS |
| `query-test` | `pnpm --dir packages/query test` | 0 / PASS |
| `importers-typecheck` | `pnpm --dir packages/importers typecheck` | 0 / PASS |
| `importers-test` | `pnpm --dir packages/importers test` | 0 / PASS |
| `web-typecheck` | `pnpm --dir apps/web typecheck` | 0 / PASS |
| `runtime-typecheck-final` | `pnpm --dir packages/assistant-runtime typecheck` | 0 / PASS |
| `verify-workspace-boundaries` | `pnpm verify:workspace-boundaries` | 0 / PASS |
| `verify-workspace-package-cycles` | `pnpm verify:workspace-package-cycles` | 0 / PASS |
| `deps-guard` | `pnpm deps:guard` | 0 / PASS |
| `no-js` | `pnpm no-js` | 0 / PASS |
| `device-syncd-full-test` | `pnpm --dir packages/device-syncd test` | 0 / PASS |
| `operator-config-full-test` | `pnpm --dir packages/operator-config test` | 0 / PASS |
| `web-focused` | `pnpm exec vitest run --config apps/web/vitest.workspace.ts apps/web/test/agent-session-service.test.ts apps/web/test/connect-source-routes.test.tsx apps/web/test/device-connect-intent-route.test.ts apps/web/test/device-connect-intents.test.ts apps/web/test/device-sync-app-policy.test.ts apps/web/test/device-sync-browser-callback-proof.test.ts apps/web/test/device-sync-callback-route.test.ts apps/web/test/device-sync-companion-address-book-route-composed-auth.test.ts apps/web/test/device-sync-companion-address-book-route.test.ts apps/web/test/device-sync-companion-admission-route.test.ts apps/web/test/device-sync-companion-initial-onboarding-route.test.ts apps/web/test/device-sync-companion-journal-route.test.ts apps/web/test/device-sync-companion-legal-consent-route.test.ts apps/web/test/device-sync-companion-manual-meal-photo-authority.test.ts apps/web/test/device-sync-companion-meal-photo-capture-access-postgres-concurrency.test.ts apps/web/test/device-sync-companion-meal-photo-capture-authority-migration-postgres.test.ts apps/web/test/device-sync-companion-meal-photo-capture-enrollment-crypto-boundary.test.ts apps/web/test/device-sync-companion-meal-photo-capture-enrollment-crypto-composition.test.ts apps/web/test/device-sync-companion-meal-photo-capture-enrollment.test.ts apps/web/test/device-sync-companion-meal-photo-capture-routes.test.ts apps/web/test/device-sync-companion-meal-photo-capture-validation.test.ts apps/web/test/device-sync-companion-meals-route.test.ts apps/web/test/device-sync-companion-routes.test.ts apps/web/test/device-sync-companion-signup-route.test.ts apps/web/test/device-sync-completion-dialog-client.test.ts apps/web/test/device-sync-connect-complete-page.test.ts apps/web/test/device-sync-connect-failure-alert.test.ts apps/web/test/device-sync-db-spike-resilience-postgres.test.ts apps/web/test/device-sync-dirty-account-deletion-concurrency.test.ts apps/web/test/device-sync-dirty-admission-consent-postgres.test.ts apps/web/test/device-sync-dirty-payload-classification-migration.test.ts apps/web/test/device-sync-dirty-payload-contract-migration-postgres.test.ts apps/web/test/device-sync-dirty-payload-rebinding.test.ts apps/web/test/device-sync-dirty-reconnect-ack-postgres.test.ts apps/web/test/device-sync-dirty-reconnect-consent-postgres.test.ts apps/web/test/device-sync-dirty-reconnect-retention-postgres.test.ts apps/web/test/device-sync-fitbit-migration-cutover-route.test.ts apps/web/test/device-sync-fitbit-migration-cutover.test.ts apps/web/test/device-sync-home-onboarding.test.ts apps/web/test/device-sync-hosted-reconcile.test.ts apps/web/test/device-sync-hosted-runtime-authority.test.ts apps/web/test/device-sync-hosted-wake.test.ts apps/web/test/device-sync-http.test.ts apps/web/test/device-sync-internal-connect-route.test.ts apps/web/test/device-sync-internal-runtime-apply-route.test.ts apps/web/test/device-sync-internal-runtime-routes.test.ts apps/web/test/device-sync-internal-runtime.test.ts apps/web/test/device-sync-junction-workout-diagnostic-route.test.ts apps/web/test/device-sync-messaging-return-route.test.ts apps/web/test/device-sync-prepared-webhook-authority-postgres.test.ts apps/web/test/device-sync-provider-label.test.ts apps/web/test/device-sync-providers.test.ts apps/web/test/device-sync-root-and-stripe-cron-routes.test.ts apps/web/test/device-sync-runtime-apply-secret-preparation.test.ts apps/web/test/device-sync-scheduled-reconcile-preflight.test.ts apps/web/test/device-sync-scheduled-wake-retention-postgres.test.ts apps/web/test/device-sync-settings-routes.test.ts apps/web/test/device-sync-settings-service.test.ts apps/web/test/device-sync-settings-surface.test.ts apps/web/test/device-sync-shared.test.ts apps/web/test/device-sync-source-delivery-stall-notice.test.ts apps/web/test/device-sync-voice-memos.test.ts apps/web/test/device-sync-webhook-batch-route.test.ts apps/web/test/device-sync-webhook-batch.test.ts apps/web/test/device-sync-webhook-preparation-contention-postgres.test.ts apps/web/test/device-sync-webhook-queue.test.ts apps/web/test/device-sync-webhook-traces.test.ts apps/web/test/hosted-automation-loss-alert-monitor.test.ts apps/web/test/hosted-connect-start.test.ts apps/web/test/hosted-device-sync-deferred-wake-sweeper.test.ts apps/web/test/hosted-device-sync-due-reconcile-sweeper.test.ts apps/web/test/hosted-device-sync-recovery-sweep-route.test.ts apps/web/test/hosted-device-sync-recovery-sweeper.test.ts apps/web/test/hosted-ops-device-sync-diagnostics.test.ts apps/web/test/hosted-runtime-maintenance-ops.test.ts apps/web/test/prisma-store-device-sync-signal.test.ts apps/web/test/settings-connected-account-card.test.ts apps/web/test/settings-page.test.ts apps/web/test/settings-sync-helpers.test.ts --no-coverage` | 1 / FAIL; superseded by final owner check |
| `cloudflare-full-node` | `pnpm --dir apps/cloudflare test:node` | 0 / PASS |
| `verify-cli` | `pnpm verify:cli` | 0 / PASS |
| `provider-requests-guard` | `pnpm provider-requests:guard` | 0 / PASS |
| `engine-focused` | `pnpm --dir packages/assistant-engine exec vitest run test/assistant-ask.test.ts test/assistant-automation-runtime.test.ts test/assistant-automation-support.test.ts test/assistant-cli-access.test.ts test/assistant-cli-surface-bootstrap.test.ts test/assistant-codex-real-e2e.test.ts test/assistant-codex-scripted-runtime.test.ts test/assistant-codex-turn-planning.test.ts test/assistant-cron-freshness.test.ts test/assistant-cron-runtime.test.ts test/assistant-game-tools.test.ts test/assistant-managed-group-skill-fallbacks.test.ts test/assistant-outbox-runtime.test.ts test/assistant-runtime-locking.test.ts test/assistant-tool-failure-diagnostics.test.ts test/assistant-usage-input-measurement.test.ts test/cli-timing-profile.test.ts test/knowledge-cli-guidance.test.ts test/managed-automations-core.test.ts test/managed-automations.test.ts test/system-prompt.dynamic-context.test.ts --no-coverage` | 0 / PASS |
| `cli-full-test` | `pnpm --dir packages/cli test` | 1 / FAIL; superseded by final owner check |
| `web-migration-1` | `pnpm exec vitest run --config apps/web/vitest.workspace.ts apps/web/test/device-connect-intent-route.test.ts apps/web/test/device-sync-internal-connect-route.test.ts apps/web/test/device-sync-root-and-stripe-cron-routes.test.ts apps/web/test/device-sync-settings-routes.test.ts apps/web/test/device-sync-hosted-wake.test.ts --no-coverage` | 1 / FAIL; superseded by final owner check |
| `runner-bundle` | `pnpm --dir apps/cloudflare runner:bundle` | 0 / PASS |
| `web-migration-2` | `pnpm exec vitest run --config apps/web/vitest.workspace.ts apps/web/test/device-sync-hosted-runtime-authority.test.ts apps/web/test/device-sync-internal-connect-route.test.ts apps/web/test/device-sync-settings-routes.test.ts --no-coverage` | 1 / FAIL; superseded by final owner check |
| `web-wake-migration` | `pnpm exec vitest run --config apps/web/vitest.workspace.ts apps/web/test/device-sync-hosted-wake.test.ts --no-coverage` | 1 / FAIL; superseded by final owner check |
| `web-repaired-six` | `pnpm exec vitest run --config apps/web/vitest.workspace.ts apps/web/test/device-connect-intent-route.test.ts apps/web/test/device-sync-internal-connect-route.test.ts apps/web/test/device-sync-root-and-stripe-cron-routes.test.ts apps/web/test/device-sync-settings-routes.test.ts apps/web/test/device-sync-hosted-wake.test.ts apps/web/test/device-sync-hosted-runtime-authority.test.ts --no-coverage` | 0 / PASS |
| `device-syncd-typecheck-final` | `pnpm --dir packages/device-syncd typecheck` | 0 / PASS |
| `web-typecheck-final` | `pnpm --dir apps/web typecheck` | 0 / PASS |
| `cli-typecheck-final` | `pnpm --dir packages/cli typecheck` | 0 / PASS |
| `runner-historical-focus` | `pnpm --dir packages/assistant-runtime exec vitest run test/hosted-runtime-workspace-runner.test.ts -t 'historical WHOOP' --no-coverage` | 1 / FAIL; superseded by final owner check |
| `runtime-merge-focus` | `pnpm --dir packages/assistant-runtime exec vitest run test/hosted-runtime-workspace-runner.test.ts test/hosted-runtime-workspace-entrypoint-scheduling.test.ts test/hosted-runtime-workspace-entrypoint-system-mailbox.test.ts --no-coverage` | 1 / FAIL; superseded by final owner check |
| `runner-historical-final` | `pnpm --dir packages/assistant-runtime exec vitest run test/hosted-runtime-workspace-runner.test.ts --no-coverage` | 0 / PASS |
| `device-syncd-full-test-final` | `pnpm --dir packages/device-syncd test` | 0 / PASS |
| `runtime-state-typecheck` | `pnpm --dir packages/runtime-state typecheck` | 0 / PASS |
| `runtime-state-loopback` | `pnpm --dir packages/runtime-state exec vitest run test/loopback-control-plane.test.ts --no-coverage` | 0 / PASS |
| `web-focused-final` | `pnpm exec vitest run --config apps/web/vitest.workspace.ts apps/web/test/agent-session-service.test.ts apps/web/test/connect-source-routes.test.tsx apps/web/test/device-connect-intent-route.test.ts apps/web/test/device-connect-intents.test.ts apps/web/test/device-sync-app-policy.test.ts apps/web/test/device-sync-browser-callback-proof.test.ts apps/web/test/device-sync-callback-route.test.ts apps/web/test/device-sync-companion-address-book-route-composed-auth.test.ts apps/web/test/device-sync-companion-address-book-route.test.ts apps/web/test/device-sync-companion-admission-route.test.ts apps/web/test/device-sync-companion-initial-onboarding-route.test.ts apps/web/test/device-sync-companion-journal-route.test.ts apps/web/test/device-sync-companion-legal-consent-route.test.ts apps/web/test/device-sync-companion-manual-meal-photo-authority.test.ts apps/web/test/device-sync-companion-meal-photo-capture-access-postgres-concurrency.test.ts apps/web/test/device-sync-companion-meal-photo-capture-authority-migration-postgres.test.ts apps/web/test/device-sync-companion-meal-photo-capture-enrollment-crypto-boundary.test.ts apps/web/test/device-sync-companion-meal-photo-capture-enrollment-crypto-composition.test.ts apps/web/test/device-sync-companion-meal-photo-capture-enrollment.test.ts apps/web/test/device-sync-companion-meal-photo-capture-routes.test.ts apps/web/test/device-sync-companion-meal-photo-capture-validation.test.ts apps/web/test/device-sync-companion-meals-route.test.ts apps/web/test/device-sync-companion-routes.test.ts apps/web/test/device-sync-companion-signup-route.test.ts apps/web/test/device-sync-completion-dialog-client.test.ts apps/web/test/device-sync-connect-complete-page.test.ts apps/web/test/device-sync-connect-failure-alert.test.ts apps/web/test/device-sync-db-spike-resilience-postgres.test.ts apps/web/test/device-sync-dirty-account-deletion-concurrency.test.ts apps/web/test/device-sync-dirty-admission-consent-postgres.test.ts apps/web/test/device-sync-dirty-payload-classification-migration.test.ts apps/web/test/device-sync-dirty-payload-contract-migration-postgres.test.ts apps/web/test/device-sync-dirty-payload-rebinding.test.ts apps/web/test/device-sync-dirty-reconnect-ack-postgres.test.ts apps/web/test/device-sync-dirty-reconnect-consent-postgres.test.ts apps/web/test/device-sync-dirty-reconnect-retention-postgres.test.ts apps/web/test/device-sync-fitbit-migration-cutover-route.test.ts apps/web/test/device-sync-fitbit-migration-cutover.test.ts apps/web/test/device-sync-home-onboarding.test.ts apps/web/test/device-sync-hosted-reconcile.test.ts apps/web/test/device-sync-hosted-runtime-authority.test.ts apps/web/test/device-sync-hosted-wake.test.ts apps/web/test/device-sync-http.test.ts apps/web/test/device-sync-internal-connect-route.test.ts apps/web/test/device-sync-internal-runtime-apply-route.test.ts apps/web/test/device-sync-internal-runtime-routes.test.ts apps/web/test/device-sync-internal-runtime.test.ts apps/web/test/device-sync-junction-workout-diagnostic-route.test.ts apps/web/test/device-sync-messaging-return-route.test.ts apps/web/test/device-sync-prepared-webhook-authority-postgres.test.ts apps/web/test/device-sync-provider-label.test.ts apps/web/test/device-sync-providers.test.ts apps/web/test/device-sync-root-and-stripe-cron-routes.test.ts apps/web/test/device-sync-runtime-apply-secret-preparation.test.ts apps/web/test/device-sync-scheduled-reconcile-preflight.test.ts apps/web/test/device-sync-scheduled-wake-retention-postgres.test.ts apps/web/test/device-sync-settings-routes.test.ts apps/web/test/device-sync-settings-service.test.ts apps/web/test/device-sync-settings-surface.test.ts apps/web/test/device-sync-shared.test.ts apps/web/test/device-sync-source-delivery-stall-notice.test.ts apps/web/test/device-sync-voice-memos.test.ts apps/web/test/device-sync-webhook-batch-route.test.ts apps/web/test/device-sync-webhook-batch.test.ts apps/web/test/device-sync-webhook-preparation-contention-postgres.test.ts apps/web/test/device-sync-webhook-queue.test.ts apps/web/test/device-sync-webhook-traces.test.ts apps/web/test/hosted-automation-loss-alert-monitor.test.ts apps/web/test/hosted-connect-start.test.ts apps/web/test/hosted-device-sync-deferred-wake-sweeper.test.ts apps/web/test/hosted-device-sync-due-reconcile-sweeper.test.ts apps/web/test/hosted-device-sync-recovery-sweep-route.test.ts apps/web/test/hosted-device-sync-recovery-sweeper.test.ts apps/web/test/hosted-ops-device-sync-diagnostics.test.ts apps/web/test/hosted-runtime-maintenance-ops.test.ts apps/web/test/prisma-store-device-sync-signal.test.ts apps/web/test/settings-connected-account-card.test.ts apps/web/test/settings-page.test.ts apps/web/test/settings-sync-helpers.test.ts --no-coverage` | 0 / PASS |
| `mailbox-cadence-focus` | `pnpm --dir packages/assistant-runtime exec vitest run test/hosted-runtime-workspace-entrypoint-system-mailbox.test.ts -t 'imports one bounded late device prefix: covered' --no-coverage` | 1 / FAIL; superseded by final owner check |
| `scheduling-empty-focus` | `pnpm --dir packages/assistant-runtime exec vitest run test/hosted-runtime-workspace-entrypoint-scheduling.test.ts -t 'e2e clears stale' --no-coverage` | 1 / FAIL; superseded by final owner check |
| `scheduling-empty-2` | `pnpm --dir packages/assistant-runtime exec vitest run test/hosted-runtime-workspace-entrypoint-scheduling.test.ts -t 'e2e clears stale' --no-coverage` | 0 / PASS |
| `mailbox-cadence-2` | `pnpm --dir packages/assistant-runtime exec vitest run test/hosted-runtime-workspace-entrypoint-system-mailbox.test.ts -t 'imports one bounded late device prefix: covered&#124;retains only necessary device work across restore' --no-coverage` | 1 / FAIL; superseded by final owner check |
| `mailbox-cadence-3` | `pnpm --dir packages/assistant-runtime exec vitest run test/hosted-runtime-workspace-entrypoint-system-mailbox.test.ts -t 'imports one bounded late device prefix: covered&#124;retains only necessary device work across restore' --no-coverage` | 1 / FAIL; superseded by final owner check |
| `mailbox-junction-migration` | `pnpm --dir packages/assistant-runtime exec vitest run test/hosted-runtime-workspace-entrypoint-system-mailbox.test.ts test/hosted-runtime-workspace-entrypoint-scheduling.test.ts --no-coverage` | 1 / FAIL; superseded by final owner check |
| `mailbox-paths` | `pnpm --dir packages/assistant-runtime exec vitest run test/hosted-runtime-workspace-entrypoint-system-mailbox.test.ts -t 'imports one bounded late device prefix: covered' --no-coverage` | 1 / FAIL; superseded by final owner check |
| `cli-full-test-final` | `pnpm --dir packages/cli test` | 0 / PASS |
| `mailbox-cadence-4` | `pnpm --dir packages/assistant-runtime exec vitest run test/hosted-runtime-workspace-entrypoint-system-mailbox.test.ts -t 'imports one bounded late device prefix: covered&#124;retains only necessary device work across restore' --no-coverage` | 1 / FAIL; superseded by final owner check |
| `runtime-integrations-migrate` | `pnpm --dir packages/assistant-runtime exec vitest run test/hosted-runtime-concurrent-device-import.integration.test.ts test/hosted-runtime-interrupted-system-recording.integration.test.ts --no-coverage` | 1 / FAIL; superseded by final owner check |
| `mailbox-cadence-5` | `pnpm --dir packages/assistant-runtime exec vitest run test/hosted-runtime-workspace-entrypoint-system-mailbox.test.ts -t 'imports one bounded late device prefix&#124;retains only necessary device work across restore' --no-coverage` | 1 / FAIL; superseded by final owner check |
| `concurrent-row-inspect` | `pnpm --dir packages/assistant-runtime exec vitest run test/hosted-runtime-concurrent-device-import.integration.test.ts -t 'with a completed concurrent' --no-coverage` | 1 / FAIL; superseded by final owner check |
| `mailbox-cadence-6` | `pnpm --dir packages/assistant-runtime exec vitest run test/hosted-runtime-workspace-entrypoint-system-mailbox.test.ts --no-coverage` | 1 / FAIL; superseded by final owner check |
| `assistant-runtime-full-test` | `pnpm --dir packages/assistant-runtime test` | 1 / FAIL; superseded by final owner check |
| `runtime-typecheck-migrations` | `pnpm --dir packages/assistant-runtime typecheck` | 2 / FAIL; superseded by final owner check |
| `runtime-typecheck-migrations-2` | `pnpm --dir packages/assistant-runtime typecheck` | 2 / FAIL; superseded by final owner check |
| `admission-one` | `pnpm --dir packages/assistant-runtime exec vitest run test/hosted-runtime-device-import-admission.test.ts -t 'default admission defers preparation and resumes after provider' --no-coverage` | 0 / PASS |
| `runtime-integration-small` | `pnpm --dir packages/assistant-runtime exec vitest run test/hosted-runtime-concurrent-device-import.integration.test.ts test/hosted-runtime-interrupted-system-recording.integration.test.ts test/hosted-runtime-workspace-entrypoint-progress-generation.test.ts --no-coverage` | 1 / FAIL; superseded by final owner check |
| `mailbox-current` | `pnpm --dir packages/assistant-runtime exec vitest run test/hosted-runtime-workspace-entrypoint-system-mailbox.test.ts --no-coverage` | 1 / FAIL; superseded by final owner check |
| `runtime-typecheck-final` | `pnpm --dir packages/assistant-runtime typecheck` | 0 / PASS |
| `complexity-diff` | `pnpm complexity:diff` | 0 / PASS |
| `runtime-integrations-2` | `pnpm --dir packages/assistant-runtime exec vitest run test/hosted-runtime-concurrent-device-import.integration.test.ts test/hosted-runtime-interrupted-system-recording.integration.test.ts test/hosted-runtime-workspace-entrypoint-progress-generation.test.ts test/hosted-runtime-device-import-admission.test.ts --no-coverage` | 1 / FAIL; superseded by final owner check |
| `docs-drift` | `pnpm docs:drift` | 0 / PASS |
| `runtime-repaired-focus` | `pnpm --dir packages/assistant-runtime exec vitest run test/hosted-runtime-workspace-entrypoint-system-mailbox.test.ts test/hosted-runtime-interrupted-system-recording.integration.test.ts test/hosted-runtime-workspace-entrypoint-progress-generation.test.ts test/hosted-runtime-device-import-admission.test.ts` | 1 / FAIL; superseded by final owner check |
| `mailbox-repaired` | `pnpm --dir packages/assistant-runtime exec vitest run test/hosted-runtime-workspace-entrypoint-system-mailbox.test.ts --no-coverage` | 1 / FAIL; superseded by final owner check |
| `mailbox-closed-loop-final` | `pnpm --dir packages/assistant-runtime exec vitest run test/hosted-runtime-workspace-entrypoint-system-mailbox.test.ts -t 'preserves one canonical schedule event' --no-coverage` | 0 / PASS |
| `runtime-typecheck-final-current` | `pnpm --dir packages/assistant-runtime typecheck` | 0 / PASS |
| `provider-requests-guard-final` | `pnpm provider-requests:guard` | 0 / PASS |
| `docs-drift-final` | `pnpm docs:drift` | 0 / PASS |
| `whitespace-check` | `git diff --check` | 0 / PASS |
| `runtime-scoped-fixture` | `pnpm --dir packages/assistant-runtime exec vitest run test/hosted-runtime-device-continuation.test.ts test/hosted-runtime-interrupted-system-recording.integration.test.ts test/hosted-runtime-workspace-entrypoint-progress-generation.test.ts test/hosted-runtime-workspace-entrypoint-system-mailbox.test.ts --no-coverage` | 1 / FAIL; superseded by final owner check |
| `assistant-runtime-full-test-final` | `pnpm --dir packages/assistant-runtime test` | 1 / FAIL; superseded by final owner check |
| `runtime-scoped-fixture-check` | `pnpm --dir packages/assistant-runtime exec vitest run test/hosted-runtime-device-continuation.test.ts test/hosted-runtime-workspace-entrypoint-system-mailbox.test.ts -t 'system mailbox history recheck&#124;preserves one canonical schedule event&#124;completion imports one bounded late' --no-coverage` | 1 / FAIL; superseded by final owner check |
| `runtime-scoped-key-check` | `pnpm --dir packages/assistant-runtime exec vitest run test/hosted-runtime-device-continuation.test.ts test/hosted-runtime-workspace-entrypoint-system-mailbox.test.ts -t 'system mailbox history recheck&#124;preserves one canonical schedule event&#124;completion imports one bounded late' --no-coverage` | 0 / PASS |
| `runtime-typecheck-complete` | `pnpm --dir packages/assistant-runtime typecheck` | 0 / PASS |
| `docs-drift-reviewed` | `pnpm docs:drift` | 0 / PASS |
| `whitespace-reviewed` | `git diff --check` | 0 / PASS |
| `assistant-runtime-full-test-complete` | `pnpm --dir packages/assistant-runtime test` | 0 / PASS |

Final candidate review: only the intended 30 test/plan files changed. The retained branch-touched assistant-engine file inventory matches the 21-file focused run exactly. AST inspection found zero `as any` or `as unknown` casts in changed TypeScript files; added-content privacy inspection passed. The commit is local only and uses the owner-requested co-author trailer.


## PR 4469 CI repair and full-suite verification amendment

Owner-authorized amendment to this completed plan. Starting head: `e52cde83b9`;
stacked base: `c04ccc04cc`. This repair changes test fixtures and this ledger only.
No production behavior change, push, publishing, production access, or work in
another checkout is authorized or performed. No member-visible changelog is needed.

### Managed-registry decrement proof

Compared `src/assistant/managed-automations.ts`, `managed-automation-ids.ts`,
and the imported usage-optimizer seed at the exact base and starting head.
The registered seed inventory is:

| Seed | ID | Base | Head |
| --- | --- | --- | --- |
| weekly usage optimizer | `automation_01K7A8B9C0D1E2F3G4H5J6K7MN` | seeded | seeded |
| journal connected context morning | `automation_01M1J7C8M0RN1NGC0NT3XT7D2A` | seeded | seeded |
| weekly health digest | `automation_01JNW7YJ7MNE7M9Q2QWQK4Z3FY` | seeded | seeded |
| weekly health insight | `automation_X3GPAWV2CCHNCYHAAJ4CE2M144` | seeded | seeded |
| monthly improvement coach | `automation_01K2WKKY3F8Q4R5S6T7V8W9XAB` | seeded | seeded |
| weekly health research scout | `automation_01K0EXA5C0VT9F7X3KG6JMPZ5A` | seeded | retired tombstone |
| overnight memory consolidation | `automation_01K4Y0Q5C8M9N2P3R4S5T6V7WX` | seeded | seeded |
| group room model consolidation | `automation_01K4Z8RMM6F7G8H9J0K1P2M3N4` | seeded | seeded |

Set difference is exactly `automation_01K0EXA5C0VT9F7X3KG6JMPZ5A` (research scout);
no IDs were added or otherwise removed. The separate automatic-meal-closeout
maintenance seed `automation_01KZZM3A9C7P4R6T8V2W5X0YQZ` is unchanged.
The support-gap tests use a non-hosted private route: the unchanged eligible
recurring seeds are digest, insight, and monthly coach. Scout made four at the
base; retirement makes three. Adding the dynamic support-gap one-shot therefore
changes five to four; reconciling an existing one-shot changes four skipped
recurring seeds to three. Hosted-only seeds and group-only ownership are unchanged.

### Failing-test disposition

- `hosted-account-data-service.test.ts`: removed the unused mock of the deleted
  Strava export. OAuth cleanup fixtures use `synthetic_oauth` and its corresponding
  label, retaining every export, deletion, credential, refresh-lease, confirmation,
  revoke-hook, webhook-authority, and retry assertion. Junction cleanup remains.
- Reconnect-link test `refuses an ambiguous WHOOP target when direct and Junction
  routes are configured`: deleted because its only subject was the retired
  two-transport configuration. Inspected the full route catalog and target
  collector. The apparent two-route Fitbit alternative is also not a live
  ambiguity: `fitbit` normalizes to `google_health` and the filter deduplicates.
  WHOOP source-slug resolution, disabled Strava, and intent creation remain tested.
- Connect-page `surfaces reauthorization-required sources as reconnectable`: uses
  a Junction connection with explicit WHOOP source identity; retains reconnect
  copy, needs-access state, and absence of connect/disconnect actions.
- Connect-page `keeps disconnected sources quiet and connectable`: uses the same
  Junction routing; retains idle state, Connect action, and no reconnect warning
  or disconnect action.
- Connect-page `surfaces active sources with reconnect action as reconnectable`:
  migrates the active primary-action fixture to Junction and retains all seven
  state, copy, and action assertions.
- Both neutral recovery failures (`connected=false`, `CALLBACK_PROOF_INVALID` and
  `OAUTH_STATE_INVALID`): configure Junction Oura and return Junction callback
  metadata. All four parameterized cases remain, including `connected=true`,
  neutral status copy, no false disconnection claim, and the correct card action.
- `Vital disclosure follows reconnect and fresh providers across local
  disconnects`: both Oura and WHOOP now reconnect through Junction and require
  Vital disclosure before and after local disconnect. Retains all source, route,
  disclosure, and preflight assertions with current route expectations. The
  dedicated Fitbit disclosure exemption remains covered.
- Support-gap `installs the one-shot idempotently through the managed registry`:
  created/skipped 5 becomes 4; schedule, route, active state, tags, and title remain.
- `requires a managed occurrence to match the current completion window`:
  skipped 4 becomes 3; updated 1, matching window, and reconciled schedule remain.
- `keeps an installed catch-up and its original private route stable`: created
  and skipped 5 become 4; original catch-up time and private route remain asserted.
- `retires a superseded active 21-day check instead of sending stale support`:
  created 4 becomes 3; updated 1 and retirement assertions remain.
- `does not reactivate` paused and archived support-gap one-shots: skipped 5
  becomes 4 in each variant; both lifecycle assertions remain.
- `keeps unrelated managed setup alive when onboarding state is malformed`:
  created 4 becomes 3; unrelated setup and malformed-state handling remain.

### Additional fixture audit

Scanned all 2,778 JS/TS/shell test and script files under `apps/**/test`,
`packages/**/test`, `scripts/**`, and `e2e/**`. Compared static imports, dynamic
imports, requires, and module mocks against 105 deleted paths and six removed
package exports between the base and starting head: zero removed-module imports
remain after this repair. Also searched provider credentials, direct-provider
fixtures, research-scout, Exa, daemon, HTTP, and bin references.

- Migrated remaining connect-page matching and recovery fixtures to explicit
  Junction source identities; moved immediate intent redemption and the one-click
  no-Vital case to the retained dedicated Fitbit flow. Kept all action assertions.
- Removed unused direct OAuth credentials from settings-route, internal-connect,
  connect-intent, and connect-page fixtures already exercising Junction; updated
  misleading test titles. Public source labels in route responses remain intact.
- Removed retired daemon commands from the synthetic assistant CLI contract while
  preserving hosted action filtering and the non-hosted equality assertion.
- Changed the runner boot-closure forbidden-provider fixture from the deleted
  Oura module to the retained Junction module; kept the exclusion assertion.
- Migrated the opt-in hosted-local device-wake E2E fixture to Junction and removed
  unused direct-WHOOP credentials. Its live full-stack execution was not run;
  Cloudflare typecheck validates the fixture.
- Retained provider-labelled normalizers, wearable data provenance, historical
  OAuth/Prisma storage, synthetic defensive snapshot cases, retired-scout
  tombstones, forbidden-secret tests, and negative module-boundary examples.
  Those are live retained contracts, not imports or configuration of deleted
  transports. Exa negative forwarding assertions and scout retirement coverage
  are intentional. No production source was edited.

### Full-suite verification ledger

Commands below ran from the authorized worktree. `MURPH_VITEST_MAX_WORKERS=2`
bounds local concurrency without selecting a subset. Web used the same
`apps/web/vitest.workspace.ts` and all five projects as Release Web tests:
`hosted-web-onboarding-integrations`, `hosted-web-onboarding-core`,
`hosted-web-execution`, `hosted-web-sync-settings`, and `hosted-web-store-config`.
The aggregate run covers all four CI shards. `*.db.test.ts` is excluded by that
CI workspace itself. No PostgreSQL proof opt-ins were enabled locally.

Coverage gates retain their configured values: statements/lines 80%,
functions 80%, branches 70%; CLI uses functions 70% and branches 55%. No gate
was changed. Both statements and lines exceeded 80% in every completed package run.

| Command | Passed / failed / skipped | Coverage statements / branches / functions / lines |
| --- | --- | --- |
| `env MURPH_VITEST_MAX_WORKERS=2 pnpm exec vitest run --config apps/web/vitest.workspace.ts --no-coverage` | 13719 / 0 / 1533 | not requested |
| `env MURPH_VITEST_FILE_PARALLELISM=1 MURPH_VITEST_MAX_WORKERS=2 pnpm --dir packages/assistant-engine test:coverage` | 5950 / 0 / 710 | 91.38% / 85.83% / 95.25% / 91.58% |
| `pnpm exec vitest run --config scripts/vitest.config.ts --no-coverage` | 864 / 27 / 0 | not requested |
| `env MURPH_VITEST_MAX_WORKERS=2 pnpm --dir packages/device-syncd test:coverage` | 1456 / 0 / 0 | 90.51% / 83.92% / 94.66% / 90.65% |
| `env MURPH_VITEST_MAX_WORKERS=2 pnpm --dir packages/operator-config test:coverage` | 439 / 0 / 0 | 90.82% / 80.77% / 93.87% / 90.95% |
| `env MURPH_PREPARED_CLI_RUNTIME_ARTIFACTS=1 MURPH_VITEST_MAX_WORKERS=2 pnpm exec vitest run --config packages/cli/vitest.workspace.ts --coverage` | 1293 / 0 / 0 | 89.28% / 79.59% / 93.29% / 89.66% |
| `env MURPH_VITEST_MAX_WORKERS=2 pnpm --dir packages/contracts test:coverage` | 403 / 0 / 0 | 89.27% / 78.91% / 91.69% / 89.4% |
| `env MURPH_VITEST_MAX_WORKERS=2 pnpm --dir packages/query test:coverage` | 808 / 0 / 1 | 91.26% / 81.55% / 95.39% / 91.91% |
| `env MURPH_VITEST_MAX_WORKERS=2 pnpm --dir packages/importers test:coverage` | 753 / 0 / 0 | 91.99% / 85.24% / 96.71% / 92.64% |
| `env MURPH_VITEST_MAX_WORKERS=2 pnpm --dir packages/runtime-state test:coverage` | 302 / 0 / 19 | 86.91% / 82.55% / 94.15% / 87.19% |
| `env MURPH_VITEST_MAX_WORKERS=2 pnpm --dir packages/hosted-execution test:coverage` | 891 / 0 / 3 | 82.98% / 77.14% / 85.43% / 83.75% |
| `env MURPH_VITEST_MAX_WORKERS=2 pnpm --dir packages/assistant-runtime test:coverage` | 3893 / 2 / 7 | 91.15% / 86.63% / 94.45% / 91.61% |

Repo-tools reproduced exactly 27 known local privacy-hook failures (20 dependency
context and seven native context cases), with 864 passing and no skips. Both
`scripts/review-gpt-dependency-context.test.ts` and
`scripts/review-gpt-native-context.test.ts`, plus their corresponding implementation
scripts, are byte-for-byte identical to `origin/main` at `1491685af1`. The hook
rejects the synthetic `fixture@example.invalid` commit email before the tests'
subject executes. No hook or fixture was weakened. This is source-identity proof
against origin/main, not a claim of running tests in another checkout.

The first runtime coverage run failed two of five dirty-ack follow-up variants
with `HOSTED_VAULT_SHARE_PROJECTION_FAILED`; coverage still exceeded all gates.
The exact five-case focused rerun passed unchanged (5 passed, 78 filtered skips).
The affected projection and system-mailbox production owners are unchanged from
the stacked base. The final full coverage rerun passed unchanged, as recorded below.
No production regression has been established by this transient failure.

Focused repaired Web verification: 286/0/0 across six complete test files.
Focused assistant-engine verification: 39/0/0 across support-gap and CLI bootstrap
files. Runner boot-closure verification: 40/0/0. Web, assistant-engine, and
Cloudflare typechecks passed. The initial Cloudflare focused invocation named a
nonexistent config and failed before collection; the corrected root command used
`--config apps/cloudflare/vitest.node.workspace.ts` and passed all 40 tests.
Early repair iterations exposed six then one fixture mismatch; all are superseded
by the focused green runs and full Web result above.

Final full reruns:

| Command | Passed / failed / skipped | Result |
| --- | --- | --- |
| `env MURPH_VITEST_MAX_WORKERS=2 pnpm --dir packages/assistant-runtime test:coverage` | 3895 / 0 / 7 | PASS; statements 91.13%, branches 86.61%, functions 94.43%, lines 91.59% |
| `env MURPH_VITEST_MAX_WORKERS=2 pnpm exec vitest run --config apps/web/vitest.workspace.ts --no-coverage --reporter=verbose` | 13719 / 0 / 1533 | PASS; 849 passing files, 132 wholly skipped files; verbose rerun closes the exact skip-inventory evidence gap |
| `pnpm docs:drift` | not a test-case suite | PASS |
| `pnpm complexity:diff` | not a test-case suite | PASS; no production complexity added by this repair |
| `pnpm --dir apps/web typecheck` | not a test-case suite | PASS |
| `pnpm --dir packages/assistant-engine typecheck` | not a test-case suite | PASS |
| `pnpm --dir apps/cloudflare typecheck` | not a test-case suite | PASS |

The transient runtime failure is recorded in
`.agents/friction-log/20261102172154-mailbox-dirty-ack/friction.md`; no claim of
a deterministic reproduction or proven concurrency cause is made. No new
production regression was found. Review of the final diff found zero production
source edits, zero added unsafe casts, and no added personal identifiers.

Final assertion-site audit: every edited test file retains its original number
of `expect`/`assert` sites except the reconnect-link file, which loses exactly the
two assertions belonging to the single retired direct-versus-Junction ambiguity
case. Connect-page retains 733 sites, account-data 433, and support-gap 48.

Commit is prepared but pending resolution of an explicit scope conflict:
`scripts/committer` calls `scripts/install-git-hooks`, which invokes the primary
checkout's storage guard and its read-only Git metadata queries. The task forbids
Git in other checkouts. No guard bypass, cross-checkout query, or commit was
attempted while awaiting the owner's narrow decision. No push was performed.

### Exact Web skipped-case inventory

The final verbose full run reported 1,533 skipped cases in 142 files (132 wholly
skipped files and ten files containing both executed and skipped cases). Of
these, 1,482 cases in 136 files require opted-in PostgreSQL proof. The remaining
51 cases require browser/live-service/build fixtures or are explicitly skipped
instrumentation cases. The table names every file and skipped-case count; names
are relative to `apps/web/test/`. `*.db.test.ts` files are outside this CI suite.

| Test file | Skipped cases | Gate |
| --- | ---: | --- |
| `approval-passkey-postgres-concurrency.test.ts` | 10 | PostgreSQL opt-in |
| `better-auth-adapter-postgres-concurrency.test.ts` | 20 | PostgreSQL opt-in |
| `better-auth-member-postgres-concurrency.test.ts` | 107 | PostgreSQL opt-in |
| `better-auth-sms-postgres-concurrency.test.ts` | 7 | PostgreSQL opt-in |
| `better-auth-telegram-postgres-concurrency.test.ts` | 23 | PostgreSQL opt-in |
| `browser-assertion-nonce-postgres-concurrency.test.ts` | 3 | PostgreSQL opt-in |
| `clinical-records-account-deletion-postgres-concurrency.test.ts` | 18 | PostgreSQL opt-in |
| `companion-meal-upload-links-postgres.test.ts` | 1 | PostgreSQL opt-in |
| `device-sync-companion-meal-photo-capture-access-postgres-concurrency.test.ts` | 8 | PostgreSQL opt-in |
| `device-sync-companion-meal-photo-capture-authority-migration-postgres.test.ts` | 1 | PostgreSQL opt-in |
| `device-sync-db-spike-resilience-postgres.test.ts` | 8 | PostgreSQL opt-in |
| `device-sync-dirty-account-deletion-concurrency.test.ts` | 14 | PostgreSQL opt-in |
| `device-sync-dirty-admission-consent-postgres.test.ts` | 4 | PostgreSQL opt-in |
| `device-sync-dirty-payload-contract-migration-postgres.test.ts` | 5 | PostgreSQL opt-in |
| `device-sync-dirty-reconnect-ack-postgres.test.ts` | 2 | PostgreSQL opt-in |
| `device-sync-dirty-reconnect-consent-postgres.test.ts` | 2 | PostgreSQL opt-in |
| `device-sync-dirty-reconnect-retention-postgres.test.ts` | 1 | PostgreSQL opt-in |
| `device-sync-prepared-webhook-authority-postgres.test.ts` | 17 | PostgreSQL opt-in |
| `device-sync-scheduled-wake-retention-postgres.test.ts` | 43 | PostgreSQL opt-in |
| `device-sync-webhook-preparation-contention-postgres.test.ts` | 4 | PostgreSQL opt-in |
| `game-account-deletion-postgres.test.ts` | 10 | PostgreSQL opt-in |
| `game-api-postgres.test.ts` | 8 | PostgreSQL opt-in |
| `game-cancellation-bootstrap-postgres.test.ts` | 2 | PostgreSQL opt-in |
| `game-change-cancelled-postgres.test.ts` | 13 | PostgreSQL opt-in |
| `game-changes-postgres.test.ts` | 33 | PostgreSQL opt-in |
| `game-chat-access-postgres.test.ts` | 4 | PostgreSQL opt-in |
| `game-chat-allowance-postgres.test.ts` | 1 | PostgreSQL opt-in |
| `game-chat-bootstrap-recovery-postgres.test.ts` | 2 | PostgreSQL opt-in |
| `game-chat-progress-postgres.test.ts` | 4 | PostgreSQL opt-in |
| `game-chat-setup-postgres.test.ts` | 16 | PostgreSQL opt-in |
| `game-day-incomplete-postgres.test.ts` | 4 | PostgreSQL opt-in |
| `game-late-recap-postgres.test.ts` | 16 | PostgreSQL opt-in |
| `game-negotiation-postgres.test.ts` | 18 | PostgreSQL opt-in |
| `game-report-block-postgres.test.ts` | 11 | PostgreSQL opt-in |
| `game-service-postgres.test.ts` | 62 | PostgreSQL opt-in |
| `hosted-accepted-attempt-recheck-postgres-concurrency.test.ts` | 1 | PostgreSQL opt-in |
| `hosted-ai-usage-overshoot-alert-monitor-postgres.test.ts` | 1 | PostgreSQL opt-in |
| `hosted-assistant-ask-retention-postgres.test.ts` | 2 | PostgreSQL opt-in |
| `hosted-automation-loss-alert-monitor-postgres.test.ts` | 7 | PostgreSQL opt-in |
| `hosted-billing-browser-hydration.test.ts` | 3 | browser opt-in |
| `hosted-callback-request-nonce-postgres-concurrency.test.ts` | 6 | PostgreSQL opt-in |
| `hosted-checkpoint-recovery-postgres.test.ts` | 5 | PostgreSQL opt-in |
| `hosted-cold-ingest-migration.test.ts` | 1 | PostgreSQL opt-in |
| `hosted-current-sender-assistant-ask-postgres.test.ts` | 10 | PostgreSQL opt-in |
| `hosted-email-public-bootstrap-postgres-concurrency.test.ts` | 1 | PostgreSQL opt-in |
| `hosted-execution-usage-period-postgres.test.ts` | 1 | PostgreSQL opt-in |
| `hosted-execution-usage-postgres-concurrency.test.ts` | 4 | PostgreSQL opt-in |
| `hosted-feedback-task-migration-postgres.test.ts` | 1 | PostgreSQL opt-in |
| `hosted-group-join-outreach-reply-recovery-postgres.test.ts` | 40 | PostgreSQL opt-in |
| `hosted-group-private-observations-postgres.test.ts` | 1 | PostgreSQL opt-in |
| `hosted-group-start-recovery-postgres.test.ts` | 6 | PostgreSQL opt-in |
| `hosted-growth-aggregate-migration.test.ts` | 1 | PostgreSQL opt-in |
| `hosted-headed-browser-smoke.test.ts` | 17 | headed browser opt-in |
| `hosted-linq-invite-deletion-contract-migration-postgres.test.ts` | 1 | PostgreSQL opt-in |
| `hosted-linq-live-invite-source-ref-postgres.test.ts` | 2 | PostgreSQL opt-in |
| `hosted-linq-provider-health-contract-migration-postgres.test.ts` | 1 | PostgreSQL opt-in |
| `hosted-linq-reaction-exact-consume-postgres.test.ts` | 1 | PostgreSQL opt-in |
| `hosted-linq-rich-link-partial-postgres.test.ts` | 27 | PostgreSQL opt-in |
| `hosted-local-runtime-initialization-postgres.test.ts` | 3 | PostgreSQL opt-in |
| `hosted-mailbox-content-retention-migration-postgres.test.ts` | 1 | PostgreSQL opt-in |
| `hosted-mailbox-engagement-postgres.test.ts` | 1 | PostgreSQL opt-in |
| `hosted-mailbox-progress-postgres.test.ts` | 1 | PostgreSQL opt-in |
| `hosted-mailbox-usage-denial-postgres.test.ts` | 1 | PostgreSQL opt-in |
| `hosted-member-access-postgres.test.ts` | 1 | PostgreSQL opt-in |
| `hosted-onboarding-companion-enrollment-postgres.test.ts` | 4 | PostgreSQL opt-in |
| `hosted-onboarding-linq-chat-health-inventory-postgres.test.ts` | 3 | PostgreSQL opt-in |
| `hosted-onboarding-linq-email-identity-migration-postgres.test.ts` | 8 | PostgreSQL opt-in |
| `hosted-onboarding-linq-home-routing-postgres.test.ts` | 33 | PostgreSQL opt-in |
| `hosted-onboarding-linq-instant-first-turn-real-model.test.ts` | 18 | real-model opt-in |
| `hosted-onboarding-linq-opening-history-postgres.test.ts` | 1 | PostgreSQL opt-in |
| `hosted-onboarding-linq-participant-addition-concurrency.test.ts` | 25 | PostgreSQL opt-in |
| `hosted-onboarding-linq-phone-number-inventory-postgres.test.ts` | 12 | PostgreSQL opt-in |
| `hosted-onboarding-linq-production-canary-reset-postgres.test.ts` | 3 | PostgreSQL opt-in |
| `hosted-onboarding-linq-recent-message-load-postgres.test.ts` | 1 | PostgreSQL opt-in |
| `hosted-onboarding-linq-terminal-retry-postgres.test.ts` | 81 | PostgreSQL opt-in |
| `hosted-onboarding-member-lock-postgres.test.ts` | 31 | PostgreSQL opt-in |
| `hosted-onboarding-telegram-activation-postgres.test.ts` | 2 | PostgreSQL opt-in |
| `hosted-onboarding-telegram-routing-postgres.test.ts` | 5 | PostgreSQL opt-in |
| `hosted-operator-task-retention-postgres.test.ts` | 1 | PostgreSQL opt-in |
| `hosted-ops-app-review-game-postgres.test.ts` | 9 | PostgreSQL opt-in |
| `hosted-ops-app-review-member-postgres.test.ts` | 6 | PostgreSQL opt-in |
| `hosted-ops-growth-canary-postgres.test.ts` | 1 | PostgreSQL opt-in |
| `hosted-ops-growth-sponsorship-postgres.test.ts` | 1 | PostgreSQL opt-in |
| `hosted-ops-usage-reset-postgres.test.ts` | 10 | PostgreSQL opt-in |
| `hosted-paid-usage-legacy-period-cutover-migration.test.ts` | 1 | PostgreSQL opt-in |
| `hosted-pending-group-setup-postgres-concurrency.test.ts` | 4 | PostgreSQL opt-in |
| `hosted-phone-welcome.test.ts` | 1 | PostgreSQL opt-in |
| `hosted-preference-handoff-sweeper-postgres.test.ts` | 15 | PostgreSQL opt-in |
| `hosted-production-500-regressions-postgres.test.ts` | 1 | PostgreSQL opt-in |
| `hosted-retention-control-artifacts-postgres-concurrency.test.ts` | 8 | PostgreSQL opt-in |
| `hosted-runtime-access-postgres-concurrency.test.ts` | 1 | PostgreSQL opt-in |
| `hosted-runtime-callback-query-load-postgres.test.ts` | 2 | PostgreSQL opt-in |
| `hosted-runtime-cleanup-enrollment-postgres.test.ts` | 10 | PostgreSQL opt-in |
| `hosted-runtime-final-reply-delivery-alert-postgres.test.ts` | 2 | PostgreSQL opt-in |
| `hosted-runtime-latency-alert-query-postgres.test.ts` | 3 | PostgreSQL opt-in |
| `hosted-runtime-latency-postgres-concurrency.test.ts` | 10 | PostgreSQL opt-in |
| `hosted-runtime-log-postgres-concurrency.test.ts` | 12 | PostgreSQL opt-in |
| `hosted-runtime-materialization-postgres.test.ts` | 19 | PostgreSQL opt-in |
| `hosted-runtime-member-cutover-postgres.test.ts` | 16 | PostgreSQL opt-in |
| `hosted-runtime-member-migration-postgres.test.ts` | 8 | PostgreSQL opt-in |
| `hosted-runtime-migration-postgres.test.ts` | 1 | PostgreSQL opt-in |
| `hosted-runtime-owner-postgres.test.ts` | 91 | PostgreSQL opt-in |
| `hosted-runtime-progress-alert-monitor-postgres.test.ts` | 14 | PostgreSQL opt-in |
| `hosted-runtime-query-load-postgres.test.ts` | 1 | PostgreSQL opt-in |
| `hosted-runtime-retirement-cardinality-postgres.test.ts` | 1 | PostgreSQL opt-in |
| `hosted-runtime-runaway-alert-monitor-postgres.test.ts` | 22 | PostgreSQL opt-in |
| `hosted-runtime-typing-alert-postgres.test.ts` | 22 | PostgreSQL opt-in |
| `hosted-signup-notification-context-migration-postgres.test.ts` | 1 | PostgreSQL opt-in |
| `hosted-signup-referral-postgres-concurrency.test.ts` | 8 | PostgreSQL opt-in |
| `hosted-starter-usage-migration-postgres.test.ts` | 1 | PostgreSQL opt-in |
| `hosted-stripe-webhook-entitlement-postgres.test.ts` | 14 | PostgreSQL opt-in |
| `hosted-thread-container-participant-reconcile-postgres.test.ts` | 2 | PostgreSQL opt-in |
| `hosted-tool-failure-health-postgres.test.ts` | 28 | PostgreSQL opt-in |
| `hosted-usage-allowance-postgres.test.ts` | 6 | PostgreSQL opt-in |
| `hosted-usage-credit-account-deletion-postgres.test.ts` | 1 | PostgreSQL opt-in |
| `hosted-usage-credit-postgres-concurrency.test.ts` | 46 | PostgreSQL opt-in |
| `hosted-usage-diagnostics-postgres.test.ts` | 1 | PostgreSQL opt-in |
| `hosted-usage-plan-reset-postgres.test.ts` | 7 | PostgreSQL opt-in |
| `hosted-usage-plan-transition-bridge-migration-postgres.test.ts` | 1 | PostgreSQL opt-in |
| `hosted-usage-referral-recovery-postgres.test.ts` | 1 | PostgreSQL opt-in |
| `hosted-vault-share-grant-lifecycle-postgres-concurrency.test.ts` | 1 | PostgreSQL opt-in |
| `hosted-vault-share-projection-deadline-postgres.test.ts` | 2 | PostgreSQL opt-in |
| `hosted-workspace-checkpoint-postgres.test.ts` | 6 | PostgreSQL opt-in |
| `initial-onboarding-postgres-concurrency.test.ts` | 3 | PostgreSQL opt-in |
| `instrumentation.test.ts` | 2 | explicit skip |
| `legal-consent-postgres.test.ts` | 6 | PostgreSQL opt-in |
| `linq-line-lock-order-diagnostic.test.ts` | 7 | PostgreSQL opt-in |
| `next-config-workflow.test.ts` | 1 | build-manifest opt-in |
| `openai-only-contract-migration-postgres.test.ts` | 1 | PostgreSQL opt-in |
| `outbound-message-volume-postgres-concurrency.test.ts` | 1 | PostgreSQL opt-in |
| `phone-calls-game-allowance-postgres.test.ts` | 2 | PostgreSQL opt-in |
| `phone-calls-legacy-deletion-postgres.test.ts` | 19 | PostgreSQL opt-in |
| `physical-notes-postgres-concurrency.test.ts` | 18 | PostgreSQL opt-in |
| `prisma-database-retry-postgres.test.ts` | 15 | PostgreSQL opt-in |
| `prisma-store-pool-timing-postgres.test.ts` | 4 | PostgreSQL opt-in |
| `prisma-timezone-postgres.test.ts` | 1 | PostgreSQL opt-in |
| `runtime-recheck-verification-postgres.test.ts` | 1 | PostgreSQL opt-in |
| `settings-privacy-delete-postgres.test.ts` | 1 | PostgreSQL opt-in |
| `starter-growth-activity-postgres.test.ts` | 2 | PostgreSQL opt-in |
| `supplements-search-live.test.ts` | 10 | live labels database opt-in |
| `supplements-search-postgres.test.ts` | 142 | PostgreSQL opt-in |
| `terra-model-reset-postgres.test.ts` | 1 | PostgreSQL opt-in |

## Round 3 accepted Complexity Collapse: one connect target enumeration

Owner-authorized amendment at starting head `e5e58c1d9e`. Implements only the
accepted obsolete connect/reconnect arbitration finding. Work stays in the
assigned deletion branch; the parent owns pushing, CI and subsequent ReviewGPT.
No production access, deployment, persistence migration or changelog is needed:
this removes unreachable process-local distinctions without changing behavior.

### Independent pre-deletion proof

A source-module probe ran before deletion: 1,662 configurations over all 28 Link
slugs produced deeply identical ordered connect/reconnect arrays, unique in each
of `connectSourceId`, `connectTarget`, and `sourceProviderSlug`. Cases include
absent configuration, undefined/empty defaults, the complete catalog forward and
reversed, doubled catalog, every singleton, repeated singleton, uppercase/trimmed
singleton, every ordered pair and repeated pair, and both Fitbit/successor orders.
Six rejection checks (three invalid filters through both APIs) passed.

The structural argument covers arbitrary-length admissible filters: normalization
rejects non-Link slugs, rewrites `fitbit` to `google_health`, and keeps first
occurrences. The resulting 27-entry catalog is injective in all three selector
dimensions. Every admitted filter therefore selects an ordered subset of that
catalog; there is no competing route to arbitrate. The retained regression checks
freeze the complete ordered tuples and sweep singleton/pair/repetition inputs.

### Implementation and protected boundaries

- `device-syncd/src/config/connect-targets.ts`: sole enumeration, with duplicate
  options/map and collector removed. Existing key normalization remains.
- `device-syncd/src/config.ts` and `src/connect-config.ts`: remove the retired
  export; migrate all consumers to `listConfiguredDeviceSyncConnectTargets`.
- `assistant-runtime/src/hosted-runtime/workspace-assistant-phase.ts`: remove
  the second enumeration, two maps, tuple-safety helper and derived flags.
  Keep source availability and `normalizeHostedDeviceSyncConnectTargetKey`,
  which still serves device-command lookup.
- `assistant-runtime/src/hosted-runtime/device-sync-status-prompt.ts`: remove
  ambiguity/safety fields, derived notice flag, helper and unreachable text.
  Disabled-source, missing-target and historical-reset guidance remain intact.
- Web `reconnect-link-tool.ts`: find the single target, remove the ambiguous
  variant and error; retain every selector comparison and availability gate.
- Web claim route, source-start route, settings service and the PostgreSQL
  resilience fixture: enumeration rename only. Claim-time provider/source ID/
  connect target/source slug tuple comparison and member authorization remain.

### Prompt and test disposition

Reachable prompt text is unchanged. Before editing, captured rendered output
from the original builder; after editing, compared exact strings for 314,118
combinations (1,662 configurations × nine source identities × seven error states
× three account states). Included ordinary reconnect errors, historical-reset,
disabled sources, missing target, account reauthorization, disconnection, and
both persisted Fitbit identities. Every output matched byte-for-byte. The same
probe also checked every resulting target tuple against the pre-edit capture.
No digest or inline snapshot was regenerated. Because provider-visible text,
tools and behavior are unchanged, no new stochastic model journey is required.

Deleted exactly two prompt test declarations:

1. `does not render ambiguous generic commands for duplicate WHOOP reconnect targets`:
   only tests retired direct/Junction competition and an impossible ambiguity flag.
2. `does not render a source-specific Junction command when the public target resolves elsewhere`:
   only tests retired direct Oura preference over the Junction route.

Retained `renders source-specific Junction WHOOP commands` by removing its
retired direct-route competitor and obsolete flags; every output assertion stays.
Other prompt fixtures lose only removed flags. All ordinary reconnect, disabled
source, historical-reset and member-bound intent cases remain. Removed two
redundant connect/reconnect equality assertions after deleting the second API;
these were assertions inside retained tests, not deleted test cases.

Added three device-syncd tests: exact ordered defaults/absent configuration;
all Link singleton/pair/repetition order and uniqueness (including both Fitbit
inputs); unsupported/SDK-only rejection. Added seven Web cases: six missing or
mismatched selector variants, plus normalized conjunctive selection and absent
configuration. Existing WHOOP source-slug and disabled Strava cases remain.

### Verification for this amendment

All commands below passed on the final code. Full suites were used, with no test
name or file filters. Cloudflare inherited `MURPH_VITEST_MAX_WORKERS=2` as a
resource cap. Commands were captured through a `bash -o pipefail` wrapper with
home/worktree paths redacted before writing local logs.

| Command | Result / counts |
| --- | --- |
| `pnpm build` | PASS; 23 package builds plus CLI surface assembly |
| `pnpm verify:workspace-boundaries` | PASS |
| `pnpm deps:guard` | PASS; 26 manifests |
| `pnpm --dir packages/device-syncd typecheck` | PASS; zero errors |
| `pnpm --dir packages/assistant-runtime typecheck` | PASS; zero errors |
| `pnpm --dir apps/web typecheck` | PASS; zero errors |
| `pnpm --dir apps/cloudflare typecheck` | PASS; zero errors |
| `env MURPH_VITEST_MAX_WORKERS=2 pnpm --dir packages/device-syncd test:coverage` | 1,459 passed / 0 failed / 0 skipped; 61 passing files |
| `env MURPH_VITEST_MAX_WORKERS=2 pnpm --dir packages/assistant-runtime test:coverage` | 3,899 passed / 0 failed / 7 skipped; 177 passing / 1 skipped files |
| `env MURPH_VITEST_FILE_PARALLELISM=1 MURPH_VITEST_MAX_WORKERS=2 pnpm --dir packages/assistant-engine test:coverage` | 5,928 passed / 0 failed / 710 skipped; 304 passing / 8 skipped files |
| `env MURPH_VITEST_MAX_WORKERS=2 pnpm exec vitest run --config apps/web/vitest.workspace.ts --no-coverage` | 13,727 passed / 0 failed / 1,534 skipped; 848 passing / 132 skipped files |
| `pnpm --dir apps/cloudflare test:node` | workspace 4,583 passed / 0 failed / 5 skipped (213 passing / 1 skipped files); container helper 20 passed / 0 failed / 0 skipped (1 file) |
| `pnpm docs:drift` | PASS |
| `pnpm complexity:diff` | PASS; 98 branch-changed source files, 45 existing hotspots |
| `pnpm complexity:diff --base e5e58c1d9e` | PASS; 9 task-changed source files, 10 unchanged hotspots in the workspace phase owner |
| `git diff --check` | PASS |

Coverage statements / branches / functions / lines:

- device-syncd: 90.51% / 83.92% / 94.65% / 90.65%.
- assistant-runtime: 91.22% / 86.67% / 94.50% / 91.69%.
- assistant-engine: 91.36% / 85.84% / 95.29% / 91.55%.

The runtime suite includes the prompt and workspace device-sync tests; the engine
suite includes turn planning and prompt digest checks. No snapshots or digest
expectations changed. Existing opt-in/skipped cases are reported above, not
counted as passing; no PostgreSQL or live-provider proof opt-ins were enabled.

Candidate review: 9 production files, 16 added / 126 deleted lines, **110 net
production lines removed**. Four test files, 109 added / 118 deleted lines;
only two declarations removed, both inventoried above. The plan amendment is
append-only. No casts, dependency changes, schema changes, new abstractions,
provider-visible text changes or added network/database work. Touched functions
have no new complexity debt; connect-targets maximum complexity drops 7 to 5.
All selectors, claim tuple comparisons and source-availability gates remain.
Privacy scan and diff whitespace checks passed. No new actionable repository
friction was encountered. The generated `.swc` test cache is removed before the
scoped commit; local probe/check captures remain ignored under `.tmp`.

Commit through `scripts/committer` with the requested subject and co-author
trailer. No push, remote PR mutation or production action was performed; the
parent owns exact-head CI and ReviewGPT after pushing.
