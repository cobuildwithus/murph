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

B safe deploy order: deploy Web/control-plane configuration first, so new invocation snapshots contain only Junction. Drain already-created invocations and warm old Web functions before rolling the new runner. Old runners accept Junction-only snapshots. New runners deliberately reject old serialized direct-provider config; new-runner/old-Web is unsafe if the old Web environment still configures retired providers. No direct production connections are claimed from local diagnostics; the owner supplied the all-Junction production inventory. No deployment performed.

B verification: full build and CLI verification passed. Device tests: 1,412 initially passed, two migrated ingress fixtures failed and were corrected; focused rerun passed all 83 ingress tests. Importer typecheck and all 753 tests passed. Runtime focused suite initially passed 667 with nine stale direct fixtures; the corrected suites passed, including all 11 foreground ingestion proofs with explicit Junction source authority. Web focused suites passed after migrating source fixtures; Web/runtime/Cloudflare typechecks passed. Full runner bundle passed with 76 top-level packages captured before C; static boot 2,005,060 bytes across 22 chunks. Its local assembly unexpectedly attempted registry metadata resolution (DNS failure, no download); use a local offline pnpm wrapper for subsequent assembly. No registry mutation or publication occurred.

### Slice C implementation

Removed tag publication workflow, release orchestration, npm trust tooling, public tarball pack/publish helpers, npm notes and CLI changelog. Web's changelog generator does not consume those files. All workspace packages are private; public license/repository metadata remains. `files` lists remain because runner assembly actively consumes them; CLI changelog entry was removed. Replaced the CLI manifest's bundled dependencies with the identical explicit runner closure. Retained artifact secret guard, coverage plan/matrix, and protected `Release checks (ubuntu)` status. The former package-shape verifier is now a runtime artifact verifier, retaining generated artifact and entrypoint checks.

Before/after full runner assembly passed, including offline nested installs: exactly 76 top-level node_modules packages, no additions/removals. No publication or registry mutation. Local npm pack remains part of the authorized runner assembly; it does not publish. Offline wrapper is ignored task scratch; reproducible missing-offline-option friction is logged.

C checks passed: build, offline install and full runner bundle, CLI and Cloudflare typechecks, verify:cli (315 tests), and CI policy tests. Repo tools: 864 passed, 27 failed in unchanged ReviewGPT fixture tests because the machine privacy hook rejects their synthetic non-noreply email; both failing test files are identical to the stacked base and origin/main. No guard was weakened. The obsolete release-only doc exemption test was removed with its implementation.

### Slice D retirement and rollout

Removed scout seed, schedule spread/retry attribution, prompt guidance and availability plumbing, research CLI family and schemas, Exa client/dependency/credential/egress profiles, dedicated diagnostics and benchmark. The seed-only runtime-env requirement abstraction is removed. Generic query/sleep-pattern reads, weekly insight/digest, coaching, journal context, meal closeout, usage optimization, memory and idle maintenance remain.

Personal Patterns was already absent on the stacked base: its exact-ID tombstone remains, as do historical telemetry phase readers and the cycle-health skill's ordinary repeated-pattern reasoning. No feature-specific Prisma model or enum was found for either job; generic automation/vault, runtime, and historical usage data remain. No schema drops or production operations.

Retirement uses the existing immutable-ID set. Maintenance archives active/paused canonical records idempotently. Claimed stale jobs skip before provider work; queued outbound intents fail the existing non-retryable stale-authority gate before delivery. Archived sources disappear from canonical wake projection. Historical runtime/run records may remain as provenance; no active schedule or new work is derived from them. User-authored automations that merely reuse a slug are preserved.

D skew: new runner with old Web still rejects the exact retired ID at cron and outbox entry; maintenance archives old canonical records. New Web with old runner cannot guarantee retirement: the old runner can still seed/run scout and its Exa calls will be denied after Web's allowlist changes. Safe rollout therefore drains old in-flight scout attempts and pending deliveries before replacing Worker/runner with the retirement-aware build, then deploys Web's removed Exa authorization/settings projection. Keep old Web's Exa authorization during that drain. An old runner must not be restored after Web removes authorization; roll back the compatible Web boundary first if such rollback is separately authorized. No deployment performed.


## Combined rollout requirement

The B and D sequences must be coordinated. First remove direct WHOOP/Oura/Strava configuration from the existing Web/control plane, retaining its Exa authorization during the drain. Drain old invocation snapshots, warm old Web functions, and in-flight scout attempts/deliveries. Then deploy the retirement-aware Worker/runner. Finally deploy the new Web that removes Exa authorization. This permits old-runner/new-config operation using Junction, and new-runner/old-Web operation during retirement convergence. Deploying the new runner against old direct-provider configuration, or removing Web Exa authorization while old scout runners remain active, is unsafe. Existing schedules converge through normal maintenance; no production retirement was executed here. The retirement guard does not cancel a provider request or delivery already in flight in an old runner.

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
