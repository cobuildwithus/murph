# Testing And CI Map

Last verified: 2026-07-19

## Current Repo Checks

| Command | Purpose | Current coverage |
| --- | --- | --- |
| `pnpm typecheck` | Full workspace type proof through stable TypeScript 7. Independent guards overlap the clean contracts prerequisite; package/app no-emit checks use bounded no-sort fanout. The hosted web invokes the root compiler explicitly while retaining local TypeScript 5 only for framework/Solana tools that still require the legacy compiler API or peer range. Repo-owned source-analysis checks use Babel's parser instead of a TypeScript compiler API, leaving the web-local TypeScript 5 boundary independently removable once its consumers support TypeScript 7. Tsconfig path-map discovery reads root configs shallowly and scans only `packages/**` plus `apps/**`, avoiding unrelated local residue. Repo tools reuse an ignored incremental cache. | `scripts/*.{sh,mjs,ts}`, `e2e/smoke/verify-scenario-integrity.ts`, `packages/contracts/**`, `packages/clinical-records/**`, `packages/hosted-execution/**`, `packages/hosted-local-harness/**`, `packages/hosted-orchestrator-temporal/**`, `packages/runtime-state/**`, `packages/operator-config/**`, `packages/assistant-engine/**`, `packages/assistant-cli/**`, `packages/setup-cli/**`, `packages/cli/**`, `packages/openclaw-plugin/**`, `packages/core/**`, `packages/importers/**`, `packages/device-syncd/**`, `packages/inboxd/**`, `packages/parsers/**`, `packages/assistantd/**`, `packages/assistant-runtime/**`, `packages/health-metrics/**`, `packages/query/**`, `apps/web/**`, `apps/cloudflare/**`, `config/workspace-source-resolution.ts` |
| `pnpm test:repo-tools` | Focused Vitest coverage for repo-owned verification/config helpers. `test:diff` selects it for `scripts/**` and `config/**` changes, and the host-support release typecheck job runs it directly. | `scripts/**/*.test.ts` plus the shared config helpers those tests import |
| `pnpm test:diff` | Self-contained diff-aware agent/local lane. It maps paths to owners plus reverse dependents, runs relevant guards, then batches exact package typecheck/test scripts through bounded pnpm fanout with one CPU-derived nested Vitest budget. The command holds the workspace artifact lock from producers through dependent consumers, package-boundary follow-ups remain intact, and two affected apps reuse the prepared parallel app lane. Tooling-only diffs stay narrow; root manifests broaden to the workspace. Do not precede a truthful scoped run with redundant root `pnpm typecheck`. | Affected workspace owners plus reverse dependents under `packages/**` and `apps/**`, repo-internal tooling fast-path files under `agent-docs/**`, `docs/**`, `scripts/**`, `AGENTS.md`, `ARCHITECTURE.md`, `README.md`, `package.json`, `vitest.config.ts`, and root `tsconfig*.json`, plus whole-workspace fan-out when root workspace manifests change, the nested built-CLI verification lane only for CLI artifact-sensitive diffs, and explicit built package-boundary scripts for affected hosted-local-harness/inboxd/messaging-ingress diffs |
| `pnpm test` | Fast deterministic behavior loop under the artifact lock. It incrementally refreshes and verifies contracts, runs root multi-project Vitest, and overlaps fixture/scenario-manifest verification locally. Package projects share one bounded worker pool; four independent CLI buckets share the next phase and five explicit serial buckets remain isolated. Full acceptance retains clean-build semantics. | `packages/contracts/**`, `packages/clinical-records/**`, `packages/hosted-execution/**` including hosted execution auth/env/client/computer-use, phone-call, plan-usage `add_usage`, and exact Settings URL contract coverage, `packages/hosted-orchestrator-temporal/**` including Temporal workflow signal coalescing, timer, Activity boundary, and local env harness coverage, `packages/runtime-state/**` including hosted workspace-snapshot and artifact-externalization coverage plus hosted verified-email env helper coverage and assistant usage record parsing, `packages/operator-config/**` including setup/runtime-env/config persistence coverage, `packages/assistant-engine/**` including the local assistant runtime, provider-turn, tool-catalog, hosted computer dynamic tools, durable one-shot newsletter outbox execution, outbox, direct hosted usage recorder, and owner-boundary coverage, `packages/assistant-cli/**` including CLI-only assistant wrappers, terminal logging, assistant command routing, and Ink chat UI coverage, `packages/setup-cli/**` including onboarding, host setup, and setup-wizard coverage, `packages/cli/**` including the published shell, command-schema coverage, CLI `.env` loading coverage, compatibility-wrapper coverage, and assistantd client routing coverage, `packages/openclaw-plugin/**` including the published OpenClaw bundle metadata and Murph skill guidance package-local test, `packages/core/**`, `packages/importers/**`, `packages/device-syncd/**` including the Oura and WHOOP config/provider/service tests plus HTTP control-plane auth/listener coverage, `packages/inboxd/**` including AgentMail email connector tests plus shared Linq webhook verification coverage, `packages/parsers/**`, `packages/assistantd/**` including loopback host validation, bearer-authenticated control-plane routing, single-vault request enforcement, and the direct owner-package boundary regressions, `packages/assistant-runtime/**` including hosted assistant profile seeding/adoption coverage, fail-closed hosted automation gating, hosted verified-email self-target reconciliation coverage, durable email fanout child replay classification, the direct owner-package boundary checks for hosted consumers, selective hosted artifact materialization, preserved-artifact snapshot behavior, direct hosted AI usage recording, explicit runtime-env projection, Cloudflare-managed proxy env preservation, per-user warm workspace roots, invocation-local writable cache/temp roots, runtime wake coalescing, and container cleanup poisoning when process residue cannot be proven, `packages/health-metrics/**`, `packages/query/**`, `fixtures/**`, `e2e/smoke/scenarios/**` |
| `pnpm verify:acceptance` | Canonical CI/release acceptance gate. It runs the root verifier's full typecheck surface first, then the coverage-heavy acceptance lane while skipping only work already proven inside the same acceptance process: repeated repo guards, Cloudflare app-local typecheck, and the contracts artifact rebuild. Local acceptance now prepares shared runtime artifacts, runs package coverage cleanup plus tracked-artifact hygiene, then overlaps package coverage, scenario-integrity coverage, and both app verifiers by default, with app verification delayed 45s by `MURPH_ACCEPTANCE_APP_VERIFY_DELAY_SECONDS` so package coverage clears its heaviest early work first; CI keeps app/package overlap opt-in through `MURPH_ACCEPTANCE_APP_VERIFY_WITH_COVERAGE=1` and defaults that delay to 0 unless explicitly set. | The full `pnpm typecheck` surface plus the full `pnpm test:coverage` coverage/app/smoke surface below, without duplicate guard/typecheck/build repeats inside the same command |
| `pnpm docs:drift` | Manual durable-doc drift check. Use this when you intentionally change durable repo docs and want the old index/truthfulness enforcement without making the default `pnpm test` lane sensitive to unrelated dirty-tree doc work. | `AGENTS.md`, `ARCHITECTURE.md`, `agent-docs/**`, `README.md`, `package.json` |
| `pnpm --dir packages/health-commons verify` | Package-local Health Commons verification. Use this for authored Health Commons content, generator, schema, or package test changes. Root acceptance regenerates the ignored catalog for app/typecheck consumers, but does not replace this package-local check. | `packages/health-commons/**` |
| `pnpm test:coverage` | Coverage-focused acceptance lane, not the default local loop. It composes dependency/workspace/doc/artifact guards, prepared package coverage, scenario-integrity coverage, and app verification. Local package fanout is CPU-aware and capped at six outer processes with a divided inner worker budget; CI remains serial by default. Acceptance reuses the preceding typecheck's generated inputs and holds one artifact lock across both phases, while standalone coverage remains self-contained. Existing app/package overlap, delay, retry, and CI override controls remain available. | `agent-docs/**`, `ARCHITECTURE.md`, `README.md`, `docs/contracts/03-command-surface.md`, `packages/{assistant-cli,assistant-engine,assistant-runtime,assistantd,cli,cloudflare-hosted-control,clinical-records,contracts,core,device-syncd,gateway-core,health-metrics,hosted-execution,hosted-local-harness,hosted-orchestrator-temporal,importers,inbox-services,inboxd,messaging-ingress,openclaw-plugin,operator-config,parsers,query,runtime-state,setup-cli,vault-usecases}/**`, `apps/web/**`, `apps/cloudflare/**`, `fixtures/**`, `e2e/smoke/**` |
| `pnpm test:packages` | Package-only behavior verification. It incrementally refreshes contracts, runs every root-wired package project once, and executes nine CLI buckets: four independent buckets in one bounded phase plus five explicit serial smoke phases. App verification and built-runtime/package-shape acceptance stay in their dedicated commands. | `packages/{assistant-cli,assistant-engine,assistant-runtime,assistantd,cloudflare-hosted-control,clinical-records,contracts,core,device-syncd,gateway-core,health-metrics,hosted-execution,hosted-orchestrator-temporal,importers,inbox-services,inboxd,messaging-ingress,openclaw-plugin,operator-config,parsers,query,runtime-state,setup-cli,vault-usecases}/**`, plus `packages/cli/**` through its source-first workspace buckets |
| `pnpm test:apps` | Parent-locked app verification. It prepares Health Commons output and the hosted-web Prisma client once, then runs `apps/web verify` and `apps/cloudflare verify` concurrently locally or serially in CI. Hosted-web verification completes its TypeScript 7 source check before Next uses the web-local TypeScript 5 compatibility compiler to validate freshly generated route and page contracts; both checks remain fail-closed. The children retain their existing build, lint, smoke, test, app-local worker, and acceptance-skip behavior without racing duplicate generation. | `apps/web/**` and `apps/cloudflare/**`, including hosted-web lint/dev-smoke/production build, Cloudflare Node and Workers tests, and shared source-resolution wiring |
| `pnpm test:packages:coverage` | Package coverage after prepared runtime/artifact hygiene. Local outer fanout is CPU-aware and capped at six processes; each process receives the remaining CPU budget instead of a percentage that multiplies across the fanout. CI remains one outer process with a 50% inner cap. Contracts/CLI ordering, coverage thresholds, failure aggregation, and built package-boundary checks remain intact. | Package-wide coverage under `packages/{assistant-cli,assistant-engine,assistant-runtime,assistantd,cli,cloudflare-hosted-control,clinical-records,contracts,core,device-syncd,gateway-core,health-metrics,hosted-execution,hosted-local-harness,hosted-orchestrator-temporal,importers,inbox-services,inboxd,messaging-ingress,openclaw-plugin,operator-config,parsers,query,runtime-state,setup-cli,vault-usecases}/src/**/*.ts`, plus sequential built package-boundary checks for `packages/hosted-local-harness`, `packages/messaging-ingress`, and `packages/inboxd` |
| `pnpm test:scenario-integrity` | Root command for fixture/scenario-manifest integrity verification; this lane is not executable end-to-end smoke today. | `fixtures/**`, `e2e/smoke/**`, `docs/contracts/03-command-surface.md` |
| `pnpm --dir apps/web test:viewport-overflow` | Playwright gate that renders each public marketing route, including Murph Safe search, at 320/375/390/768/1280px and fails on horizontal document overflow. It also exercises the Murph Safe explicit-submit privacy, grouped-result, detail-link, empty, error, and rate-limit browser states. Playwright owns the dev-server lifecycle (`apps/web/playwright.config.ts` `webServer`) and boots hosted-web with the placeholder smoke env on its own `.next-smoke-overflow` dist dir, so the public pages render anonymously without real secrets. Runs in its own CI workflow rather than `apps/web verify` so Chromium stays out of build/lint/unit-test lanes. | `apps/web/e2e/**`, `apps/web/playwright.config.ts`, and the public routes listed in `apps/web/e2e/viewport-overflow.spec.ts` |
| `MURPH_SAFE_E2E_PRODUCT_REF=... MURPH_SAFE_E2E_PRODUCT_NAME=... MURPH_SAFE_E2E_QUERY=... MURPH_SAFE_E2E_EXPECTED_TEST_ID=... pnpm --dir apps/web exec playwright test e2e/murph-safe-production-seam.spec.ts` | Opt-in rendered production-seam proof against an explicitly seeded local labels database. It uses the real POST search route, validates the public detail contract and exact selected-record test id, renders the server detail at phone and desktop widths, and checks detail overflow. `MURPH_SAFE_E2E_EXCLUDED_TEST_ID` can prove that a same-canonical sibling observation is absent. | Murph Safe public search route, shared service, labels SQL, contract, and server-rendered detail page |
| `MURPH_IMESSAGE_ENROLLMENT_TEST_DB_URL="$LOCAL_POSTGRES_URL" pnpm exec vitest run --config apps/web/vitest.config.ts apps/web/test/imessage-mini-app-account-deletion.db.test.ts --no-coverage` | Opt-in real-PostgreSQL proof for bounded Messages credential rotation and enrollment versus account deletion against an isolated, migrated local test database. The URL guard permits only loopback or local socket targets; the ordinary hosted-web workspace excludes `*.db.test.ts`, and the focused config additionally skips this suite when the dedicated variable is absent. | Repeated enrollment rotates one Messages-owned row while invalidating prior bearers and preserving ordinary sessions, including stale-generation self-revocation, re-enrollment after revocation and expiry, plus both deletion-first and enrollment-first serialization orders with final absence of the member and its device-agent session |
| `DATABASE_URL="$LOCAL_POSTGRES_URL" MURPH_TEST_POSTGRES_CONCURRENCY=1 pnpm exec vitest run --config apps/web/vitest.workspace.ts --no-coverage apps/web/test/hosted-usage-credit-postgres-concurrency.test.ts` | Opt-in real-PostgreSQL proof for the usage-credit beneficiary lock, replay, and deletion boundaries. The suite rejects non-loopback database URLs and runs in the hosted E2E PostgreSQL job after migrations. | Concurrent grant replay converges on one immutable grant, grant/debit ordering preserves the projection, the member-before-purchase lock order is observable under contention, and deletion-first ordering cannot append an orphaned grant |

Ordinary package, app, and repo-tool Vitest configs share one marked
process-owned temp root. Teardown removes the whole root after success or
failure; a later run recovers only old marked roots whose owner is gone and
which no current-user process uses as its working directory.

Clinical-record execution coverage is split at its owners: hosted-execution
tests lock the pointer/run/page/outcome codecs, vault-usecases tests prove
raw-first replay plus real multi-page importer resolution, assistant-runtime
tests prove finite retry/preemption/reauthorization behavior, and Cloudflare
tests prove the signed web-control adapter and POST-only outbound allowlist.

Labs discovery coverage is likewise owner-split. Hosted-execution tests lock the
strict `search` / `show` / `locations` request and response contracts. Hosted
web tests cover the fixed Junction origin, provider normalization, bounds,
timeouts, sanitized errors, browser-session API, signed callback, and the
authenticated unlinked UI states. Cloudflare tests cover the signed semantic
port and outbound allowlist. Assistant-runtime and assistant-engine tests cover
port propagation, dynamic-tool registration, private-direct audience policy,
action parsing/execution, and stable prompt guidance. Final change proof uses
`pnpm test:diff` across every touched owner plus
`pnpm test:scenario-integrity`, authenticated desktop/mobile browser proof,
the required frontend and coverage specialist audits, the review-only Fable UI
pass, and ReviewGPT. Routine tests stub Junction; they do not call the live
catalog or expose a production credential.

Hosted personal usage-credit coverage is split across focused hosted-web unit
and component tests. The allowance suites exercise enforced exhaustion,
included-first settlement, carryover balance, and crossing-operation behavior;
credit-ledger suites exercise beneficiary-lock call ordering, unique
grants/debits, and projection updates; route and purchase-service suites
exercise app-session/CSRF binding, fixed offers, eligibility, and Checkout
request idempotency; reconciliation suites exercise live Stripe re-fetch,
one-time/subscription dispatch separation, replay-safe grants, refund/dispute
signed adjustments in both directions; component suites exercise the Settings
dialog selection, redirect, return polling, and error states. A guarded
real-PostgreSQL suite proves grant replay, beneficiary-first lock ordering,
grant/debit serialization, and deletion-first cleanup. Stripe remains mocked,
and component tests do not replace a deployed browser flow, so launch still
needs the documented test-mode Checkout, webhook, and browser smoke.

## Current CI Workflows

- Linux CI `apps/web verify` invocations default to wrapping the hosted-web production
  `next build` step with `apps/web/scripts/build-memory-guard.sh`. The guard
  creates a root-level cgroup-v2 child for accounting only and moves the build
  process into that cgroup while keeping the build itself on the invoking user,
  environment, cwd, and stdio. It does not currently write `memory.max`,
  `memory.swap.max`, or `memory.oom.group`. The advisory budget is a cgroup-unit
  model of Vercel Standard's 8 GB build machine: 7.2 GB available to the build
  cgroup and a 0.8 GB reserve for OS/container overhead outside it at the
  ceiling. The legacy-named guard budget override must stay strictly above the
  6,000,000,000-byte known-false-positive cgroup floor and at or below
  7,200,000,000 bytes, preserving at least a 0.8 GB reserve under the 8 GB
  machine model. The floor comes from the fully working 2026-07-06 Linux CI run
  where a 6.0 GB cgroup cap OOM-killed a build that Vercel's real 8 GB Standard
  machine accepts. PR #349's 5.34 GB passing and 6.18 GB exit-137 failure
  numbers are historical single-process RSS measurements only, not cgroup cap
  bounds; cgroup accounting includes anonymous memory across all build workers
  plus page cache. Live CI on 2026-07-07 showed the hard limit cannot ship green
  yet: `turbopackMemoryLimit=3GiB` matched the 4 GiB cold-build anon ramp,
  rising about 2.9 GB at 12 seconds, 5.5 GB at 27 seconds, and 6.9 GB at 42
  seconds before an OOM-group kill. The guard samples cgroup `memory.current`
  and selected `memory.stat` fields about every 3 seconds, prints trajectory
  lines about every 15 seconds, then reports sampled maxima before cgroup
  `memory.peak`, `memory.events`, and selected final-read `memory.stat` values.
  If sampled max anon or `memory.peak` exceeds the advisory budget, it prints a
  loud `WOULD EXCEED` warning while preserving the wrapped build's exit status.
  It fails loudly if cgroup v2, the root memory controller, passwordless `sudo`,
  or peak-accounting machinery is unavailable. Disabling the guard in Linux CI
  requires `MURPH_HOSTED_WEB_BUILD_MEMORY_GUARD=0` and logs a prominent warning
  that the Vercel Standard-machine memory budget is not being measured. Flipping
  back to enforcement means restoring the `memory.max`, `memory.swap.max`, and
  `memory.oom.group` writes once the cold build fits under the advisory budget.
- `.github/workflows/repo-hygiene.yml` runs the tracked private/build artifact guard on GitHub-hosted `ubuntu-24.04`.
- `.github/workflows/web-viewport-overflow.yml` runs the `pnpm --dir apps/web test:viewport-overflow` Playwright gate on GitHub-hosted `ubuntu-24.04` for every pull request and `main` push. It installs only Chromium (`playwright install --with-deps chromium`); Playwright's `webServer` boots the hosted-web dev server with the placeholder smoke env, so the job needs no Postgres service or real secrets. On failure it uploads the Playwright HTML report as an artifact.
- `.github/workflows/host-support.yml` runs a host-support matrix on GitHub-hosted `ubuntu-24.04` and `macos-latest`, installing with `pnpm install --frozen-lockfile`, building the workspace, preparing `pnpm build:test-runtime:prepared`, and then exercising the focused built-runtime CLI host-support suite (`packages/cli/test/setup-cli.test.ts` and `packages/cli/test/inbox-service-boundaries.test.ts`) with `MURPH_PREPARED_CLI_RUNTIME_ARTIFACTS=1` on both hosts. The macOS host leg serializes package-script workspace builds so sibling `tsc -b --force` package scripts do not rewrite shared project-reference declarations at once while the Linux leg keeps the normal package-build fanout. The workflow also carries deterministic CI-only hosted-web build placeholders for `DATABASE_URL`, hosted device routing, contact privacy, hosted mailbox fingerprinting, and the public Privy app id so its Linux release shards can finish `apps/web verify` without inheriting production secrets.
- The same workflow also preserves the Ubuntu `pnpm release:check` surface without running it as one long job: release metadata/build/typecheck, package coverage shards, app verification, and fixture coverage run as parallel jobs, then a final `Release checks (ubuntu)` aggregator preserves the required-check name. The app-verification shard provisions an isolated loopback PostgreSQL 17 service and sets the dedicated supplement-search test database variable, so its rollback-only 100+ query PostgreSQL corpus runs on pull requests and `main` while the ordinary hosted-web build database remains the unreachable CI placeholder. This keeps Linux bootstrap and release packaging exercised in CI while avoiding the serial package-coverage wall clock.
- `.github/workflows/deploy-render-temporal-worker.yml` runs after successful `Murph Host Support` push runs on `main`, waits for both `Murph Host Support` and `Repo Hygiene` to be successful for the same current `main` commit, then calls the Render Temporal worker deploy hook with that exact commit `ref`. The hook URL lives only in the `RENDER_TEMPORAL_WORKER_DEPLOY_HOOK` GitHub Actions secret. This replaces Render's native `checksPass` auto-deploy gate for the worker so stale third-party check suites cannot block production deploys.
- `.github/workflows/cloudflare-runner-base-image.yml` runs only on protected `main` pushes or manual dispatches from protected `main` and publishes stable and source-fingerprinted GHCR native runner base image tags through `pnpm --dir apps/cloudflare runner:docker:base -- --push`. The workflow grants `packages: write` and deliberately has no pull-request trigger.
- `.github/workflows/cloudflare-hosted-e2e.yml` runs focused hosted-local E2E jobs on GitHub-hosted `ubuntu-24.04` for every pull request and `main` push. A shared preparation job builds the hosted-local runner bundle, workspace `dist` outputs, and production hosted-web dist once per run with `MURPH_RUNNER_BUNDLE_BUILD_CONCURRENCY=4`; scenario-group jobs download those artifacts and use `--no-bundle`. Each group passes one or more named scenarios to a single `pnpm hosted-local e2e` suite invocation. The suite runs scenarios serially, keeps dedicated/test-control scenarios isolated, reuses generated artifacts plus the current-build runner image and smoke proof where isolation allows, and owns final image cleanup. This avoids rebuilding the same image and rerunning the same smoke proof between compatible scenarios. Before that expensive assembly boundary, `packages/device-syncd/test/package-boundary.test.ts` walks the runner runtime-config static source graph and fails if provider runtime modules, importer modules, or the Junction SDK enter the boot closure; bundle assembly keeps the final esbuild-metafile guard as the authoritative packed-artifact check. The routine Linq reminder/onboarding leg uses the explicit fast-gate profile on pull requests and `main` for the scheduled reminder's 30-second lead and 1ms idle checkpoint. The onboarding scenario uses the shared hosted-local harness checkpoint default to prove signup welcome seeding, foreground completion, and deterministic managed archival, while the sibling Linq reminder scenario retains the timed alarm-to-provider-to-Linq send proof. The protected deployment gate does not set the reminder fast profile; its default reminder timing remains a 60-second lead with a 10-second checkpoint. Ten matrix legs preserve the established provider, messaging, checkpoint, webhook, device-connect, and Temporal scenarios while adding deterministic same-wake Linq batching, canonical-receipt recovery, snapshot-publication fallback, shutdown checkpoint ordering, retryable-outbox restart, usage-limit ambiguity, Linq group/home-line authority, Family sponsorship, unknown first-contact fallback, vault approval resume, Retell call results, and computer handoff roundtrips. The Junction wearable direct-resource replay is a 35-minute leg in this shared-artifact workflow instead of rebuilding the runner bundle in a standalone workflow; its proof also covers signed-webhook retry semantics, historical-backfill evidence, and device-activity experiment adherence with a single non-nagging Linq nudge. The shared bundle includes the E2E parser toolchain; `linq-webhook-audio` proves the Worker-mediated Workers AI transcription path through the container parser drain, remote-transcription provider, and `murph-transcribe.worker` egress handler with the deterministic fake `AI` binding. Every leg provisions loopback `postgres:17` from `public.ecr.aws/docker/library/postgres:17` with an explicit `pg_isready` probe, installs the pinned Codex and Temporal CLIs, uses deterministic CI-only hosted-web placeholders, avoids GHCR authentication before PR-controlled code, uses anonymous public runner-base pulls, and always uploads its focused log plus redacted hosted-local `state.json` files. The always-run `Hosted E2E required gate` depends on the shared bundle and complete scenario matrix; the always-run `Hosted device-sync E2E required gate` also depends on that matrix, which includes the Junction replay leg. These jobs preserve two stable required-check names and fail when their prerequisite work fails, is canceled, or does not complete. The local aggregate `pnpm --dir apps/cloudflare test:e2e:local` also runs the Workers-runtime lane through `test:e2e:workers:local`; CI keeps that narrower Workers proof inside `apps/cloudflare verify` / `test:workers` rather than duplicating it in every hosted-local leg.
- `.github/workflows/cloudflare-runner-permission-sandbox.yml` runs the production `linux/amd64` runner image smoke on native GitHub-hosted `ubuntu-24.04` when the pinned Codex package, permission executor/config, runner image, bundle, or smoke proof changes. It builds the production runner closure, prepares the anonymously readable pinned base image, disables Ubuntu's host-only restriction on capability-bearing unprivileged user namespaces for this disposable job, and runs `runner:docker:smoke:prepared-base` without provider credentials. The smoke transport also disables Docker's outer default seccomp and AppArmor profiles while retaining `--network none`, so the pinned bubblewrap binary can create and police its nested mount namespace; those outer test-harness settings do not change the production image or inner permission profile. The gate proves the named profile attestation plus authorized reads and denied writes, runtime/secrets/sibling/outside-root reads, loopback networking, and secret-environment inheritance. The native lane is required because ARM64 Docker Desktop's AMD64 emulation cannot install the inner Codex seccomp filter and must remain a fail-closed local gap rather than weakening the profile.
- The hosted-local active-turn latency scenario proves same-chat late-input folding, forces a 20-second provider-cleanup stall and requires the second reply to preempt it, and checks that a projected wake does not trigger immediate full idle-shutdown work under the 180-second floor.
- After hosted scenarios initialize the schema, the Linq route-authority matrix leg runs the focused real-PostgreSQL proofs for both participant-addition route-row orderings, the canonical chat-ownership-before-route-row order shared by usage-limit dispatch and route-key convergence, and device-sync exact-payload plus companion-receipt lock order against concurrent account deletion.
- `.github/workflows/release.yml` uses GitHub-hosted `ubuntu-24.04`, installs once, runs `pnpm release:check` with `MURPH_TEST_LANES_PARALLEL=1`, `MURPH_APP_VERIFY_PARALLEL=1`, and `MURPH_VERIFY_STEP_PARALLEL=1` so the release verification lane uses the parallel package/smoke branches and parallel app substeps without enabling full app/package overlap unless `MURPH_ACCEPTANCE_APP_VERIFY_WITH_COVERAGE=1` is set explicitly, while the same deterministic hosted-web build placeholders keep `apps/web verify` on its truthful build path without injecting production DB or production hosted device secrets, then packs the publishable tarballs once for upload/publication.
- Vercel deploys of `apps/web` use the checked-in Vercel build command
  `pnpm release:production:migrate && pnpm build`, so the guarded migration
  wrapper still runs automatically on main-branch production deploys while
  preview/non-main builds skip through the wrapper guard. The generic
  `pnpm --dir apps/web build` script is non-mutating and does not run production
  migrations. The guarded predeploy migration entrypoint uses
  `DIRECT_DATABASE_URL` when present, requires it in Vercel production, rejects
  known pooled Postgres ports such as `6432` and `6543`, blocks destructive or
  incompatible Prisma migration SQL outside the frozen hosted web migration
  history set ending at `20260707170000_drop_stale_linq_recency_columns`,
  regenerates the
  hosted web Prisma client after migrations, and runs the hosted Linq DB
  configured-line sync/readiness check so DB-backed Linq assignment cannot
  deploy with an empty assignable line pool or stale generated client.
  Production deploy sync skips provider inventory; provider inventory remains on
  explicit operator/contact-card paths. Normal production Prisma migrations must
  remain backward compatible with the currently deployed app because a
  successful predeploy migration can outlive a later build failure. Required
  columns, renames, `SET NOT NULL`, and incompatible type changes require
  expand/backfill/switch/final-cleanup sequencing; only final cleanup belongs in
  `apps/web/prisma/contract-migrations`. Destructive hosted web contract cleanup
  is applied by `.github/workflows/hosted-web-contract-migrations.yml` after a
  successful Vercel-originated completed production deployment status; that
  workflow checks out the deployed SHA, verifies it is reachable from
  `origin/main`, waits `HOSTED_WEB_CONTRACT_MIGRATION_DRAIN_SECONDS` seconds for
  prior production function executions to drain, rechecks that the configured
  Vercel production alias still points at that SHA before exposing the database
  secret, supports manual dispatch with `deployed_sha` for the same current-alias
  proof path, does not use GitHub Actions concurrency for this lane so stale
  events cannot replace valid pending runs, and requires GitHub Actions values for
  `HOSTED_WEB_VERCEL_TOKEN`,
  `HOSTED_WEB_VERCEL_PROJECT_ID`, `HOSTED_WEB_PRODUCTION_BASE_URL`, and
  `HOSTED_WEB_DIRECT_DATABASE_URL`. The shared production migration URL resolver
  removes Prisma-style `sslcert=system`, `sslkey=system`, and
  `sslrootcert=system` markers before handing Postgres URLs to raw `pg` clients.
  After contract cleanup applies, the rollback floor is the first deployed Vercel
  commit that no longer reads or writes the dropped schema shape; rollback below
  that floor requires DB restore/re-expand or a forward deploy. Cloudflare
  `container_rollout=immediate` is not applicable to this Vercel-only lane; the
  bounded drain wait and final alias check own the old-function window.
- Automatic approval-outcome mailbox emission is an explicit cross-plane
  activation exception: `MURPH_HOSTED_ACTION_APPROVAL_OUTCOME_WAKE_ENABLED`
  must stay unset or `0` while the matching consumers are unverified. Deploy and
  verify the web bundle that serves the action-approval read route first. That
  bundle is the web rollback floor for the compatible runtime. After the
  protected-main Cloudflare `container_rollout=immediate` deployment
  and managed-container smoke pass, keep it disabled for a full 30-minute drain
  after the last old runtime bundle can serve an approval request. Restart that
  drain if an old bundle can still serve later. This covers the 15-minute pending
  approval lifetime plus the fresh 15-minute approved lifetime before the gate
  is set to `1` and web is redeployed. To roll back, set it to `0` and redeploy
  web first. Once the gate has ever been enabled, the first compatible
  Cloudflare/runner bundle and the first web bundle serving the read route are
  permanent rollback floors. Keep web at that floor or newer while compatible
  runtime or pending approval work can depend on the route; removing the web
  floor requires a separate migration or forward runtime. System-lane
  lag proves import progress, not that imported pending items or committed hot
  snapshots no longer contain the new wake. Roll back only to that floor or
  newer, or forward-fix. A below-floor rollback requires a separate migration
  and proof covering server rows, imported local pending items, committed
  snapshots, and in-flight producers. The disabled path emits no new mailbox
  kind and retains the legacy approval confirmation fallback. Approval-outcome
  coverage also proves bare
  return links when enabled, one parked owner across repeated turns in the same
  approval cycle, exact-cycle causal selection and generation validation instead
  of oldest-owner fallback, retained causal control work across foreground
  preemption, one causal observation read and dispatch allowlist,
  vault-file final-target binding before approval consumption while ordinary
  text delivery retains Linq current-home fallback,
  consumed authorization remaining approved in member-facing presentation while
  replay reads fail closed, and approval-link retry wakes taking precedence over
  a later parked fallback.

- Generated-delivery compatibility is covered across the shared exact-ref
  predicate, persisted assistant media schema, hosted side-effect codec,
  retry-only file reader, assistant runtime checkpoint planning, and portable
  package boundary. Phase-one tests must prove initial file preparation still
  rejects the hidden path, all other hidden refs remain closed, active runtime
  files enter encrypted checkpoints, `.runtime/**` stays out of portable ZIPs,
  and portable-eligible ordinary `exports/assistant-deliveries/**` files remain
  in both. Archive-file exclusions must remain global rather than gaining
  path-specific ownership semantics. Phase two may enable writers only after an
  immediate deploy proves the phase-one runner fingerprint has converged.

## Current Gaps

- Assistant Ask has focused contract, parser, Web authority/idempotency,
  assistant-tool policy, runtime mailbox routing, detached-process lifecycle,
  and Cloudflare runner-image confinement coverage. The production-like Linux
  proof must show committed group reads succeed while writes, `.runtime/**`,
  `.codex/**`, environment files, other roots, inherited shell secrets, and tool network are
  denied, and it must show child failure or cancellation cannot interrupt the
  resident foreground App Server. Routine CI uses scripted provider responses;
  it does not send a real private-to-group ask through deployed Web, Temporal,
  Cloudflare, a live model provider, and the user messaging channel.

- Clinical Records has focused hosted-web proof for the committed Epic
  directory (including Atlanta/Piedmont search and public-endpoint rejection),
  SMART scope negotiation and bounded streams, callback redaction, runtime
  write fences, two-page raw Bundle pagination, exact-family cursor pinning,
  401/403 behavior, stale-claim and token-rotation CAS races, preemption,
  outcome replay, and account-deletion coverage. Package tests cover the shared
  runtime contracts and clinical cursor crypto lane. No automated check logs
  into a live Epic tenant or asserts that a provider's production patient data
  is complete.

- Repo-level automation still does not run full end-to-end CLI scenario flows; it typechecks/builds the published shell plus the extracted `assistant-cli` and `setup-cli` packages, now includes inbox service/runtime tests plus parser-worker/runtime tests, and the `test:scenario-integrity` lane still covers fixture/scenario-manifest integrity separately.
- The current fixture/scenario lane still validates manifests and command-surface coverage, not end-to-end package orchestration.
- Hosted Temporal orchestration has package, route, focused web/Cloudflare
  coverage, a local Signal-With-Start smoke script, and a root Render
  Background Worker Blueprint for the worker process. The hosted-local E2E
  suite now includes `temporal-orchestration`, which starts managed local
  Temporal, signals through web, queries the workflow, and proves the worker
  reaches Cloudflare ensure-processing. The hosted Temporal package has retired
  the reconciliation-before-mailbox pre-patch branch after production pre-patch
  histories drained; during the intermediate retirement window the
  `hosted-temporal:guard` script requires the workflow `deprecatePatch()` marker
  and CI package-coverage entry to remain present, and the host-support package
  coverage shard runs `packages/hosted-orchestrator-temporal`. Future
  command-ordering edits to `hosted-user-runtime.ts` still require Worker
  Versioning/deployment pinning, `patched()` / `deprecatePatch()`, or a replay
  test against representative captured or synthetic pre-change histories for
  the newly affected path. Routine repo checks still do not validate a live
  Render deploy or a production Temporal Cloud namespace.
- Hosted-local E2E scenarios launch the real Codex app-server binary by default, pointed at a local deterministic scripted Responses API stub through the test-only `HOSTED_RUNTIME_CODEX_MODEL_PROVIDER_BASE_URL` override with a fake provider key, so default lanes exercise the production app-server protocol (including dynamic-tool `item/tool/call` relay and sandboxed shell execution of scripted vault-cli calls) with zero provider spend. No automated check calls a paid model provider by default. The opt-in `codex-gateway-prefix` hosted-local E2E scenario runs the real Codex app-server against a local Responses API recorder for cache-prefix diagnostics, fingerprints the first cacheable provider prompt prefix across repeated Linq wakes, and fails if those fingerprints diverge; it is excluded from the default `all` scenario set because it can intentionally fail while provider behavior is under investigation. Codex App Server file/PDF inputs are not advertised as natively supported unless the app-server protocol grows a supported file input item.
- Production-path hosted-local waiters are observational: completion, progress,
  and provider-output waits may read status or recorded stub requests and sleep,
  but must not invoke ensure-processing, alarms, activity expiry, or direct
  runtime controls. Full-stack scenario cleanup enforces zero mutating harness
  interventions by default. Tests that deliberately exercise recovery must opt
  into `faultInjection: true` and keep their test-control action explicit.
- Hosted Codex config must keep native Codex skill instructions disabled (`[skills] include_instructions = false` and `[skills.bundled] enabled = false`) unless the hosted prompt-cache invariant is deliberately redesigned. Re-enabling those instructions can embed per-wake runner-local skill paths in provider prompts, making otherwise resumed hosted turns diverge before the cacheable prefix floor. Murph-managed assistant skill assets are different: `packages/assistant-engine/skills/**` ships with the package, the stable prompt references them symbolically through `$MURPH_ASSISTANT_SKILLS_ROOT/<slug>/SKILL.md`, and hosted/local shell env stamps `MURPH_ASSISTANT_SKILLS_ROOT` to the canonical package-owned root for explicit reads. Health Commons generated catalogs are likewise package-owned runner assets: the runner image pins `MURPH_HEALTH_COMMONS_PACKAGE_ROOT` to the installed `@murphai/health-commons` package so bundled shell commands resolve `generated/**` outside the esbuild chunk directory. Keep `packages/assistant-engine/test/assistant-skill-assets.test.ts`, `packages/assistant-runtime/test/hosted-runtime-codex-config.test.ts`, and the Cloudflare runner-bundle probes as the regression guards for this split.
- No routine automated check hits a live Linq endpoint; Linq webhook delivery and
  outbound reply behavior remain covered by mocked CLI, inboxd, and hosted
  `apps/web` tests. The opt-in `scripts/linq-typing-repro.ts` live E2E requires
  explicit send confirmation, env-only credentials and direct-chat id, and a
  recipient observation; `--assert-progress-typing-visible` fails unless typing
  is visibly present both before and after the outbound progress-message boundary.
- No automated check hits a live AgentMail endpoint; email provisioning, polling, and in-thread reply behavior are currently verified through mocked CLI and inboxd tests only.
- No automated check hits a live WHOOP or other wearable OAuth provider; device-syncd auth/webhook behavior is currently verified through local service tests, route tests, stubbed control-plane callers, and the hosted-local device-connect smoke that creates a signed WHOOP connect link against synthetic provider config.
- Automatic meal-photo capture is covered by hosted-web enrollment/upload route and JPEG-boundary tests, hosted-execution wake parsing tests, Cloudflare private-object route/encryption/lifecycle tests, and assistant-runtime canonical import/idempotency/post-checkpoint cleanup tests. Routine CI does not grant a real iPhone Photos permission or upload to the production R2 bucket, so final rollout proof still requires an explicit physical-device opt-in against the deployed web and Cloudflare heads.
- No routine repo verification command validates a real Cloudflare Worker deploy or a real Cloudflare-managed native-container rollout. `apps/cloudflare` tests now cover the in-repo worker, direct Durable Object RPC and alarms in the Workers runtime, the Durable Object/container boundary, configurable container idle-timeout wiring, container activity-expiry cleanup behavior, runtime-owned hard-floor/shutdown checkpointing plus invocation-local pre-floor assistant wake service, selective artifact materialization plus preserved-artifact snapshot behavior, keyring-aware hosted ciphertext reads by stored `keyId`, bundle/artifact cleanup on successful transitions, and Node container-image seams. The repo also ships `pnpm --dir apps/cloudflare test:e2e:runner-python:local` as a targeted final-image Python PATH E2E: it assembles a fresh runner bundle, prepares the cached native base image, builds the same `linux/amd64` app-layer Dockerfile used by the Cloudflare container, starts the image with its normal entrypoint, waits for `/health`, and checks as the non-root `runner` user from immutable `/app` with the baked runner PATH to prove `python` and `python3` resolve to Python 3. `pnpm --dir apps/cloudflare runner:docker:smoke` remains the broader local final-image smoke: it overlays smoke entrypoints into a derived bundle, restores a real fixture vault into an isolated smoke workspace inside the container, exercises `vault-cli` through Codex App Server `command/exec` for default vault reads, explicit raw `--vault`, measurement and scheduled-measurement writes, representative list commands, and hidden-vault schema/LLM metadata, exercises the shared `@murphai/parsers` attachment pipeline, and records metadata-only CLI proof counts plus the selected provider ids so the proof explicitly covers the shipped `murph` / `vault-cli` bins plus native `python` / `python3`, `pdftotext`, and ffmpeg-backed audio normalization/preparation behavior under the hosted runner's rebound `HOME` / `VAULT` model; hosted transcription itself is Worker-mediated Workers AI and is covered by `apps/cloudflare/test/runner-egress-intercept.test.ts`, the parsers remote-transcription provider tests, and the `linq-webhook` hosted-local E2E CI gate (fake `AI` binding, real egress route) instead of an in-image speech model. The runner bundle packer uses runner-specific tarballs for the CLI shell and Health Commons so E2E and deploy bundles keep the same CLI/runtime/catalog surfaces without the public npm package's nested bundled workspace payload or web-only Health Commons artifacts. The manual workflow `.github/workflows/deploy-cloudflare-hosted.yml` runs protected-main-only Cloudflare deploy jobs on Blacksmith: hosted-local E2E gates start loopback Postgres containers, install Temporal CLI, run `codex-gateway-prefix` and `linq-delivery` with `MURPH_HOSTED_LOCAL_E2E_FAST_GATE=1`, and run `linq-scheduled-reminder` with its full one-minute reminder lead and 10-second idle checkpoint. Normal Worker deploy runs add a Blacksmith runner smoke gate that prepares the runner bundle/base image before running the focused Cloudflare verify lane plus `runner:docker:smoke:prepared-base` from the same commit. `pnpm cf:deploy:immediate` remains the break-glass path that skips those E2E/smoke gates while still requiring the protected-main hosted Codex auth guard. The Blacksmith deploy job attaches the production environment, verifies the protected-main checkout, assembles the runner bundle and native base image without step-scoped production secrets, renders deploy config and Worker secrets, dry-runs the generated Wrangler deploy bundle, executes a direct `wrangler deploy`, reads `wrangler deployments status --json` for the smoke version and final traffic summary, validates the required GitHub environment wiring up front including `CF_PUBLIC_BASE_URL` for smoke runs, declares the required hosted runtime secrets through generated Wrangler config, and pairs the deploy docs with a checked-in transient R2 lifecycle config/helper. Gradual deploys run deployed managed-container runner-bundle and assistant CLI surface smoke with a longer retry window so Cloudflare has time to surface the new container application version; `container_rollout=immediate` adds the stricter direct-R2 managed-container smoke, and the `live_model_turn` workflow input (default on) adds one real `gpt-5.6-terra` `codex exec` turn from the deployed container through the Worker OpenAI egress intercept; that turn runs in production-deploy smoke only, never per-PR CI or hosted-local E2E. Hosted prompt-cache prefix drift, core Linq delivery regressions, scheduled Linq reminder regressions, runner-image regressions, missing deployed assistant CLI hot-path schemas, or invalid generated deploy bundles therefore block `pnpm cf:deploy`-triggered deploys before or immediately after the real deploy step; the immediate path keeps the deploy job's own build validation, deploy, and strict managed-container smoke checks. Live deployment still depends on operator-supplied Cloudflare credentials, GitHub environment wiring, first-time container provisioning in Cloudflare, and an operator applying the bucket lifecycle rules to the real R2 buckets.
- The tag-driven release workflow is present, uses npm trusted publishing for package publication, runs a slimmer `release:check` guard path that now validates release metadata plus `pnpm build:workspace:clean` and `pnpm verify:acceptance` without re-installing/re-building/re-packing inside the script, and is only exercised on real `v*.*.*` tag pushes rather than during ordinary repo verification. npm trust is package-level rather than repo-level, so this monorepo also ships `pnpm release:trust:github` for the one-time bootstrap that binds every publishable `@murphai/*` package to `cobuildwithus/murph` and `.github/workflows/release.yml`; if a package already has the wrong trusted publisher entry, that npm-side state still needs manual revoke-and-recreate repair, which local repo checks cannot fully prove.

## Update Rule

When real source code, CI, or deployment automation is added, update this file and `agent-docs/operations/verification-and-runtime.md` in the same change.
