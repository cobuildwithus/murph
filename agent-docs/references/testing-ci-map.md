# Testing And CI Map

Last verified: 2026-08-11

## Current Repo Checks

| Command | Purpose | Current coverage |
| --- | --- | --- |
| `pnpm typecheck` | Full workspace type proof through stable TypeScript 7. Independent guards overlap the clean contracts prerequisite; package/app no-emit checks use bounded no-sort fanout. The hosted web invokes the root compiler explicitly while retaining local TypeScript 5 only for framework/Solana tools that still require the legacy compiler API or peer range. Repo-owned source-analysis checks use Babel's parser instead of a TypeScript compiler API, leaving the web-local TypeScript 5 boundary independently removable once its consumers support TypeScript 7. Tsconfig path-map discovery reads root configs shallowly and scans only `packages/**` plus `apps/**`, avoiding unrelated local residue. Repo tools reuse an ignored incremental cache. | `scripts/*.{sh,mjs,ts}`, `e2e/smoke/verify-scenario-integrity.ts`, `packages/contracts/**`, `packages/clinical-records/**`, `packages/hosted-execution/**`, `packages/hosted-local-harness/**`, `packages/runtime-state/**`, `packages/operator-config/**`, `packages/assistant-engine/**`, `packages/assistant-cli/**`, `packages/setup-cli/**`, `packages/cli/**`, `packages/openclaw-plugin/**`, `packages/core/**`, `packages/importers/**`, `packages/device-syncd/**`, `packages/inboxd/**`, `packages/parsers/**`, `packages/assistantd/**`, `packages/assistant-runtime/**`, `packages/health-metrics/**`, `packages/query/**`, `apps/web/**`, `apps/cloudflare/**`, `config/workspace-source-resolution.ts` |
| `pnpm test:repo-tools` | Focused Vitest coverage for repo-owned verification/config helpers. `test:diff` selects it for `scripts/**` and `config/**` changes, and the host-support release typecheck job runs it directly. The design-proof uploader tests use fixture-only credentials and a stubbed fetch boundary while proving primary-checkout env discovery from a real temporary linked worktree, lossless high-resolution input gates, and creation or validation of the dedicated non-downscaling delivery variant. | `scripts/**/*.test.ts` plus the shared config helpers those tests import, including `scripts/upload-design-proof-image.ts` |
| `pnpm exec vitest run scripts/frog-autofix.test.ts --config scripts/vitest.config.ts --no-coverage` | Focused local Frog autofix proof. It validates the production GraphQL App author/label/binding selection and result cap, oldest-first admission, safe tracked/untracked/ignored interruption cleanup, fresh/resume-only recovery, authenticated-operator/same-repository PR authority with fork records removed before cardinality, parent-owned ReviewGPT patch and response parsing, network-denied edit-only worker arguments, private PR metadata, descendant and closed-unmerged handoff continuity, terminal check/conflict handoff versus transient retry, local-agent-only merge classification, product-runtime pause, live authority/head/check/merge revalidation, GitHub remote normalization, LaunchAgent privacy/cadence, real two-process native-lock contention, real and simulated leader-first process-group timeout/reaping, cleanup ordering, and process-start-token JSON owner recovery inside the native gate. The live read-only companion is `scripts/frog-autofix scan`; post-merge installation/status/run proof remains manual because it depends on the current user's authenticated GitHub, Codex, ReviewGPT browser, and launchd session. | `scripts/frog-autofix`, `scripts/frog-autofix.ts`, `scripts/frog-autofix-lib.ts`, `scripts/frog-autofix-command.ts`, `scripts/frog-autofix-finalize.ts`, `scripts/frog-autofix-parent.ts`, `scripts/frog-autofix-recovery.ts`, `scripts/frog-autofix-worker.md`, `.agents/friction-log/README.md`, and the local Frog autofix sections of the architecture, security, reliability, and verification docs |
| `pnpm provider-requests:guard` | Babel-based static guard, included in root typecheck and diff preflight, that rejects object spreads, `Object.assign`, and untyped object-literal request variables at registered official provider SDK boundaries. It covers Stripe, Kernel, Linq, Retell, Temporal, OpenAI, and Junction calls and typed builders across production apps, packages, and scripts so optional provider keys remain visible to the SDK declarations. | `apps/**`, `packages/**`, `scripts/**`, `scripts/check-provider-request-boundaries.ts`, and `scripts/check-provider-request-boundaries.test.ts` |
| `pnpm hosted-billing:ci-guard` | Source-level drift guard for the hosted Stripe billing workflow. It forbids `pull_request_target`, requires the every-PR hermetic Starter-checkout/migration/config/support proof, pins the same-repository and dependency-bot exclusion, keeps writable authority out of pre-live jobs, requires serial non-canceling cleanup, and allows only the redacted matrix diagnostic artifact. Repo Hygiene runs this guard, and focused mutation tests live under `scripts/check-hosted-stripe-billing-ci.test.ts`. | `.github/workflows/hosted-stripe-billing.yml`, `.github/workflows/repo-hygiene.yml`, `packages/hosted-local-harness/src/e2e.ts`, the five-case browser matrix, and the root command contract |
| `pnpm hosted-local e2e stripe-billing-browser-matrix` | Manual/local or trusted-CI production-shaped billing proof against a dedicated Stripe test sandbox. It drives Murph, Stripe Checkout/Portal, real test APIs, the harness-owned webhook listener, local PostgreSQL reconciliation, Settings projections, a renewal schedule, and web Family activation. It is intentionally excluded from default hosted-local E2E and requires preflighted operator configuration. | `apps/cloudflare/test/hosted-local-stripe-billing-browser-e2e.test.ts`, browser/Stripe/testkit support under `apps/web/test/support/**`, and canonical hosted-local lifecycle |
| `pnpm test:frontend-design-proof` | Focused Node tests for the pull-request design-proof guard. The guard requires every user-facing hosted-web UI diff to update the reusable-component or composed-section design catalog and to provide hosted desktop and mobile design-page screenshots in the PR body. It validates GitHub-rendered GFM so comments, code blocks, and raw HTML cannot be mistaken for visible proof. | `scripts/check-frontend-design-proof.mjs`, `scripts/check-frontend-design-proof.test.mjs`, `.github/workflows/frontend-design-proof.yml`, and `.github/pull_request_template.md` |
| `pnpm exec vitest run --config apps/web/vitest.workspace.ts --no-coverage apps/web/test/hosted-onboarding-stripe-alert-email.test.ts apps/web/test/hosted-onboarding-stripe-alert-integration.test.ts apps/web/test/hosted-onboarding-logging.test.ts apps/web/test/hosted-onboarding-stripe-webhook-service.test.ts apps/web/test/hosted-onboarding-stripe-event-reconciliation.test.ts apps/web/test/hosted-onboarding-billing-service.test.ts apps/web/test/hosted-family-plan.test.ts apps/web/test/hosted-onboarding-billing-plan-change-service.test.ts apps/web/test/hosted-onboarding-billing-plan-switch-to-pulse-service.test.ts apps/web/test/hosted-onboarding-billing-checkout-route.test.ts apps/web/test/hosted-starter-usage-migration.test.ts apps/web/test/hosted-onboarding-runtime.test.ts apps/web/test/sync-hosted-linq-lines-script.test.ts apps/web/test/hosted-usage-credit-purchase-service.test.ts apps/web/test/hosted-usage-credit-stripe-reconciliation.test.ts` | Focused Stripe failure-alert proof for shared website/Assistant terminal billing actions, including mandatory price reads, customer provisioning, saved-card preparation, Checkout Session creation, Starter-to-paid conversion, paid-plan upgrades, scheduled plan switches, Family replacement-attempt, paid capacity, member-tier, and complete-effect identity, preserved safe request correlation across hosted-error translation, ordinary-Node production line-sync and Stripe-migration runtime imports, the blind-bound final Family redirect read versus unknown public IDs, explicit group-sponsorship recovery versus no-charge reactivation, log-only recovered provider errors, canonical verified payment-failure webhooks, first-attempt reconciliation reporting, replay identity, real Resend request serialization, private-data exclusion, and unchanged billing control flow. | `apps/web/src/lib/hosted-onboarding/{billing-service,billing-plan-change-service,billing-plan-switch-to-pulse-service,family-plan,runtime,stripe-alert-email,stripe-error-fields,stripe-error-log,usage-credit-purchase-service,webhook-service-stripe,stripe-event-reconciliation}.ts` and their focused hosted-web tests |
| `node --test scripts/check-pr-architecture-summary.test.mjs` | Focused Node tests for the every-PR architecture-and-reuse summary guard. The guard requires concrete bullets for reused systems, new logic, new abstractions, and intentionally avoided complexity, and rejects blank or bare placeholder answers. | `scripts/check-pr-architecture-summary.mjs`, `scripts/check-pr-architecture-summary.test.mjs`, `.github/workflows/frontend-design-proof.yml`, and `.github/pull_request_template.md` |
| `pnpm test:diff` | Self-contained diff-aware agent/local lane. It maps paths to owners plus reverse dependents, runs relevant guards, then batches exact package typecheck/test scripts through bounded pnpm fanout with one CPU-derived nested Vitest budget. Assistant Engine tests retain the package's proven 6 GiB heap ceiling while staying within that worker budget. The command holds the workspace artifact lock from producers through dependent consumers, package-boundary follow-ups remain intact, and two affected apps reuse the prepared parallel app lane. Tooling-only diffs stay narrow; root manifests broaden to the workspace. Do not precede a truthful scoped run with redundant root `pnpm typecheck`. | Affected workspace owners plus reverse dependents under `packages/**` and `apps/**`, repo-internal tooling fast-path files under `agent-docs/**`, `docs/**`, `scripts/**`, `AGENTS.md`, `ARCHITECTURE.md`, `README.md`, `package.json`, `vitest.config.ts`, and root `tsconfig*.json`, plus whole-workspace fan-out when root workspace manifests change, the nested built-CLI verification lane only for CLI artifact-sensitive diffs, and explicit built package-boundary scripts for affected hosted-local-harness/inboxd/messaging-ingress diffs |
| `pnpm test` | Fast deterministic behavior loop under the artifact lock. It incrementally refreshes and verifies contracts, runs root multi-project Vitest, and overlaps fixture/scenario-manifest verification locally. Package projects share one bounded worker pool; four independent CLI buckets share the next phase and five explicit serial buckets remain isolated. Full acceptance retains clean-build semantics. | `packages/contracts/**`, `packages/clinical-records/**`, `packages/hosted-execution/**` including hosted execution auth/env/client/computer-use, phone-call, plan-usage `add_usage`, and exact Settings URL contract coverage, `packages/runtime-state/**` including hosted workspace-snapshot and artifact-externalization coverage plus hosted verified-email env helper coverage and assistant usage record parsing, `packages/operator-config/**` including setup/runtime-env/config persistence coverage, `packages/assistant-engine/**` including the local assistant runtime, provider-turn, tool-catalog, hosted computer dynamic tools, ordinary group-newsletter recipe coverage, current-chat scheduling, generic one-shot group-email effects and durable outbox execution, outbox, direct hosted usage recorder, and owner-boundary coverage, `packages/assistant-cli/**` including CLI-only assistant wrappers, terminal logging, assistant command routing, and Ink chat UI coverage, `packages/setup-cli/**` including onboarding, host setup, and setup-wizard coverage, `packages/cli/**` including the published shell, command-schema coverage, CLI `.env` loading coverage, compatibility-wrapper coverage, and assistantd client routing coverage, `packages/openclaw-plugin/**` including the published OpenClaw bundle metadata and Murph skill guidance package-local test, `packages/core/**`, `packages/importers/**`, `packages/device-syncd/**` including the Oura and WHOOP config/provider/service tests plus HTTP control-plane auth/listener coverage, `packages/inboxd/**` including AgentMail email connector tests plus shared Linq webhook verification coverage, `packages/parsers/**`, `packages/assistantd/**` including loopback host validation, bearer-authenticated control-plane routing, single-vault request enforcement, and the direct owner-package boundary regressions, `packages/assistant-runtime/**` including hosted assistant profile seeding/adoption coverage, fail-closed hosted automation gating, scheduled group-email route validation, hosted verified-email self-target reconciliation coverage, durable email fanout child replay classification, direct-session pre-provider checkpoint eligibility and quiescence, the direct owner-package boundary checks for hosted consumers, selective hosted artifact materialization, preserved-artifact snapshot behavior, direct hosted AI usage recording, explicit runtime-env projection, Cloudflare-managed proxy env preservation, per-user warm workspace roots, invocation-local writable cache/temp roots, runtime wake coalescing, and container cleanup poisoning when process residue cannot be proven, `packages/health-metrics/**`, `packages/query/**`, `fixtures/**`, `e2e/smoke/scenarios/**` |
| `pnpm verify:acceptance` | Canonical CI/release acceptance gate. It runs the root verifier's full typecheck surface first, then the coverage-heavy acceptance lane while skipping only work already proven inside the same acceptance process: repeated repo guards, Cloudflare app-local typecheck, and the contracts artifact rebuild. On capable non-CI default-profile hosts with at least 12 logical CPUs, including forced local execution from a Codex/shared-host process and Blacksmith, the composed acceptance profile first overlaps independent doc gardening and prepared-runtime setup, then overlaps package coverage, scenario-integrity coverage, and Web tests/lint/dev smoke. It protects subprocess-heavy CLI coverage with four workers and one two-worker package peer; CLI terminal state publishes an invocation-scoped marker that releases the hosted-web Next build and Cloudflare's serial app tests without hiding CLI failure and lets package fanout refill to at most five two-worker processes. The root verifier, not the Crabbox bootstrap, owns that default-profile Web-parallel/Cloudflare-serial policy. Static SSH is executor-owned: native `tar` plus the production-compatible `zstd` stdin round trip must pass before candidate inspection or install, and the runner stamps `profile=static-ssh`. At least 10 logical CPUs and 24 GiB of detected physical memory admit its composed three-process package refill, three-worker CLI, one-worker app pools, and app/fixture overlap; smaller or memory-unobservable workers retain the two-process serial fallback. Caller tuning cannot change either plan, and the `resources` line reports the measured capacity and effective controls. Smaller default-profile hosts retain the conservative shared-host profile, and CI keeps app/package overlap opt-in through `MURPH_ACCEPTANCE_APP_VERIFY_WITH_COVERAGE=1`. | The full `pnpm typecheck` surface plus the full `pnpm test:coverage` coverage/app/smoke surface below, without duplicate guard/typecheck/build repeats inside the same command |
| `pnpm docs:drift` | Manual durable-doc drift check. Use this when you intentionally change durable repo docs and want the old index/truthfulness enforcement without making the default `pnpm test` lane sensitive to unrelated dirty-tree doc work. | `AGENTS.md`, `ARCHITECTURE.md`, `agent-docs/**`, `README.md`, `package.json` |
| `pnpm --dir packages/health-commons verify` | Package-local Health Commons verification. Use this for authored Health Commons content, generator, schema, or package test changes. Root acceptance regenerates the ignored catalog for app/typecheck consumers, but does not replace this package-local check. | `packages/health-commons/**` |
| `pnpm test:coverage` | Coverage-focused acceptance lane, not the default local loop. It composes dependency/workspace/doc/artifact guards, prepared package coverage, scenario-integrity coverage, and app verification. Standalone default-profile local coverage uses CPU-aware package fanout capped at six outer processes with a divided inner worker budget; the capable-host `verify:acceptance` composition uses two package processes during protected CLI coverage and refills to five after CLI while apps overlap. A resource-qualified `static-ssh` acceptance uses a three-worker CLI plus one two-worker package peer, then refills to three two-worker package processes while one-worker app pools and fixture verification overlap. Smaller or memory-unobservable static workers retain the serial two-process/two-worker fallback. The static profile ignores caller worker and overlap controls. CI remains serial by default. Acceptance reuses the preceding typecheck's generated inputs and holds one artifact lock across both phases, while standalone coverage remains self-contained. Existing app/package overlap, delay, retry, and CI override controls remain available only where the selected default/CI profile permits them. | `agent-docs/**`, `ARCHITECTURE.md`, `README.md`, `docs/contracts/03-command-surface.md`, `packages/{assistant-cli,assistant-engine,assistant-runtime,assistantd,cli,cloudflare-hosted-control,clinical-records,contracts,core,device-syncd,gateway-core,health-metrics,hosted-execution,hosted-local-harness,importers,inbox-services,inboxd,messaging-ingress,openclaw-plugin,operator-config,parsers,query,runtime-state,setup-cli,vault-usecases}/**`, `apps/web/**`, `apps/cloudflare/**`, `fixtures/**`, `e2e/smoke/**` |
| `pnpm test:packages` | Package-only behavior verification. It incrementally refreshes contracts, runs every root-wired package project once, and executes nine CLI buckets: four independent buckets in one bounded phase plus five explicit serial smoke phases. App verification and built-runtime/package-shape acceptance stay in their dedicated commands. | `packages/{assistant-cli,assistant-engine,assistant-runtime,assistantd,cloudflare-hosted-control,clinical-records,contracts,core,device-syncd,gateway-core,health-metrics,hosted-execution,importers,inbox-services,inboxd,messaging-ingress,openclaw-plugin,operator-config,parsers,query,runtime-state,setup-cli,vault-usecases}/**`, plus `packages/cli/**` through its source-first workspace buckets |
| `pnpm test:apps` | Parent-locked app verification. It prepares Health Commons output and the hosted-web Prisma client once, then runs `apps/web verify` and `apps/cloudflare verify` concurrently locally or serially in CI. Hosted-web verification completes its TypeScript 7 source check before Next uses the web-local TypeScript 5 compatibility compiler to validate freshly generated route and page contracts; both checks remain fail-closed. The children retain their existing build, lint, smoke, test, app-local worker, and acceptance-skip behavior without racing duplicate generation. | `apps/web/**` and `apps/cloudflare/**`, including hosted-web lint/dev-smoke/production build, Cloudflare Node and Workers tests, and shared source-resolution wiring |
| `pnpm test:packages:coverage` | Package coverage after prepared runtime/artifact hygiene. Local outer fanout is CPU-aware and capped at six processes; each process receives the remaining CPU budget instead of a percentage that multiplies across the fanout. CI remains one outer process with a 50% inner cap. Contracts/CLI ordering, coverage thresholds, failure aggregation, and built package-boundary checks remain intact. | Package-wide coverage under `packages/{assistant-cli,assistant-engine,assistant-runtime,assistantd,cli,cloudflare-hosted-control,clinical-records,contracts,core,device-syncd,gateway-core,health-metrics,hosted-execution,hosted-local-harness,importers,inbox-services,inboxd,messaging-ingress,openclaw-plugin,operator-config,parsers,query,runtime-state,setup-cli,vault-usecases}/src/**/*.ts`, plus sequential built package-boundary checks for `packages/hosted-local-harness`, `packages/messaging-ingress`, and `packages/inboxd` |
| `pnpm test:scenario-integrity` | Root command for fixture/scenario-manifest integrity verification; this lane is not executable end-to-end smoke today. | `fixtures/**`, `e2e/smoke/**`, `docs/contracts/03-command-surface.md` |
| `pnpm --dir apps/web test:viewport-overflow` | Playwright gate that renders each public marketing route, including Murph Safe search, at 320/375/390/768/1280px and fails on horizontal document overflow. It also exercises the Murph Safe explicit-submit privacy, grouped-result, detail-link, empty, error, and rate-limit browser states. Playwright owns the dev-server lifecycle (`apps/web/playwright.config.ts` `webServer`) and boots hosted-web with the placeholder smoke env on its own `.next-smoke-overflow` dist dir, so the public pages render anonymously without real secrets. Runs in its own CI workflow rather than `apps/web verify` so Chromium stays out of build/lint/unit-test lanes. | `apps/web/e2e/**`, `apps/web/playwright.config.ts`, and the public routes listed in `apps/web/e2e/viewport-overflow.spec.ts` |
| `MURPH_SAFE_E2E_PRODUCT_REF=... MURPH_SAFE_E2E_PRODUCT_NAME=... MURPH_SAFE_E2E_QUERY=... MURPH_SAFE_E2E_EXPECTED_TEST_ID=... pnpm --dir apps/web exec playwright test e2e/murph-safe-production-seam.spec.ts` | Opt-in rendered production-seam proof against an explicitly seeded local labels database. It uses the real POST search route, validates the public detail contract and exact selected-record test id, renders the server detail at phone and desktop widths, and checks detail overflow. `MURPH_SAFE_E2E_EXCLUDED_TEST_ID` can prove that a same-canonical sibling observation is absent. | Murph Safe public search route, shared service, labels SQL, contract, and server-rendered detail page |
| `MURPH_IMESSAGE_ENROLLMENT_TEST_DB_URL="$LOCAL_POSTGRES_URL" pnpm exec vitest run --config apps/web/vitest.config.ts apps/web/test/imessage-mini-app-account-deletion.db.test.ts --no-coverage` | Opt-in real-PostgreSQL proof for bounded Messages credential rotation and enrollment versus account deletion against an isolated, migrated local test database. The URL guard permits only loopback or local socket targets; the ordinary hosted-web workspace excludes `*.db.test.ts`, and the focused config additionally skips this suite when the dedicated variable is absent. | Repeated enrollment rotates one Messages-owned row while invalidating prior bearers and preserving ordinary sessions, including stale-generation self-revocation, re-enrollment after revocation and expiry, plus both deletion-first and enrollment-first serialization orders with final absence of the member and its device-agent session |
| `DATABASE_URL="$LOCAL_POSTGRES_URL" MURPH_TEST_POSTGRES_CONCURRENCY=1 pnpm exec vitest run --config apps/web/vitest.workspace.ts --no-coverage apps/web/test/prisma-database-retry-postgres.test.ts` | Opt-in real-PostgreSQL proof that the shared Prisma client returns visible local saturation as backpressure and retries only ambiguous failures that did no work. The suite rejects non-loopback database URLs and runs in the hosted E2E PostgreSQL job after migrations. | A contended transaction-start timeout is not retried and never invokes its callback, a real pool-checkout timeout on an ordinary non-transaction write is not retried and persists no row, and a transaction that opened and then expired raises the same `P2028` code without being replayed |
| `DATABASE_URL="$LOCAL_POSTGRES_URL" MURPH_TEST_POSTGRES_CONCURRENCY=1 pnpm exec vitest run --config apps/web/vitest.workspace.ts --no-coverage apps/web/test/browser-assertion-nonce-postgres-concurrency.test.ts` | Opt-in real-PostgreSQL proof for browser assertion replay admission and bounded hourly nonce retention. The suite rejects non-loopback database URLs, uses independent one-connection Prisma clients, and runs after migrations. | Two simultaneous inserts for one nonce yield exactly one winner; cleanup skips a locked expired row without delaying an unrelated fresh insert, then deletes the expired row after release while preserving the fresh row; and an insert that resumes after same-nonce retention commits past expiry fails closed while restoring the tombstone. |
| `DATABASE_URL="$LOCAL_POSTGRES_URL" MURPH_TEST_POSTGRES_CONCURRENCY=1 pnpm exec vitest run --config apps/web/vitest.workspace.ts --no-coverage apps/web/test/hosted-callback-request-nonce-postgres-concurrency.test.ts` | Opt-in real-PostgreSQL proof for signed hosted-Web callback replay admission and hourly nonce retention. The suite rejects non-loopback database URLs, uses independent one-connection pools, and runs after migrations. | Simultaneous insert-only consumption of one nonce has exactly one winner through primary-key uniqueness; bounded retention skips a separately locked expired row without blocking an unrelated fresh nonce insert, then deletes the expired row after release while preserving the fresh row. |
| `DATABASE_URL="$LOCAL_POSTGRES_URL" MURPH_TEST_POSTGRES_CONCURRENCY=1 pnpm exec vitest run --config apps/web/vitest.workspace.ts --no-coverage apps/web/test/device-sync-dirty-reconnect-retention-postgres.test.ts` | Opt-in real-PostgreSQL proof for dirty-payload credential authority across canonical same-account replacement. Run after migrations. | Actual Web-store admission persists one credential-independent and one credential-scoped row; canonical reconnect retains only the independent row; hydration returns that exact payload; and ordinary acknowledgement drains it without replaying the retired credential-scoped work. |
| `DATABASE_URL="$LOCAL_POSTGRES_URL" MURPH_TEST_POSTGRES_CONCURRENCY=1 pnpm exec vitest run --config apps/web/vitest.workspace.ts --no-coverage apps/web/test/device-sync-dirty-reconnect-consent-postgres.test.ts` | Opt-in real-PostgreSQL proof for mixed-version dirty-payload classification versus health-data consent withdrawal. Run after migrations. | Withdrawal-first ordering blocks reconnect on the member row and then rejects without decrypting or classifying the nullable payload; reconnect-first ordering holds the same member fence through legacy classification, makes withdrawal wait, and then permits revocation to commit normally. |
| `DATABASE_URL="$LOCAL_POSTGRES_URL" MURPH_TEST_POSTGRES_CONCURRENCY=1 pnpm exec vitest run --config apps/web/vitest.workspace.ts --no-coverage apps/web/test/device-sync-dirty-reconnect-ack-postgres.test.ts` | Opt-in real-PostgreSQL proof for mixed-version reconnect classification versus dirty-payload acknowledgement. Run after migrations. | Acknowledgement-first makes reconnect wait on the dirty marker before legacy decryption; reconnect-first retains the marker through classification while acknowledgement waits; both schedules complete without a marker/payload deadlock and leave the replacement active with processed work drained. |
| `DATABASE_URL="$LOCAL_POSTGRES_URL" MURPH_TEST_POSTGRES_CONCURRENCY=1 pnpm exec vitest run --config apps/web/vitest.workspace.ts --no-coverage apps/web/test/device-sync-db-spike-resilience-postgres.test.ts` | Opt-in real-PostgreSQL replay for the 2026-08-10 device-sync database spike. The suite rejects non-loopback database URLs and requires the current migrations. | Exactly 1,641 synthetic webhook receipts retain their original 120-second distribution and 31-receipt peak while a compressed 31-wide admission lane overlaps 20 runtime snapshots and 40 foreground reads. The proof caps the application pool at 15, samples PostgreSQL sessions, asserts the narrow connection/source query bounds, preserves live source admission, completes every trace and signal, advances the receipt timestamp monotonically, and drains dirty state without production data. |
| `DATABASE_URL="$LOCAL_POSTGRES_URL" MURPH_TEST_POSTGRES_CONCURRENCY=1 pnpm exec vitest run --config apps/web/vitest.workspace.ts --no-coverage apps/web/test/initial-onboarding-postgres-concurrency.test.ts` | Opt-in real-PostgreSQL proof for initial-onboarding rollout compatibility and first-writer-wins serialization. The suite rejects non-loopback database URLs and runs after migrations. | The exact migration SQL backfills existing rows, its temporary default completes a legacy omitted-column insert, the current explicit-null insert stays pending, and independent Web-save/iOS-skip Prisma transactions serialize in both controlled winner orderings without loser preference overwrite |
| `DATABASE_URL="$LOCAL_POSTGRES_URL" MURPH_TEST_POSTGRES_CONCURRENCY=1 pnpm exec vitest run --config apps/web/vitest.workspace.ts --no-coverage apps/web/test/hosted-execution-usage-postgres-concurrency.test.ts` | Opt-in real-PostgreSQL proof for deterministic hosted usage replay. The suite rejects non-loopback database URLs and runs in the hosted E2E PostgreSQL job after migrations. | A first writer holds an uncommitted deterministic usage row while an exact concurrent replay waits; both transactions complete after release and the ledger retains one immutable row |
| `DATABASE_URL="$LOCAL_POSTGRES_URL" MURPH_TEST_POSTGRES_CONCURRENCY=1 pnpm exec vitest run --config apps/web/vitest.workspace.ts --no-coverage apps/web/test/hosted-accepted-attempt-recheck-postgres-concurrency.test.ts` | Opt-in real-PostgreSQL proof that the accepted-attempt recheck cooldown elects one owner. The claim replaced a runtime-log-row election, so exactly-one-winner is now PostgreSQL conditional-update semantics rather than application logic. Runs in the hosted E2E PostgreSQL job after migrations. | Two concurrent claims at the same logical time yield exactly one winner; a claim at the cooldown boundary is denied; a claim past the boundary succeeds |
| `DATABASE_URL="$LOCAL_POSTGRES_URL" MURPH_TEST_POSTGRES_CONCURRENCY=1 pnpm exec vitest run --config apps/web/vitest.workspace.ts --no-coverage apps/web/test/hosted-workspace-checkpoint-postgres.test.ts` | Opt-in real-PostgreSQL proof for the Web-owned workspace checkpoint CAS and its atomic set-based mailbox acknowledgement. The suite rejects non-loopback database URLs and runs after migrations. | A successful versioned workspace update returns the successor and replaced snapshot; exact same-user conversation items stamp only within lane, kind, and imported bounds; live gaps stop the contiguous replay floor while expired or retention-old rows do not; system and conversation counters stay monotonic and within append high-water; CAS loss changes no dependent row; and a concurrent committed append is observed as `conversationInputAhead` without rejecting the checkpoint |
| `DATABASE_URL="$LOCAL_POSTGRES_URL" MURPH_TEST_POSTGRES_CONCURRENCY=1 pnpm exec vitest run --config apps/web/vitest.workspace.ts --no-coverage apps/web/test/hosted-onboarding-linq-home-routing-postgres.test.ts` | Opt-in real-PostgreSQL proof for hosted Linq proactive-capacity, edit-source, and member-route concurrency. The suite rejects non-loopback database URLs and runs in the hosted E2E PostgreSQL job after migrations. | One blind source-message key serializes concurrent edit lineage reads, while an edit racing an uncommitted ordinary source append sees the retryable missing-source state and resolves the source after commit; the final daily slot admits exactly one claim; concurrent direct-Telegram contact requests converge on one encrypted home-line assignment without a chat binding or proactive-capacity claim; activation, first-contact, reclassification, and participant routing serialize on the member owner; and real Telegram/Linq planners complete in both routing orders for already-active members and for an inbound reclassified after an uncommitted activation, while retaining both bindings and exactly one mailbox item per event |
| `DATABASE_URL="$LOCAL_POSTGRES_URL" MURPH_TEST_POSTGRES_CONCURRENCY=1 pnpm exec vitest run --config apps/web/vitest.workspace.ts --no-coverage apps/web/test/hosted-pending-group-setup-postgres-concurrency.test.ts` | Opt-in real-PostgreSQL proof for the encrypted one-use next-Linq-group transfer envelope. The suite rejects non-loopback database URLs and runs in the hosted E2E PostgreSQL job after migrations. | Two simultaneous group claims yield exactly one decrypted setup; exact restore preserves its payload, a stale restore cannot overwrite a replacement, corrupt ciphertext is consumed without blocking admission, a provider-correlated replacement-line intent retains the exact prepared owner when another roster member speaks first while rejecting a foreign roster and thread, the setup is consumed once, and deleting the owner cascades re-armed state |
| `DATABASE_URL="$LOCAL_POSTGRES_URL" MURPH_TEST_POSTGRES_CONCURRENCY=1 pnpm exec vitest run --config apps/web/vitest.workspace.ts --no-coverage apps/web/test/hosted-onboarding-linq-recent-message-load-postgres.test.ts` | Opt-in real-PostgreSQL proof for Hosted Linq recent line-load derivation and its bounded query plan. The suite rejects non-loopback database URLs and runs in the hosted E2E PostgreSQL job after migrations. | Canonical accepted delivery and inbound-message ledgers count only effects in the inclusive trailing seven-day window, while the exact production query uses both partial `(line, time)` indexes under representative historical load |
| `DATABASE_URL="$LOCAL_POSTGRES_URL" MURPH_TEST_POSTGRES_CONCURRENCY=1 pnpm exec vitest run --config apps/web/vitest.workspace.ts --no-coverage apps/web/test/hosted-group-join-outreach-reply-recovery-postgres.test.ts` | Opt-in real-PostgreSQL proof for group-join outreach, reply recovery, and deletion fences. The suite rejects non-loopback database URLs and runs in the hosted E2E PostgreSQL job after migrations. | Focused cases prove provider-native replies select the exact older or newer accepted opener when two group intents share one direct chat and an unmatched anchor selects neither; exact reply occurrence and direct outreach correlation survive retries; failed and distinct replies remain independently recoverable; generic/group terminal receipts converge in both orders; phone-bound member creation, opener dispatch, and immediate reply planning serialize on the same participant lock; a committed inactive member still receives the opener, activation and opener dispatch converge in either lock order, and that member's reply retains the exact group-aware signup context; a concurrently accepted group link suppresses a fresh generic dispatch under that member lock; membership appearing before a fresh dispatch forces canonical replanning without a provider call; opener dispatch and account deletion converge with either fence winning; group-reply deletion races preserve daily suppression until the final live delivery is gone; and provider-body stalls, drain contention, and buffered terminal failure remain bounded and recoverable |
| `DATABASE_URL="$LOCAL_POSTGRES_URL" MURPH_TEST_POSTGRES_CONCURRENCY=1 pnpm exec vitest run --config apps/web/vitest.workspace.ts --no-coverage apps/web/test/hosted-onboarding-member-lock-postgres.test.ts` | Opt-in real-PostgreSQL proof for bounded hosted-member Stripe mutation lock acquisition, reversal freshness/suspension ownership, and the Privy deletion/authentication handoff. The suite rejects non-loopback database URLs and runs in the hosted E2E PostgreSQL job after migrations. | One transaction holds the production member row, an independent same-member contender fails with the typed busy error before its callback can run, and a foreground retry succeeds after the owner commits; full-refund and withdrawn-dispute progress commits and exact replay stays idempotent; two distinct reversals defeat an older restore in sequential and concurrent schedules; terminal Privy cleanup deletes the provider principal and receipt before stale authentication resumes, after which live-provider authority rejects replacement member, identity, and session state |
| `DATABASE_URL="$LOCAL_POSTGRES_URL" MURPH_TEST_POSTGRES_CONCURRENCY=1 pnpm exec vitest run --config apps/web/vitest.workspace.ts --no-coverage apps/web/test/hosted-onboarding-privy-phone-transfer-postgres.test.ts` | Opt-in real-PostgreSQL proof for Settings phone-transfer lock ordering across the target's prior phone and the transferred phone. The suite rejects non-loopback database URLs and runs in the hosted E2E PostgreSQL job after migrations. | Both writer orderings preserve the transferred phone after source retirement: prior-phone work admitted first completes before the transfer, while a transfer admitted first blocks later prior-phone work until the old identity can no longer resolve to the target; null prior phones and equivalent normalized numbers acquire one advisory lock |
| `DATABASE_URL="$LOCAL_POSTGRES_URL" MURPH_TEST_POSTGRES_CONCURRENCY=1 pnpm exec vitest run --config apps/web/vitest.workspace.ts --no-coverage apps/web/test/clinical-records-account-deletion-postgres-concurrency.test.ts` | Opt-in real-PostgreSQL proof for the Clinical Records callback, scoped domain-root cache, and production account-deletion boundary. The suite rejects non-loopback database URLs and runs after migrations. | A delayed ingress-root prewarm prevents persistence until the exact root is available, then the scoped cache reuses its verified read and decrypt for one atomic connection, generation-1 run, completed intent, and mailbox wake; a post-commit runtime-signal failure preserves the truthful connected redirect and recoverable durable set; callback-first member foreign-key ownership blocks production account deletion until the callback commits, after which deletion removes the committed Clinical Records, mailbox, and member rows; deletion-first member-row ownership blocks the callback before intent completion or mailbox append, commits deletion, and forces the real callback route to fail closed without a surviving connection, run, wake, or runtime signal. |
| `DATABASE_URL="$LOCAL_POSTGRES_URL" MURPH_TEST_POSTGRES_CONCURRENCY=1 pnpm exec vitest run --config apps/web/vitest.workspace.ts --no-coverage apps/web/test/hosted-onboarding-telegram-routing-postgres.test.ts` | Opt-in real-PostgreSQL proof for concurrent hosted Telegram routing writes. The suite rejects non-loopback database URLs and runs in the hosted E2E PostgreSQL job after migrations. | In both writer orders, hosted-member serialization makes identity-only sync and the production webhook planner converge on the exact inbound thread. A completed relink also rejects the stale account before any mailbox write. |
| `DATABASE_URL="$LOCAL_POSTGRES_URL" MURPH_TEST_POSTGRES_CONCURRENCY=1 pnpm exec vitest run --config apps/web/vitest.workspace.ts --no-coverage apps/web/test/hosted-signup-referral-postgres-concurrency.test.ts` | Opt-in real-PostgreSQL proof for durable signup-referral attribution, cap ordering, reward-gate transitions, cross-path admission, public-claim authority fencing, failure rollback, and claim serialization. The suite rejects non-loopback database URLs and runs in the hosted E2E PostgreSQL job after migrations. | Concurrent recovery of one delayed legacy activation creates one receipt and grant with replay suppression; six delayed activations settle oldest-first as exactly five grants plus one cap disqualification; one client holds an earlier activation publication uncommitted while another commits the final $3.50 arm against $7 of prior rewards, then future-stamps that arm and one completed reward to simulate fast application hosts, after which concurrent recovery records one cap disqualification, no signup grant, exactly $10.50 of live commitments, no clawback or stranded arm, and replay suppression; a blocked target-control-root persistence path leaves the strongest referrer row lock available, while suspension and deletion each win the final authority fence and leave no placeholder member, identity, crypto envelope, or invite; failed control-root KMS preparation rolls back all target state and the identical stable link succeeds after recovery; a missing public signup origin returns the retryable HTML landing before any member, identity, envelope, or invite can commit, and the identical link succeeds after configuration recovery; and concurrent claims at the 49-to-50 boundary allocate exactly one member and invite. |
| `DATABASE_URL="$LOCAL_POSTGRES_URL" MURPH_TEST_POSTGRES_CONCURRENCY=1 pnpm exec vitest run --config apps/web/vitest.workspace.ts --no-coverage apps/web/test/hosted-usage-plan-reset-postgres.test.ts` | Opt-in real-PostgreSQL proof for same-period plan-reset capacity epochs, delayed usage accounting, and reset-scoped exhaustion notices. The suite rejects non-loopback database URLs and runs in the hosted E2E PostgreSQL job after migrations. | Both member-row lock orderings converge on zero Edge spend without altering purchased credit: reset-first retains the late pre-reset usage row as uncounted, while usage-first counts the old work before the later reset clears included spend. A stale pre-reset notice candidate fails the locked epoch check and the re-exhausted reset epoch receives a fresh delivery identity. |
| `DATABASE_URL="$LOCAL_POSTGRES_URL" MURPH_TEST_POSTGRES_CONCURRENCY=1 pnpm exec vitest run --config apps/web/vitest.workspace.ts --no-coverage apps/web/test/hosted-usage-plan-transition-bridge-migration-postgres.test.ts` | Opt-in real-PostgreSQL proof for the corrective rolling-deploy usage-transition trigger. The suite rejects non-loopback database URLs and uses an isolated temporary schema. | The migration clears only impossible same-plan upgrade markers, leaves nullable billing-phase writes unstamped, and preserves real paid Pulse-to-Edge transition identity. |
| `DATABASE_URL="$LOCAL_POSTGRES_URL" MURPH_TEST_POSTGRES_CONCURRENCY=1 pnpm exec vitest run --config apps/web/vitest.workspace.ts --no-coverage apps/web/test/hosted-stripe-webhook-entitlement-postgres.test.ts` | Opt-in real-PostgreSQL proof for Stripe webhook entitlement projection, usage-reset wake recovery, and Family-versus-direct Checkout serialization. The suite rejects non-loopback database URLs and runs after migrations. | A signed subscription event records and projects idempotently; direct and Family tier upgrades reset exhausted included usage, retain the exact transition marker across a failed post-commit wake, and complete the same receipt on replay. Family removal and direct-checkout cleanup converge under the owner/member lock order: removal-first preserves direct billing, while cleanup-first holds authority through exact cancellation, refund-or-zero-payment proof, and terminalization. |
| `DATABASE_URL="$LOCAL_POSTGRES_URL" MURPH_TEST_POSTGRES_CONCURRENCY=1 pnpm exec vitest run --config apps/web/vitest.workspace.ts --no-coverage apps/web/test/hosted-usage-credit-postgres-concurrency.test.ts` | Opt-in real-PostgreSQL proof for the shared usage-credit 32-slot admission contract, bounded indexed set-based settlement and bounded replay, beneficiary-first lock order, provider-final reservation release, reversal restoration admission, sponsorship cap and recovery serialization, referral transaction boundaries, installed ledger constraints, and deletion boundaries. The suite rejects non-loopback database URLs and runs in the hosted E2E PostgreSQL job after migrations. | Mixed purchase/referral FIFO settlement keeps grant, purchase, and beneficiary projections coupled; one usage call successfully consumes 32 grant fragments; a corrupt 33-grant fixture rolls back every mutation; fulfillment replaces its exact purchase reservation at the 32-slot boundary while an unreserved referral grant is rejected; exact provider-final terminal actions release only their owned reservation; and refund/dispute restoration rechecks final capacity before receipt binding. Existing proofs retain concurrent purchase-grant replay, beneficiary-before-distinct-payer and member-before-purchase lock ordering under contention, grant/debit and deletion-first serialization, group sponsorship cap-reduction versus explicit recovery, the one-connection direct-personal referral boundary, pre-expiry qualification, replay-safe celebration, validated amount/source constraints, and final-cap contention between group referrers. |
| `DATABASE_URL="$LOCAL_POSTGRES_URL" MURPH_TEST_POSTGRES_CONCURRENCY=1 pnpm exec vitest run --config apps/web/vitest.workspace.ts --no-coverage apps/web/test/hosted-usage-referral-recovery-postgres.test.ts` | Opt-in real-PostgreSQL proof for the bounded usage-referral recovery lane-head selector. The suite rejects non-loopback database URLs and runs after migrations. | A live generic system predecessor is selected once for a lane containing a later referral notification, a retention-old prefix is skipped so the live referral becomes the selected head, and a dominant raw consumed cursor selects the next live row. |
| `DATABASE_URL="$LOCAL_POSTGRES_URL" MURPH_TEST_POSTGRES_CONCURRENCY=1 pnpm exec vitest run --config apps/web/vitest.workspace.ts --no-coverage apps/web/test/hosted-assistant-ask-retention-postgres.test.ts` | Opt-in real-PostgreSQL proof for the reviewed Assistant Ask mailbox-retention boundary. The suite rejects non-loopback database URLs and runs in the hosted E2E PostgreSQL job after migrations. | Production retention SQL physically deletes the expired request and completion rows while the outbox-carried completion id, delivery key, and expiry still authorize only the fixed terminal copy |
| `DATABASE_URL="$LOCAL_POSTGRES_URL" MURPH_TEST_POSTGRES_CONCURRENCY=1 pnpm exec vitest run --config apps/web/vitest.workspace.ts --no-coverage apps/web/test/hosted-production-500-regressions-postgres.test.ts` | Opt-in real-PostgreSQL proof for the reviewed hosted retention and late-runtime-log production 500 repairs. The suite rejects non-loopback database URLs and runs in the hosted E2E PostgreSQL job after migrations. | Retention deletes an expired, already-consumed sequence-less preference row without updating it under the current `NOT VALID` constraint while retiring current rows in place; a diagnostic batch arriving after member deletion returns a truthful zero persisted count only for the exact runtime-log member foreign key |

For PR-bound work, run focused local proof and let required GitHub Actions own
the broad suite on the exact head. `pnpm test:diff` remains an optional local
helper, while `pnpm verify:acceptance` is mandatory before a direct push to
`main` or another shared default branch. If CI fails, reproduce the narrowest
failing owner or scenario locally before expanding to an umbrella command.
The required host-support release gate keeps parity with local acceptance by
assigning every package coverage owner, including Exercise Library and Health
Metrics, and by running the prepared Messaging Ingress, Inboxd, and Hosted
Local Harness package-boundary checks. The workflow guard locks those owners
and commands against drift.

When either canonical root command is selected, `pnpm test:diff` and
`pnpm verify:acceptance` stay local by default. An explicitly forced remote run
executes the same coverage
surface through Crabbox's static SSH provider on a dedicated macOS account or
through the direct Blacksmith Testbox provider; the command semantics in this
map remain authoritative and only the finite executor changes. Ordinary GitHub
Actions and already-remote invocations stay on their existing runner-local
path. Static SSH routing requires validated command-local host, user, and port
inputs; dispatcher coverage proves they become Crabbox CLI flags but do not
enter its sanitized environment. Focused transport coverage proves static
readiness fails before candidate inspection or installation when `tar`/`zstd` is
absent or incompatible, then proves the remote rebuilds the exact detached base
and staged candidate after Crabbox excludes `.git`. Workspace-verifier contract
coverage proves the `static-ssh` resource plan, caller-override refusal, and
package-before-app/fixture ordering, while macOS wrapper coverage proves
nested runs share one `lockf` and retain exact cleanup and exit status. See
`agent-docs/operations/verification-and-runtime.md`.

Ordinary package, app, and repo-tool Vitest configs share one marked
process-owned temp root. Teardown removes the whole root after success or
failure; a later run recovers only old marked roots whose owner is gone and
which no current-user process uses as its working directory.

Hosted assistant-provider choice coverage is split across existing owners.
Hosted-execution locks the closed OpenAI/Venice contract and additive workspace
field; operator-config and assistant-runtime prove Venice Codex configuration
without forwarding raw Worker credentials. Hosted Web tests cover the nullable
preference, rollout flag, Settings route/component, workspace projection, and
expand-only migration. Cloudflare tests cover signed credential minting,
all-or-none deploy preflight, exact Responses path/method allowlisting, bounded
body parsing, the exact Codex-native managed OpenAI standalone-search
method/path plus wrong-method rejection and header stripping, canonical
product-model validation, fixed model rewriting, and real-key injection only
at Worker egress. Routine tests use synthetic keys and do not call OpenAI or
Venice.

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
the required frontend and coverage specialist audits, the review-only Fable or
Opus UI pass, and ReviewGPT. Routine tests stub Junction; they do not call the live
catalog or expose a production credential.

Post-onboarding choice-point coverage is owned by assistant-engine tests. The
seed suite proves answered-onboarding eligibility, 21-day local scheduling,
seven-day expiry, stable installed occurrences, future same-weekday catch-up
for older members, quiet-wake route reuse from an existing immutable
member-owned managed automation, member ownership, and idempotent
reconciliation. Managed maintenance tests prove that malformed onboarding
state isolates this optional seed without blocking unrelated automations.

Cron and outbox suites prove that the registered dynamic identity rejects
non-direct routes, uses the ordinary scheduled-notification turn rather than a
feature-specific assistant profile, and revalidates canonical onboarding state
at claim and queued provider entry. Planning, runner, and hosted Codex-config
tests prove that the exact identity installs an immutable read-only policy,
retains current-conversation and vault-read continuity, removes hosted dynamic
mutation tools, denies external network access, and cannot inherit ordinary
save/ingestion guidance. Web, transport, runtime, and cron coverage also prove
that a live direct Linq fallback carries its privacy-blinded current
conversation locator separately from the raw provider delivery target, while a
changed target without that locator fails retryably before model work and
preserves the occurrence. Prompt assertions keep unclear or unshared goals,
evidence-grounded reflection, quiet skip, one easy question, and
no-mutation-before-reply behavior explicit without adding a second evidence or
session pipeline.

Hosted usage-credit coverage is split across focused hosted-web unit
and component tests. The allowance suites exercise enforced exhaustion,
included-first settlement, carryover balance, and crossing-operation behavior;
credit-ledger suites exercise beneficiary-lock call ordering, unique
grants/debits, and projection updates; route and purchase-service suites
exercise app-session/CSRF binding, fixed offers, eligibility, and Checkout
request idempotency. Group purchase-service coverage additionally proves
canonical saved-card selection, durable PaymentIntent binding before
confirmation, exact-intent recovery after an ambiguous confirmation, verified
cancellation before Checkout fallback, account-deletion-before-bind
cancellation, sessionless payer-owned cancel resolution, and group-only card
saving. Family
coverage additionally proves owner/group/member
authorization, use of the Family billing Customer, distinct owner-self target
identity, exact frozen replay after membership changes, per-member Settings
routing, all ordered cross-target conflict directions, and server-withheld
former-member payment capability. Purchase-service tests also remove Family
authority during deferred Stripe creation, exact-key replay, and ambiguous
provider retry recovery to prove that URL and retry capability remain withheld;
page and dialog suites prove payer-wide
offer suppression and status/cancel-only cross-target recovery. Reconciliation
suites exercise live Stripe re-fetch, Checkout-free direct PaymentIntent
success and processing, late terminal direct events after safe fallback,
retryable unbound success events, one-time/subscription dispatch separation,
replay-safe grants, and refund/dispute signed adjustments in both directions
after direct payer detachment; component suites
exercise the Settings dialog selection, redirect, return polling, and error
states. A guarded
real-PostgreSQL suite proves grant replay, beneficiary-first lock ordering,
grant/debit serialization, purchase/referral FIFO over entry-keyed projections,
purchase-only reversal, and deletion-first cleanup. Referral
coverage additionally proves exact threshold boundaries, provider-event
dedupe, next-new-container binding, trusted runtime sender injection,
unlinked-Telegram evidence isolation, dynamic-tool/parser contracts, source
celebration replay, and deletion-time anonymization without group-credit
clawback. Provider-normalization fixtures contain no Linq SDK or Telegram
payload types in the shared policy assertions. That group-credit surface keeps
Stripe mocked; it does not replace the separate hosted-local live billing lane
or a deployed browser smoke for its own product path.

Account-deletion cleanup coverage is split at the ownership boundary.
`hosted-account-data-service.test.ts` proves the encrypted receipt is prepared
before suspension and inserted in the canonical transaction before member
removal. `hosted-account-deletion-cleanup.test.ts` proves receipt-bound
encryption, independent per-target progress, unconfigured-target pending
state, lease-loss handling, retry convergence, and batch isolation. Cloudflare
runner tests prove already-absent state is idempotent and full Durable Object
storage is erased only after R2/container cleanup. The shared control-client
suite rejects legacy responses without explicit `deleteAllCompleted` evidence,
and cleanup tests prove never-resolving provider targets return pending at the
attempt deadline. Participant-lease unit,
entitlement, allowance, group-email, and routed-Linq suites prove one seven-day
predicate and that current inbound can advance only an existing nonremoved
relationship.

Linq edit coverage is split across the same owners used in production. Shared
ingress tests lock the `2026-02-03` payload contract and text-omitting
minimization. Hosted Web planner and mailbox tests cover private source
correlation, direct/group authority, replay, ordering, part bounds, the
five-edit cap, missing-original retry, and side-effect isolation. Hosted
execution, assistant-runtime, and assistant-engine tests prove the trusted edit
marker stays separate from user text, survives mailbox import, joins an
eligible live turn, and renders explicit correction semantics in both prepared
and captureless prompts. The local Linq tunnel test locks the versioned edit
subscription without treating local provider traffic as a routine CI
dependency.

Linq participant-change coverage follows the same provider-to-prompt boundary.
Shared ingress tests lock the full participant object plus deprecated handle
fallback. Hosted Web parser tests prove provider-ledger minimization still
retains no participant identifier; webhook tests prove only unique routed adds
and removals attempt detailed staging, additions retain their anonymous fallback
bit, and neither event appends mailbox work, wakes, or sends. Focused context
tests prove active-route gating, canonical handle normalization, activated
member label suppression, optional owner-address-book overlay, handle-only
fallback, chat-locked atomic staging, encrypted route storage, own-line
rejection, account-bound consumption, address-book replacement/deletion buffer
clearing, and bounded weak group-event prompt rendering. The existing signed
hosted-local group-isolation scenario carries a unique addition through Web,
the encrypted route sidecar, mailbox import, and the next real assistant
provider request, where both the anonymous fallback and exact handle context
must be present.

Pending Linq-group ownership coverage is split at its actual owners.
Hosted-execution parser tests lock the closed prepare/read/cancel setup and
activation wire contracts; assistant-engine tests lock the private fresh-text
gate, skill guidance, and exact-replay room-model initialization; Hosted Web
group-tool tests lock current-line preparation, encrypted payload validation,
and status handling. Selection and prepared-route tests prove lone-candidate
ownership, sender-only conflict resolution, canonical route composition,
new-route-only style and room-context application, referral binding, and
existing-route restoration. Assistant-runtime tests prove activation applies
only a categorical, secret-safe result and fails open. Linq webhook tests prove
the bounded provider roster read happens before the transaction and only
resolved member ids cross that boundary, while provider failure retries before
route creation and a completed oversized roster preserves sender-owner
admission. Transport tests prove group-line recovery persists its accepted
milestone before returning provider success, retries that write with the stable
provider idempotency key, and does not misclassify a provider-successful send as
failed. They also prove an uncorrelated recovery provider error does not invoke
local failure settlement. Delivery-store tests prove the exact pinned replay
bypasses the generic lease, rejects changed source or target identity, and
preserves its original authority timestamp. The opt-in PostgreSQL concurrency
proof verifies one encrypted setup can be claimed at most once, exact restore
preserves its payload, stale restore cannot overwrite a replacement, corrupt
payload does not block admission, and member deletion cascades pending state.
The same real-database proof composes a provider-correlated line-recovery
delivery with a different roster member's first message: the exact prepared
owner is selected, an accepted-milestone failure leaves the exact attempt
route-free, one immediate concurrent replay wins on the same delivery row
without changing its pre-event authority timestamp, advances the row version
while leaving the uncorrelated delivery in flight, rejects foreign rosters and
threads, and preserves the encrypted style/context payload as one-use even with
less than the generic lease left before setup expiry. Prepared-route coverage
also keeps a recovery-pinned message
route-free when its exact claim races or disappears, instead of committing the
first speaker as a fallback owner.

Scheduled Telegram group route-authority coverage is owner-split. Hosted Web
tests bind the signed callback member to the exact current thread-container
route and reject a foreign container. Cloudflare tests lock the new signed
effect path, write fence, and outbound allowlist. Assistant-engine tests prove
the exact route is resolved before group tools/model work and persisted through
the ordinary outbox; assistant-runtime tests prove provider-entry ordering and
revocation blocking, while the shared gate covers Telegram text, image,
reaction, and voice provider paths. The hosted-local Telegram
scheduled-reminder scenario adds the production-path proof: an ordinary group
newsletter automation invokes `read_shared`, wakes from its alarm, and sends only to the
exact admitted group thread.

Private assistant-image coverage is also owner-split. Shared contract tests
accept only bounded `vault_image` descriptors; assistant-engine tests prove
canonical generated-image captures plus path, hash, byte-count, filename, MIME,
and image-signature verification. They also prove that a trusted completion
persists provenance only for its exact attached generated capture, restores
that bounded marker when route support or a contract fingerprint rejects native
resume, binds an explicit native reply to the matching first of two delivered
captures, and keeps that provenance separate from later group-mutation
authority. Assistant-runtime tests prove verification finishes before provider
dispatch; Linq and Telegram adapter tests prove attachment-id and rebuilt
multipart delivery. Cloudflare Worker tests lock the legacy upload route to
`410 Gone`. The hosted-local Codex image-media scenario generates through the
real app-server tool relay, persists the vault capture, delivers a Linq
attachment id, and reuses the same capture on retry without a public image URL.
The opt-in live-provider Assistant Engine scenario covers the natural
generation acknowledgement, trusted completion attachment without mutation,
and later explicit exact-ref group-avatar update while the eager feedback tool
is also available. Routine CI compiles that scenario but skips it without the
explicit live-provider gate and supported credential.

Managed group automation coverage is likewise owner-split. Assistant-engine
reconciliation tests prove default member ownership, explicit group ownership,
custom unscoped compatibility, and paused wrong-owner archival. Claimed-cron
tests prove static built-in owner checks run before experiment lifecycle hooks,
activity evidence, provider/model work, and outbox creation; live route changes
are rejected again at provider, tool, delivery, and commit boundaries.
Hosted-execution tests lock the closed activity policy, status-only response,
and 167/169-hour DST windows. Hosted Web tests prove exact 99/100 canonical
mailbox semantics, occurrence and commit boundaries, Linq assistant/reaction
exclusions, Telegram inclusion, exact runtime/route binding, bounded scanning,
and malformed fail-closed behavior without logging private evidence.
Cloudflare tests lock the signed status-only port and exact POST allowlist.
Maintenance-evidence tests prove recap composition is projected from exact-
route structured input events, occurrence-anchored, bounded, and sender-redacted
before the ordinary group outbox path. Delimiter-bearing human text stays one
quoted message; rendered transcript structure is ignored; attachment
descriptors, extracted text, filenames, stored paths, and lifecycle metadata do
not enter evidence; and attachment-only input fails closed before provider work.

Hosted product-feedback digest coverage is Web-owned and provider-free.
`hosted-product-feedback-digest.test.ts` proves the Eastern 6pm-to-6pm window
across both DST transitions, dedicated recipients, fixed empty digest,
day-keyed Resend idempotency, the bounded allowlisted-kind summary read that
selects only the kind and summary columns with deterministic ordering,
truthful grouped per-kind totals with explicit omitted-remainder lines past
the row cap, observable missing configuration, and
same-hour
retry through the real production sender against an isolated loopback provider
fake. `hosted-product-feedback-digest-cron.test.ts` proves Vercel cron auth
happens before the service runs. The operational-email config suite proves the
shared sender/transport can use a feature-specific recipient allowlist, while
the privacy-foundation migration inventory and production migration guard keep
the new index and approved ten-minute cron registration aligned. Routine CI
never reads production feedback or enters Resend.

Immediate support-escalation alert coverage is also Web-owned and provider-free.
`hosted-product-support-escalation.test.ts` proves private-member authority, the
fixed linked marker plus anonymous detail ownership, shared recognizable-value
scrubbing, read-back row validation, a labeled issue summary in the bounded
plain-text alert, the three-per-member UTC-day cap, exact stable-body/key replay,
first-stored-detail canonicalization across callback rewording, linked or
malformed-detail rejection before provider entry, and synthetic-room denial.
The route suite proves callback-bound member attribution;
routine tests inject the sender and use a mocked email effect rather than Resend.
Hosted support-escalation conversation coverage is Assistant Engine-owned.
`codex-base-support-guidance.test.ts` pins opt-in contact details, explicit
private-direct authority, immediate reserved submission without a separate
approval turn, and truthful saved/failure copy. The opt-in support scenario in
`assistant-codex-real-e2e.test.ts` defines the real one-turn App Server journey:
an explicit private human-support request submits one Murph-written,
de-identified product-only summary while excluding synthetic semantic private
context and raw wording; the group case remains tool-free.
Routine CI compiles the live-provider scenario but skips it without an explicit
supported provider credential.

## Current CI Workflows

- Linux CI `apps/web verify` invocations default to wrapping the hosted-web production
  `next build` step with `apps/web/scripts/build-memory-guard.sh`. The guard
  creates a root-level cgroup-v2 child for accounting only and moves the build
  process into that cgroup while keeping the build itself on the invoking user,
  environment, cwd, and stdio. It does not currently write `memory.max`,
  `memory.swap.max`, or `memory.oom.group`. The Vercel package build gives the
  parent Next process a direct 1 GiB old-space flag and appends a 3 GiB flag to
  `NODE_OPTIONS`. Node applies the direct flag to the parent; Next 16.3.0
  rebuilds its non-isolated TypeScript worker options from the parent arguments
  followed by `NODE_OPTIONS`, while removing the flag from isolated static
  workers. The same script owns the Vercel package build and CI memory-
  observation invocation. The split reduces the compile-parent peak without
  weakening generated-contract validation, while repeated forced-cold Standard
  previews remain the real Vercel acceptance proof. A 2 GiB parent-bound
  candidate passed one forced-cold Standard preview but the next identical
  build still hit the 8 GB container OOM boundary. Single global 1 GiB and 1.5
  GiB limits starved Next's
  generated-contract TypeScript worker, as did a 1 GiB parent / 2 GiB worker
  split. The 1 GiB / 3 GiB split completed the full local build. Either a V8
  heap failure or a container OOM rejects the candidate. The first forced-cold
  Standard preview with that split still exhausted the container during
  Turbopack compilation. Profiling identified the multiplier: `/design` made
  the whole catalog a client graph solely to manage its `tab` query parameter.
  The route now parses that query on the server and uses URL-backed tab links,
  while reachable client modules use narrow client-safe public imports and only
  the three callback-bearing synthetic studies declare local client boundaries.
  With the same heap policy, a cold local Turbopack build compiled in 57
  seconds instead of roughly 4.4 minutes and completed all 229 static pages.
  Repeated exact-head Standard previews remain the external acceptance proof.
  The next exact-head Standard preview still OOM-killed Turbopack, so the
  catalog correction is retained as a boundary fix but was not sufficient
  capacity proof on Next 16.2.6. Production and Linux CI now use Next 16.3's
  default Turbopack path through the same shared production-build selector. The
  Workflow integration runs through its native Next integration: exact-head CI
  proves the complete compile, type-validation, static-generation, and
  directive-discovery path, while focused Stripe and phone-call suites prove
  the existing `workflow/api.start` wrappers and step contracts. Two
  forced-cold exact-head Standard previews completed without OOM: compilation
  took 91 and 87 seconds, TypeScript validation took 54 and 55 seconds, all 233
  pages took 10.0 and 10.8 seconds, and each Vercel build stage completed in
  four minutes. These repeated previews remain the external memory acceptance
  proof. The accepted candidate preserves the heap split and all route/type
  validation. The advisory budget is
  a cgroup-unit model of Vercel Standard's 8 GB build machine: 7.2 GB available
  to the build cgroup and a 0.8 GB reserve for OS/container overhead outside it
  at the ceiling. The legacy-named guard budget override must stay strictly
  above the 6,000,000,000-byte known-false-positive cgroup floor and at or below
  7,200,000,000 bytes, preserving at least a 0.8 GB reserve under the 8 GB
  machine model. The floor comes from the fully working 2026-07-06 Linux CI run
  where a 6.0 GB cgroup cap OOM-killed a build that Vercel's real 8 GB Standard
  machine accepts. PR #349's 5.34 GB passing and 6.18 GB exit-137 failure
  numbers are historical single-process RSS measurements only, not cgroup cap
  bounds; cgroup accounting includes anonymous memory across all build workers
  plus page cache. Live CI on 2026-07-07 showed the hard limit cannot ship green
  yet: `turbopackMemoryLimit=3GiB` matched the 4 GiB-configured cold-build anon
  ramp, rising about 2.9 GB at 12 seconds, 5.5 GB at 27 seconds, and 6.9 GB at 42
  seconds before an OOM-group kill. Next 16.2.6 discards that option while
  creating the native backend, so it changed no enforced target and is now
  omitted. The guard samples cgroup `memory.current`
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
- `.github/workflows/frontend-design-proof.yml` checks every pull request for the required architecture-and-reuse summary. It also requires the `/design` catalog update and hosted desktop/mobile screenshot links whenever the base-to-head diff changes user-facing hosted-web UI.
- `.github/workflows/web-viewport-overflow.yml` runs the `pnpm --dir apps/web test:viewport-overflow` Playwright gate on GitHub-hosted `ubuntu-24.04` for every pull request and `main` push. It installs only Chromium (`playwright install --with-deps chromium`); Playwright's `webServer` boots the hosted-web dev server with the placeholder smoke env, so the job needs no Postgres service or real secrets. On failure it uploads the Playwright HTML report as an artifact.
- `.github/workflows/host-support.yml` runs a host-support matrix on GitHub-hosted `ubuntu-24.04` and `macos-latest`, installing with `pnpm install --frozen-lockfile`, building the workspace, preparing `pnpm build:test-runtime:prepared`, and then exercising the focused built-runtime CLI host-support suite (`packages/cli/test/setup-cli.test.ts` and `packages/cli/test/inbox-service-boundaries.test.ts`) with `MURPH_PREPARED_CLI_RUNTIME_ARTIFACTS=1` on both hosts. The macOS host leg serializes package-script workspace builds so sibling `tsc -b --force` package scripts do not rewrite shared project-reference declarations at once while the Linux leg keeps the normal package-build fanout. The workflow also carries deterministic CI-only hosted-web build placeholders for `DATABASE_URL`, hosted device routing, contact privacy, hosted mailbox fingerprinting, and the public Privy app id so its Linux release shards can finish `apps/web verify` without inheriting production secrets.
- The same workflow also preserves the Ubuntu `pnpm release:check` surface without running it as one long job: release metadata/build/typecheck, package coverage shards, app verification, and fixture coverage run as parallel jobs, then a final `Release checks (ubuntu)` aggregator preserves the required-check name. The app-verification shard provisions an isolated loopback PostgreSQL 17 service and sets the dedicated supplement-search test database variable, so its rollback-only 100+ query PostgreSQL corpus runs on pull requests and `main` while the ordinary hosted-web build database remains the unreachable CI placeholder. This keeps Linux bootstrap and release packaging exercised in CI while avoiding the serial package-coverage wall clock.
- The private `cobuildwithus/murph-cloud` repository owns the Temporal worker's
  cross-repository hosted-local integration matrix, package verification, and
  protected post-CI Render deploy. Public Murph intentionally contains neither
  the worker implementation, Render Blueprint, deploy hook, nor Workflow
  bundle; public CI proves the contracts and external-worker harness only.
- The private hosted-orchestrator-temporal package build is a
  production-bundle memory gate: it rejects a Workflow bundle above
  2.25 MiB, missing inline source-map dependency evidence, or containing the
  broad contracts/vault-share source closures. Package tests separately lock
  the failure modes and the explicit 100-Workflow reusable-V8 cache policy.
- `.github/workflows/cloudflare-runner-base-image.yml` runs only on protected `main` pushes or manual dispatches from protected `main` and publishes stable and source-fingerprinted GHCR native runner base image tags through `pnpm --dir apps/cloudflare runner:docker:base -- --push`. The workflow grants `packages: write` and deliberately has no pull-request trigger.
- Private `cobuildwithus/murph-cloud`'s `Public Murph Integration` workflow runs focused hosted-local E2E jobs on Blacksmith for every private pull request and `main` push, and manual dispatch targets an exact public ref. A shared preparation job builds the hosted-local runner bundle, workspace `dist` outputs, and production hosted-web dist once per run with `MURPH_RUNNER_BUNDLE_BUILD_CONCURRENCY=4`; scenario-group jobs download those artifacts and use `--no-bundle`. Each group passes one or more named scenarios to a single `pnpm hosted-local e2e` suite invocation. The suite runs scenarios serially, keeps dedicated/test-control scenarios isolated, reuses generated artifacts plus the current-build runner image and smoke proof where isolation allows, and owns final image cleanup. This avoids rebuilding the same image and rerunning the same smoke proof between compatible scenarios. Before that expensive assembly boundary, `packages/device-syncd/test/package-boundary.test.ts` walks the runner runtime-config static source graph and fails if provider runtime modules, importer modules, or the Junction SDK enter the boot closure; bundle assembly keeps the final esbuild-metafile guard as the authoritative packed-artifact check. The routine Linq reminder/onboarding leg uses the explicit fast-gate profile on pull requests and `main` for the scheduled reminder's 90-second setup lead and 1ms idle checkpoint. The onboarding scenario uses the shared hosted-local harness checkpoint default to prove signup welcome seeding, foreground completion, and deterministic managed archival, while the sibling Linq reminder scenario retains the timed alarm-to-provider-to-Linq send proof. The protected deployment gate does not set the reminder fast profile; its full profile preserves the production-like 10-second idle checkpoint and uses the same 90-second setup lead so checkpoint/wake preservation work still leaves more than the enforced 5-second Temporal scheduling runway. Eleven matrix legs preserve the established provider, messaging, checkpoint, webhook, device-connect, and Temporal scenarios while adding deterministic same-wake Linq batching, canonical-receipt recovery, snapshot-publication fallback, shutdown checkpoint ordering, retryable-outbox restart, usage-limit ambiguity, Linq group/home-line authority, Family sponsorship, unknown first-contact fallback, vault approval resume, Retell call results, computer handoff roundtrips, and the foreground reply priority gate. The Junction wearable direct-resource replay is a 35-minute leg in this shared-artifact workflow instead of rebuilding the runner bundle in a standalone workflow; its proof also covers signed-webhook retry semantics, historical-backfill evidence, and device-activity experiment adherence with a single non-nagging Linq nudge. The shared bundle includes the E2E parser toolchain; `linq-webhook-audio` proves the Worker-mediated Workers AI transcription path through the container parser drain, remote-transcription provider, and `murph-transcribe.worker` egress handler with the deterministic fake `AI` binding. Every leg provisions loopback `postgres:17` from `public.ecr.aws/docker/library/postgres:17` with an explicit `pg_isready` probe, installs the pinned Codex and Temporal CLIs, uses deterministic CI-only hosted-web placeholders, avoids GHCR authentication before PR-controlled code, uses anonymous public runner-base pulls, and always uploads its focused log plus redacted hosted-local `state.json` files. The always-run `Temporal orchestration E2E` job depends on the shared bundle and complete scenario matrix, including the Junction replay leg, and fails when either prerequisite fails, is canceled, or does not complete. It is the private repository's stable cross-repository integration gate; public branch protection keeps only public-repository check names, and a public cleanup ref is manually dispatched through this workflow before merge. The local aggregate `pnpm --dir apps/cloudflare test:e2e:local` also runs the Workers-runtime lane through `test:e2e:workers:local`; CI keeps that narrower Workers proof inside `apps/cloudflare verify` / `test:workers` rather than duplicating it in every hosted-local leg.
- `.github/workflows/cloudflare-runner-permission-sandbox.yml` runs the production `linux/amd64` runner image smoke on native GitHub-hosted `ubuntu-24.04` when the pinned Codex package, permission executor/config, runner image, bundle, or smoke proof changes. It builds the production runner closure, prepares the anonymously readable pinned base image, disables Ubuntu's host-only restriction on capability-bearing unprivileged user namespaces for this disposable job, and runs `runner:docker:smoke:prepared-base` without provider credentials. The smoke transport also disables Docker's outer default seccomp and AppArmor profiles while retaining `--network none`, so the pinned bubblewrap binary can create and police its nested mount namespace; those outer test-harness settings do not change the production image or inner permission profile. The gate proves the named profile attestation plus authorized reads and denied writes, runtime/secrets/sibling/outside-root reads, loopback networking, and secret-environment inheritance. The native lane is required because ARM64 Docker Desktop's AMD64 emulation cannot install the inner Codex seccomp filter and must remain a fail-closed local gap rather than weakening the profile.
- The hosted-local active-turn latency scenario proves same-chat late-input folding, forces a 20-second provider-cleanup stall and requires the second reply to preempt it, and checks that a projected wake does not trigger immediate full idle-shutdown work under the 180-second floor.
- The dedicated `foreground-reply-priority` hosted-local scenario keeps the
  production 180-second idle floor, seeds every registered system wake kind,
  and separately stages system-mailbox, retention-only, stale-owner, and active
  foreground contention. Each real signed Linq inbound must produce exactly one
  accepted outbound Linq request within 30 seconds while any staged background
  checkpoint remains held. The same scenario command then starts a clean Vitest
  process with a 10-second idle floor and typed, bounded ordering observation.
  That process proves a later durable conversation reaches mailbox import and
  provider start before an interrupted idle snapshot can retry, and proves the
  same foreground continuation after a committed canonical publication. The
  two process profiles cannot share process-scoped hosted crypto state. Its
  separately named workflow leg makes these invariants visible without
  replacing the two aggregate required checks.
- `apps/web/test/hosted-runtime-latency-alert-{monitor,cron}.test.ts` locks the
  same exact 30-second boundary for completed and still-unresolved Linq traces,
  excludes chronologically valid AI usage-denied traces before grouping while
  keeping mixed unblocked rows and impossible denial chronology alertable, and
  applies the bounded-read truncation signal only to that alertable population,
  derives the effective latency origin before its 24-hour window and bounded
  cap, restarts at post-denial execution evidence even for older ingress, and
  retains the original ingress origin when execution predates denial,
  excludes explicit committed terminal non-replies during bounded checkpoint
  grace, reopens them when durable consumption does not arrive, keeps normal
  checkpointed suppression healthy and impossible marker chronology alertable,
  excludes consumed traces with best-effort missing delivery links, and proves
  cron auth, incident claim coalescing, operator-time quiet hours, stable
  wake-up jitter, the ten-minute-plus-jitter retry/recurrence floor,
  provider-idempotent retry, naturally distinct later-incident copy, PII-free
  evidence, fail-safe scan truncation, pre-provider recovery cancellation,
  zero-attempt quiet-hour deferral with fresh first-alert wake evidence, exact
  ambiguous retry identity across quiet hours, and post-provider recovery
  coalescing until the admitted effect settles. Row-version race cases prove
  stale healthy candidates cannot report recovery or bypass pacing after a
  concurrent incident cycles the singleton back to healthy.
  `packages/assistant-engine/test/assistant-{automation,outbox}-runtime.test.ts`
  proves suppression is projected only after terminal evidence succeeds, is
  re-derived from completed evidence on replay, and a rebatched still-active
  grouped reply retains every answered mailbox item for the existing
  accepted-delivery linkage. It also proves provider dispatch freezes the
  answered-item set, sending or sent replay returns a retryable uncovered result
  for a later item, and automation writes no terminal evidence or cursor progress
  for that item. The latency-store test keeps ordinary milestones attempt-scoped
  while allowing only that terminal evidence projection to converge by assistant
  input.
  `packages/assistant-runtime/test/hosted-runtime-maintenance.test.ts` proves
  that projection uses the existing nonblocking assistant-milestone port.
  `packages/assistant-engine/test/reminder-availability-maintenance.test.ts`
  proves reminder availability has no model-facing maintenance tool, builds
  fixed bounded Google Calendar and Outlook requests from the exact stored
  account, excludes raw provider content, rejects incomplete pagination and
  concurrent edits, persists empty freshness leases, filters ineligible
  automations including exact-time reminders, rearms refreshes at 23 hours, and
  keeps a later weekly conflict inside the 24-hour delivery lease. The
  notification suite proves deterministic pre-provider skip
  behavior, exact-time fail-open delivery, and removal of canonical or malformed
  snapshot evidence before provider admission.
  `packages/assistant-runtime/test/hosted-runtime-workspace-assistant-phase.test.ts`
  proves the existing hosted background pass performs the real deterministic
  provider read and canonical write before checkpoint, returns the next refresh
  deadline for the existing durable wake owner, aborts an in-flight read on
  foreground preemption without logging a provider failure, preserves runtime
  shutdown cancellation as the fallback, and proves a
  schedule-only scoped patch to exact time atomically converts availability to
  fixed delivery without retaining its source, account, or snapshot.
  `packages/hosted-execution/test/assistant-permissions.test.ts` and
  `packages/assistant-runtime/test/hosted-runtime-codex-config.test.ts` prove
  one-shot memory maintenance writes only canonical memory infrastructure and
  disables network access; reminder availability needs no Codex permission
  profile.
  `packages/core/test/automation-availability.test.ts` proves exact
  policy/source/account authorization, canonical populated and empty snapshot
  parsing/removal, host-only prompt sanitation, exact-time normalization, and
  fail-open delivery after revocation or 24-hour evidence staleness.
  `packages/core/test/markdown-documents.test.ts` proves stale observed
  automation updates cannot overwrite a newer definition.
  The latency-store proof also shows that terminal evidence carries an initial
  publication expectation and later dirty-window resets advance that expectation
  monotonically across the fenced runtime attempt. A strictly newer authenticated
  lease generation takes over an unresolved trace's refresh ownership whether
  its deadline or terminal callback arrives first. Equal-generation callbacks
  merge only for that owner, while delayed prior-generation evidence and
  milestone replay cannot reclaim the trace or roll either timestamp back. The
  current attempt may also persist a reset deadline before its first terminal
  projection; a different attempt cannot adopt that nonterminal trace.
  `apps/web/vercel.json` registers that read-only monitor at a five-minute
  cadence. The hosted-local foreground-priority leg additionally uses real
  PostgreSQL, authenticated cron HTTP, and an isolated Resend stub to prove one
  accepted operator email through a paced lost-ack retry, active-incident
  coalescing, silent healthy reset, a paced new alert for recurrence, and no
  Linq/iMessage fallback. The stub also proves same-key/same-body
  deduplication, changed-payload conflict, and missing-authorization rejection.
  Its `MURPH_HOSTED_LOCAL_RESEND_API_BASE_URL` override is accepted only as a
  plain-HTTP loopback origin while hosted-local E2E isolation is explicitly
  active; production deployments must leave both test-only settings unset.
- `apps/web/test/hosted-runtime-progress-alert-monitor-postgres.test.ts` is an
  opt-in local-PostgreSQL proof for the companion 15-minute durable mailbox
  progress detector. It exercises the real paginated SQL together with exact
  personal and thread-container AI authority, including current-participant
  access and inactive, stale, removed, suspended, or consent-revoked
  exclusions. It also proves usage-denial suppression and restart chronology
  across staging, provider, delivery, and mailbox-consumption evidence, plus
  the 20,000 eligible-row cap after exclusions. The hosted-local
  foreground-priority leg drives this monitor through authenticated cron HTTP
  and the same isolated Resend stub, proving paced lost-ack retry,
  identifier-free aggregation, active-incident coalescing, recovery/rearm, and
  independence from the latency monitor.
- `apps/web/test/hosted-mailbox-usage-denial-postgres.test.ts` is an opt-in
  local-PostgreSQL proof that the usage-denial write marks only the observed
  conversation sequence window with database-owned chronology and leaves a
  post-snapshot append available for a later denial. The same proof keeps the
  trace suppressed while blocked, then proves older-than-24-hour resumed
  staging, the five-minute monitor cadence edge, timely progress, a slow
  completed reply, pre-denial execution, and the 20,000-row cap against the real
  bounded monitor query. It also proves that recent resumed activity survives
  seven-day trace cleanup through quiet-hour deferral and alerts after quiet
  hours, while a fully stale trace is deleted.
- `apps/cloudflare/test/database-health-{metrics,monitor,worker}.test.ts`
  covers the independent PlanetScale/Linq database-health plane. The tests
  prove strict per-family metric normalization, explicit unknowns for missing
  required series, continued evaluation of available signals, positive
  direct-port counter deltas with reset/new-series suppression across complete
  and partial samples, SQLite sample persistence and 30-day pruning, concrete
  connection thresholds, two-failure collection hysteresis, one acknowledged
  page per unresolved telemetry-notification window, recovered threshold
  coalescing before acknowledgment, truthful partial-then-unavailable,
  unavailable-then-partial, and different-family partial-window summaries with
  bounded observed evidence, failed-scrape incident preservation,
  telemetry obligation retention behind older pending and direct-error-only
  pages across restart and recovery, current-pressure priority at the first
  eligible provider slot with historical observation time, exact combined
  pressure, telemetry, and direct-error retention when concrete evidence appears
  at or after the unadmitted threshold across recovery and restart,
  rollback-compatible additive SQLite alert-state migration and legacy-ack
  normalization, recovery reset and rearming, post-ack monitoring suppression
  inside concrete-pressure
  recurrence, stale pressure retry isolation from a later rearmed obligation,
  global one-hour wall-time provider-attempt pacing across incident recovery,
  current actual-check-time and full reachability of the one-hundred-opening
  deterministic observation-scoped recurrence bank, neutral-opening coverage
  across condition families, and delayed post-recovery delivery through the
  scheduled Worker and real SQLite Durable Object boundary,
  no stale fenced gauge page after recovery, exact body/idempotency reuse after
  an ambiguous Linq send, transactional rollback before direct
  counter-baseline advancement, one-sample direct errors admitted inside the
  attempt fence and retained across clean samples, mixed inside-fence pages
  limited to direct-error evidence, full current mixed evidence when no older
  pending obligation owns the open boundary, and later direct-error evidence
  retained behind an older health-suppressed page across baseline advancement,
  recovery, provider pacing, and monitor restarts,
  documented formatted/deprecated Linq inventory shapes with duplicate and
  mismatch rejection, zero message POSTs for unhealthy or indeterminate
  chat/line health, healthy auto-selected Linq delivery, discovery-only
  PlanetScale service authorization plus bounded signed scrape parameters,
  unsafe discovered-target rejection, and singleton cron dispatch.
  The deploy-automation test keeps the five-minute trigger, v4 SQLite class
  migration, Durable Object binding, required vars/secrets, checked-in scaffold,
  and generated Wrangler config aligned.
- After hosted scenarios initialize the schema, the Linq route-authority matrix leg runs the focused real-PostgreSQL proofs for deterministic hosted usage replay, both participant-addition route-row orderings, the canonical chat-ownership-before-route-row order shared by usage-limit dispatch and route-key convergence, and device-sync exact-payload plus companion-receipt lock order against concurrent account deletion.
- That matrix starts from the hosted-local harness's intentional `prisma db
  push` schema. The usage-credit PostgreSQL suite therefore applies the exact
  checked-in detached direct-payment migration before creating fixtures, so
  its positive detachment and missing-proof rejections exercise migration-only
  constraints instead of silently testing the unconstrained Prisma schema.
- `.github/workflows/release.yml` uses GitHub-hosted `ubuntu-24.04`, installs once, runs `pnpm release:check` with `MURPH_TEST_LANES_PARALLEL=1`, `MURPH_APP_VERIFY_PARALLEL=1`, and `MURPH_VERIFY_STEP_PARALLEL=1` so the release verification lane uses the parallel package/smoke branches and parallel app substeps without enabling full app/package overlap unless `MURPH_ACCEPTANCE_APP_VERIFY_WITH_COVERAGE=1` is set explicitly, while the same deterministic hosted-web build placeholders keep `apps/web verify` on its truthful build path without injecting production DB or production hosted device secrets. It then packs the publishable tarballs once, scans that final inventory before the manifest is written, retains the upload/download handoff for one day, reruns the scan after download before GitHub Release upload, and scans again inside the npm publisher before its first provider request.
- Vercel deploys of `apps/web` use the checked-in Vercel build command
  `pnpm release:production:migrate && pnpm build`, so the guarded migration
  wrapper still runs automatically on main-branch production deploys while
  preview/non-main builds skip through the wrapper guard. The generic
  `pnpm --dir apps/web build` script is non-mutating and does not run production
  migrations. The guarded predeploy migration entrypoint uses
  `DIRECT_DATABASE_URL` when present, requires it in Vercel production,
  preflights the app-session signing key plus configured HTTPS public origin by
  constructing and parsing the signed group-funding recovery URL, rejects
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
  `apps/web/prisma/contract-migrations`. The exact detached direct-payment proof
  migration is a tested backward-compatible exception: migration-guard tests
  restrict it to its constraint replacement, static migration tests pin the
  required shape, and the opt-in real-PostgreSQL suite proves sessionless
  fulfilled detachment succeeds while missing PaymentIntent or Charge lookup
  proof is rejected. Destructive hosted web contract cleanup
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
- Hosted Linq weighted line-planning coverage is owned by the focused hosted-web
  tests for routing policy, canonical direct/group load derivation, home and
  proactive outreach selection, canonical thread-route refresh/repair, and the
  bounded account-projection backfill. Thread-container route coverage also
  proves synthetic-id and four-domain candidate preparation happens before
  `BEGIN`, prepared control and mailbox roots keep route/container and activation
  mailbox crypto from requiring in-transaction KMS, the version-independent
  raw-thread lock serializes creators across privacy-key write versions, the
  versioned unique identity remains a conflict backstop, and a changed route
  receives one fresh prepare-before-transaction attempt. The migration
  guard proves the nullable projection column and index remain additive.
  Assertions keep the 5,000 soft assignment target distinct from the provider's
  7,000 combined daily traffic guideline and must not introduce a runtime
  traffic rejection path.
- Automatic approval-outcome mailbox emission is unconditional. The first
  compatible Cloudflare/runner bundle and the first web bundle serving the
  action-approval read route are permanent rollback floors. Keep web at that
  floor or newer while compatible runtime or pending approval work can depend
  on the route; removing the web floor requires a separate migration or forward
  runtime. System-lane
  lag proves import progress, not that imported pending items or committed hot
  snapshots no longer contain the new wake. Roll back only to that floor or
  newer, or forward-fix. A below-floor rollback requires a separate migration
  and proof covering server rows, imported local pending items, committed
  snapshots, and in-flight producers. Approval-outcome coverage also proves
  bare return links, one parked owner across repeated turns in the same
  approval cycle, exact-cycle causal selection and generation validation instead
  of oldest-owner fallback, retained causal control work across foreground
  preemption, one causal observation read and dispatch allowlist,
  vault-file final-target binding before approval consumption while ordinary
  text delivery retains Linq current-home fallback,
  consumed authorization remaining approved in member-facing presentation while
  replay reads fail closed, and approval-link retry wakes taking precedence over
  a later parked fallback.
- Generated-delivery lifecycle coverage spans the shared exact-ref predicate,
  persisted assistant media schema, hosted side-effect codec, initial and retry
  file readers, runtime-file permission adoption, quiescent residue cleanup,
  encrypted checkpoint planning, and the portable-package boundary. Tests prove
  only `.runtime/operations/assistant/generated-deliveries/<filename>` is
  accepted, runtime parents/files tighten to `0700`/`0600`, ordinary vault refs
  keep their modes, and every other hidden, nested, unsafe, symlink, or special
  ref fails closed. Exact awaiting-approval, pending, sending, retryable, and
  confirmation-pending descriptors retain their bytes; terminal, changed, and
  orphaned direct files are absent from the archive only after the complete flat
  inventory and outbox state are trusted. Untrusted inventory or invalid entries
  retain everything. Active runtime files enter encrypted checkpoints,
  `.runtime/**` stays out of portable ZIPs, and portable-eligible ordinary
  `exports/assistant-deliveries/**` files remain ordinary vault data. Archive
  exclusions stay global rather than granting that generic path ownership.
  Assistant-engine coverage also proves that a later turn cannot replace an
  approved same-target generated vault-file ref or request a second approval
  during the approval-observation gap, while a distinct pre-decision request,
  exact-ref retry, and distinct same-turn send remain available. The
  hosted approval-resume E2E creates and requests the runtime file in one provider
  turn, checkpoints it, destroys the container, approves, restores, and proves
  one attachment delivery with no duplicate or mailbox lag. The phase-one
  reader-compatible release remains the rollback floor after producer activation.

Authenticated Linq group speaker-label coverage is split across the existing
owners. Hosted-execution parser tests lock the additive provenance enum, legacy
profile default, explicit non-overlapping name-miss evidence, exact response
keys, and rejection of private participant ids.
Hosted Web tests prove exact current-membership/profile candidates, pre-group
and unmatched canonical-phone fallback, ambiguous/suspended-member omission,
pending-profile-snapshot recovery, profile-over-contact precedence, fail-soft
advisory outcomes, one set-based profile/contact lookup, and operation-local
overflow beyond the 16-phone contact bound. Assistant-runtime tests prove the operation-local
reader memo, bounded private file-backed profile/contact-positive and
valid-negative cache, operation-only policy omissions, reuse across fresh
module instances, exact runtime and
route scope isolation, the 14-day positive and six-hour true-miss boundaries,
non-sliding FIFO eviction, failure-only operation suppression,
corruption recovery, opaque keys, private permissions where portable, provenance
preservation, duplicate
rejection, malformed-batch rejection, and mixed batch miss behavior.
Assistant-engine tests prove one four-handle reader call for a 20-message
initial burst, delegation during separate live admissions, direct-Linq
exclusion, Telegram ingress-name preservation, explicit prompt semantics, and
absence of hosted member or participant ids. Cloudflare group-tool-port tests
keep the one-second presentation-only deadline and late-result rejection.

## Current Gaps

- Assistant Ask has focused contract, parser, Web authority/idempotency,
  assistant-tool policy, runtime mailbox routing, detached-process lifecycle,
  one-time current-sender group-disclosure coverage, private-current-sender
  admission/completion/replay coverage, and Cloudflare runner-image confinement
  coverage. The private path proves exact accepted-message attribution,
  personal-runtime targeting, same-channel `direct-member` routing, queue-only
  exact-text notification, absence of group-route authority, and retry
  non-redirection. Provider-entry coverage binds the original private Assistant
  Ask expiry, exact reviewed-text digest, same personal member, and current
  same-channel direct route, then proves expiry, revocation, text mismatch, or
  route drift fails terminally without group fallback. The production-like Linux
  proof must show committed group reads succeed while writes, `.runtime/**`,
  `.codex/**`, environment files, other roots, inherited shell secrets, and tool network are
  denied, and it must show child failure or cancellation cannot interrupt the
  resident foreground App Server. Routine CI uses scripted provider responses;
  it does not send a real private-to-group ask, an accepted-input
  grant-bound group-to-member ask, one-time current-sender self-disclosure,
  private-current-sender continuation, or a scheduled same-turn ask/replay
  through deployed Web, Temporal, Cloudflare, a live model provider, and the
  applicable messaging or no-delivery destination.

- Clinical Records has focused hosted-web proof for the committed Epic
  directory v2 and acquisition policy (including v2-only schema admission, exact
  source hashing, deterministic import, all-24 query activation, unique SMART
  permission aggregation, frozen bounded-window parameters,
  Atlanta/Piedmont search, and public-endpoint rejection),
  SMART scope negotiation and bounded streams, callback redaction, runtime
  write fences, two-page raw Bundle pagination, exact-family cursor pinning,
  401/403 behavior, stale-claim and token-rotation CAS races, preemption,
  outcome replay, and account-deletion coverage. Package tests cover the shared
  runtime contracts, clinical cursor crypto lane, and patient-bound raw-evidence
  admission for newly active resource families. No automated check logs
  into a live Epic tenant or asserts that a provider's production patient data
  is complete. Focused recovery tests prove that the Temporal-owned scheduled
  command's shared mailbox handoff sweep selects at most one pending item per
  user and accepts a Clinical Records candidate only for an exact active
  queued-generation mailbox item ahead of its lane watermark. It stays bounded
  and creates no replacement work.

- Repo-level automation still does not run full end-to-end CLI scenario flows; it typechecks/builds the published shell plus the extracted `assistant-cli` and `setup-cli` packages, now includes inbox service/runtime tests plus parser-worker/runtime tests, and the `test:scenario-integrity` lane still covers fixture/scenario-manifest integrity separately.
- The current fixture/scenario lane still validates manifests and command-surface coverage, not end-to-end package orchestration.
- Hosted Temporal orchestration has shared-contract, route, focused
  web/Cloudflare, and hosted-local integration coverage. Private Murph Cloud
  owns the worker package, Workflow replay and bundle gates, full
  cross-repository matrix, Render Blueprint, and protected deployment. The
  hosted-local E2E
  suite now includes `temporal-orchestration`, which starts managed local
  Temporal, signals through web, queries the workflow, and proves the worker
  reaches Cloudflare ensure-processing. Public `hosted-temporal:guard` prevents
  a worker implementation from returning and retains the Web/Cloudflare
  architecture checks; private CI requires the current `deprecatePatch()`
  marker and verifies the exact production Workflow bundle byte budget and
  source graph.
  Future
  command-ordering edits to `hosted-user-runtime.ts` still require Worker
  Versioning/deployment pinning, `patched()` / `deprecatePatch()`, or a replay
  test against representative captured or synthetic pre-change histories for
  the newly affected path. Routine repo checks still do not validate a live
  Render deploy or a production Temporal Cloud namespace.
- Environment voice capture is covered by hosted-web recorder dismissal and authenticated upload-route tests; hosted-execution wake parsing; Cloudflare control-client, encrypted-store, Vercel-OIDC staging, write-fenced runtime read/delete, and lifecycle configuration tests; assistant-runtime integrity, transient transcription, constrained Habitat-maintenance, and post-checkpoint deletion/retry tests; plus the ordinary Environment frontend proof. Routine CI uses synthetic audio-container bytes and a mocked transcript. It does not grant a real browser microphone permission, call production Workers AI, or prove deletion from the production R2 bucket, so deployed proof still requires one authenticated physical-microphone recording and an operator check of the applied lifecycle rule.
- Hosted-local E2E scenarios launch the real Codex app-server binary by default, pointed at a local deterministic scripted Responses API stub through the test-only `HOSTED_RUNTIME_CODEX_MODEL_PROVIDER_BASE_URL` override with a fake provider key, so default lanes exercise the production app-server protocol (including dynamic-tool `item/tool/call` relay and sandboxed shell execution of scripted vault-cli calls) with zero provider spend. No automated check calls a paid model provider by default. The opt-in `codex-gateway-prefix` hosted-local E2E scenario runs the real Codex app-server against a local Responses API recorder for cache-prefix diagnostics, fingerprints the first cacheable provider prompt prefix across repeated Linq wakes, and fails if those fingerprints diverge; it is excluded from the default `all` scenario set because it can intentionally fail while provider behavior is under investigation. The opt-in `linq-group-ios-app-download` scenario uses an authenticated live provider turn through the canonical hosted Linq group route and asserts the delivered public App Store link, final-line formatting, single-bubble delivery, and personal-setup boundary; it is manual-only so routine verification never spends provider credits. Codex App Server file/PDF inputs are not advertised as natively supported unless the app-server protocol grows a supported file input item.
- `apps/cloudflare/test/codex-openai-egress-conformance.test.ts` binds the
  reviewed OpenAI route dispositions to the exact assistant package, runner
  image, workspace Codex pins, and upstream source-tree identity. The required
  Linux app-verification job resolves the version-derived upstream tag and
  verifies its exact commit, `codex-rs/codex-api/src` tree, and declared source
  paths. Offline tests then treat native scanning as corroboration: they cover
  full plus separated single- and multi-segment provider-relative candidates,
  supplement target-specific linker layout with the source-owned route list,
  and fail on every unclassified candidate; assert allowed, websocket-only,
  and blocked dispositions through the production Worker; and drive a real
  pinned App Server `web.run` turn through synthetic
  `/v1/responses` and `/v1/alpha/search` upstreams. The fixture is review
  evidence only and never generates the production allowlist. Every route
  labeled `real_codex_worker` must be present in the requests observed from that
  binary turn. Linux CI scans the same platform family shipped in the hosted
  runner; local macOS and Windows runs remain useful platform diagnostics.
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
- No pull-request check hits a live wearable OAuth provider. The default hosted-local device-connect smoke remains hermetic and creates signed Oura and WHOOP links against synthetic Junction config. Its explicit `MURPH_E2E_JUNCTION_WEARABLE_LIVE=1` mode runs alone, uses `MURPH_E2E_JUNCTION_WEARABLE_SOURCES` to select one or both real providers, drives each selected signed intent through Junction and provider browser authorization, verifies the proof-bound automatic callback plus persisted reload, and disconnects each provider during cleanup. The suite owner strips all live-mode Junction authority, provider login values, browser controls, and the retired `MURPH_E2E_OURA_PASSWORD` name from generic bundle, image, generated-artifact, cleanup, runtime, and browser commands, forwarding only current selected-provider inputs to the isolated owners. The test then keeps Junction authority in the hosted platform and passes only the current provider login to the browser driver. `.github/workflows/junction-wearable-canary.yml` runs the unattended WHOOP proof after every push to protected `main` and by manual dispatch under the dedicated `junction-wearable-canary` GitHub Environment, with read-only repository permission, fixed non-overlapping concurrency, sandbox-only configuration, step-scoped credentials, no uploaded artifacts, and Temporal disabled because connection persistence does not own orchestration. Before hosted-local preparation, that credential-free workflow exposes and smoke-checks the exact workspace Codex CLI installed by the frozen dependency graph so model-catalog discovery cannot depend on the ambient runner `PATH` or a second registry fetch. Oura's current passwordless web login requires a fresh emailed code, so its full live proof runs headfully from an operator shell with the Oura account email and manual code entry; the code and a nonexistent reusable Oura password are not persisted as CI secrets. Device-syncd auth/webhook behavior otherwise remains covered through local service tests, route tests, and stubbed control-plane callers; the private integration matrix retains the production-shaped external Temporal worker proof.
- Automatic meal-photo capture is covered by hosted-web enrollment/upload, schema-v2 authority ordering and tombstone cases, lost-response prepared-state denial, exact bodyless activation and replay, activation/deletion ordering, real-PostgreSQL direct-access, consent, scoped-deletion, sponsored-member, and sponsoring-group ordering, schema-v1 compatibility, strict request bounds, static migration shape, and an opt-in local-PostgreSQL test that executes the exact expand/contract files with a legacy-window write and validated row constraints; companion bearer-consent status/acceptance, verified-email route fallback and current-recipient resolution, accepted-capture member-wide engagement, and model-gate-with-system-lag tests; hosted-execution wake/route parsing tests; Cloudflare private-object, processing-mode, and signed control-proxy tests; Temporal blocked-system and foreground-fairness tests; assistant-runtime system-only cron projection/post-checkpoint cleanup, canonical import/idempotency/automation-postcondition, and fail-closed email-authority tests; managed-automation tests; oldest-first closeout-work CLI tests; and canonical meal photo-retirement tests. Routine CI does not grant real iPhone Photos permission or upload to the production R2 bucket, so deployed product proof still requires an explicit signed physical-iPhone capture.
- Cloudflare storage coverage locks one canonical `BUNDLES` binding and presign
  target, direct-upload drain fencing, canonical-only restore and account
  deletion, and deploy preflight rejection unless canonical buckets are ENAM
  Standard. Routine checks do not prove a live
  100-percent Worker rollout or fresh production bucket inventory; deployment
  smoke and operator checks own that proof.
- No routine repo verification command validates a real Cloudflare Worker deploy or a real Cloudflare-managed native-container rollout. `apps/cloudflare` tests now cover the in-repo worker, direct Durable Object RPC and alarms in the Workers runtime, the Durable Object/container boundary, configurable container idle-timeout wiring, container activity-expiry cleanup behavior, runtime-owned hard-floor/shutdown checkpointing plus invocation-local pre-floor assistant wake service, selective artifact materialization plus preserved-artifact snapshot behavior, keyring-aware hosted ciphertext reads by stored `keyId`, bundle/artifact cleanup on successful transitions, and Node container-image seams. The repo also ships `pnpm --dir apps/cloudflare test:e2e:runner-python:local` as a targeted final-image Python PATH E2E: it assembles a fresh runner bundle, prepares the cached native base image, builds the same `linux/amd64` app-layer Dockerfile used by the Cloudflare container, starts the image with its normal entrypoint, waits for `/health`, and checks as the non-root `runner` user from immutable `/app` with the baked runner PATH to prove `python` and `python3` resolve to Python 3. `pnpm --dir apps/cloudflare runner:docker:smoke` remains the broader local final-image smoke: it overlays smoke entrypoints into a derived bundle, restores a real fixture vault into an isolated smoke workspace inside the container, exercises `vault-cli` through Codex App Server `command/exec` for default vault reads, explicit raw `--vault`, measurement and scheduled-measurement writes, representative list commands, and hidden-vault schema/LLM metadata, exercises the shared `@murphai/parsers` attachment pipeline, and records metadata-only CLI proof counts plus the selected provider ids so the proof explicitly covers the shipped `murph` / `vault-cli` bins plus native `python` / `python3`, `pdftotext`, and ffmpeg-backed audio normalization/preparation behavior under the hosted runner's rebound `HOME` / `VAULT` model; hosted transcription itself is Worker-mediated Workers AI and is covered by `apps/cloudflare/test/runner-egress-intercept.test.ts`, the parsers remote-transcription provider tests, and the `linq-webhook` hosted-local E2E CI gate (fake `AI` binding, real egress route) instead of an in-image speech model. The runner bundle packer uses runner-specific tarballs for the CLI shell and Health Commons so E2E and deploy bundles keep the same CLI/runtime/catalog surfaces without the public npm package's nested bundled workspace payload or web-only Health Commons artifacts. Private Murph Cloud's `Deploy Cloudflare Hosted Execution` workflow runs protected-main-only Cloudflare deploy jobs on Blacksmith: hosted-local E2E gates start loopback Postgres containers, install Temporal CLI, run `codex-gateway-prefix` and `linq-delivery` with `MURPH_HOSTED_LOCAL_E2E_FAST_GATE=1`, and run `linq-scheduled-reminder` with its full one-minute reminder lead and 10-second idle checkpoint. Normal Worker deploy runs add a Blacksmith runner smoke gate that prepares the runner bundle/base image before running the focused Cloudflare verify lane plus `runner:docker:smoke:prepared-base` from the same commit. Its explicit immediate option remains the break-glass path that skips those E2E/smoke gates while still requiring the protected-main hosted Codex auth guard. The Blacksmith deploy job attaches the production environment, verifies the protected-main checkout, assembles the runner bundle and native base image without step-scoped production secrets, renders deploy config and Worker secrets, dry-runs the generated Wrangler deploy bundle, executes a direct `wrangler deploy`, reads `wrangler deployments status --json` for the smoke version and final traffic summary, validates the required GitHub environment wiring up front including `CF_PUBLIC_BASE_URL` for smoke runs, declares the required hosted runtime secrets through generated Wrangler config, and pairs the deploy docs with a checked-in transient R2 lifecycle config/helper. Gradual deploys run deployed managed-container runner-bundle and assistant CLI surface smoke with a longer retry window so Cloudflare has time to surface the new container application version; `container_rollout=immediate` adds the stricter direct-R2 managed-container smoke, and the `live_model_turn` workflow input (default on) adds one real `gpt-5.6-terra` `codex exec` turn from the deployed container through the Worker OpenAI egress intercept; that turn runs in production-deploy smoke only, never per-PR CI or hosted-local E2E. Hosted prompt-cache prefix drift, core Linq delivery regressions, scheduled Linq reminder regressions, runner-image regressions, missing deployed assistant CLI hot-path schemas, or invalid generated deploy bundles therefore block private-workflow deploys before or immediately after the real deploy step; the immediate path keeps the deploy job's own build validation, deploy, and strict managed-container smoke checks. Live deployment still depends on operator-supplied Cloudflare credentials, GitHub environment wiring, first-time container provisioning in Cloudflare, and an operator applying the bucket lifecycle rules to the real R2 buckets.
- The private protected-main Cloudflare workflow's reusable `preview` option is covered
  by deploy-automation and preflight tests rather than a routine live deploy.
  The tests lock the single workflow/config owner, selected-context Vercel OIDC
  derivation, production-only paid live-model smoke, preview crypto/OIDC
  matching, staging-scoped Worker/R2 names, distinct staging Worker/Web origins,
  and staging device-callback HTTPS/DNS rejection before mutation. The live
  preview deployment still depends on an isolated Vercel preview
  data/crypto/control plane plus environment-scoped Cloudflare credentials and
  R2 resources.
- The tag-driven release workflow is present, uses npm trusted publishing for package publication, runs a slimmer `release:check` guard path that validates release metadata, syntax-checks and tests the final-tarball secret guard, then runs `pnpm build:workspace:clean` and `pnpm verify:acceptance` without re-installing/re-building/re-packing inside the script. The guard's focused Node tests cover accepted source literals, exact public metadata and placeholders, declaration-only `.d.ts` colon syntax, invalid `.d.ts` equals assignments, and the existing external pack-output contract. Negative cases cover sensitive filenames, provider tokens, private key/JWK/wallet material, credentialed URLs and form/query parameters including JWT-shaped values, separator- and camel-case credential names, JSON/bracket/setter/tuple authorization serialization, quoted and unquoted generic assignments with command prefixes, shell operators, terminators, and comments, credential-bearing archive segments and tarball names with all artifact names hidden by default, archive links, and tarball-inventory drift. `incur` remains an explicit bundled `@murphai/murph` runtime dependency until its patched lazy optional-dependency fix ships upstream; its required runtime and source entrypoints remain in the tarball, while the three proven non-runtime upstream test sources that previously required scanner exceptions are omitted so every shipped file receives one unconditional scan policy. The CLI release-workflow guard locks the scan ordering ahead of manifest write, npm provider access, and GitHub Release upload plus the handoff's one-day retention. The workflow is only exercised on real `v*.*.*` tag pushes rather than during ordinary repo verification. npm trust is package-level rather than repo-level, so this monorepo also ships `pnpm release:trust:github` for the one-time bootstrap that binds every publishable `@murphai/*` package to `cobuildwithus/murph` and `.github/workflows/release.yml`; if a package already has the wrong trusted publisher entry, that npm-side state still needs manual revoke-and-recreate repair, which local repo checks cannot fully prove.

## Update Rule

When real source code, CI, or deployment automation is added, update this file and `agent-docs/operations/verification-and-runtime.md` in the same change.

## Hosted Stripe Billing Lanes

`.github/workflows/hosted-stripe-billing.yml` separates proof from authority:

- `Hermetic hosted billing proof` runs on every pull request, including forks. It exercises Starter-to-paid Checkout, the legacy trial-to-Starter migration, live-config partition and listener-child credential tests, browser/cleanup pure support tests, and workflow guard mutations without a Stripe secret or network call to Stripe.
- `Live hosted-local Stripe browser matrix` can run only for a same-repository PR head, excludes dependency-bot heads, uses the protected `hosted-stripe-billing-sandbox` GitHub Environment, and is serialized with `cancel-in-progress: false`. Fork code is classified before a secret-bearing job is eligible; this workflow must never be converted to `pull_request_target`.
- Every trusted same-repository head enters the live job and fails closed if the protected Environment contract is absent or malformed. Fork and dependency-bot heads run only the hermetic job. The always-present `Required hosted Stripe billing boundary` result requires hermetic success plus live success whenever the trust classifier admits the live job. The dedicated secret, sandbox account, four price IDs, public Privy app id, and active default Portal configuration with plan updates and immediate invoicing stay outside the repository. The browser remains the authoritative proof that Stripe exposes both dedicated individual products.
- Failure upload is limited to `apps/web/playwright-report/hosted-stripe-billing/redacted.json`, containing only the opaque run id and step/surface/status records. Checkout/Portal URLs, object IDs, provider payloads, browser screenshots, traces, and full reports are not artifacts. Cleanup is always attempted and independently recoverable with the same opaque run id.

The five browser cases cover Starter activation followed by paid Pulse Checkout,
paid Pulse to Edge, Edge to Pulse at renewal, Family Checkout plus invite
activation, and paid individual-to-Family conversion in place. Edge to Pulse
remains a scheduled renewal downgrade and is asserted as current Edge plus
pending Pulse rather than an immediate price replacement. Mutable run-owned
Sessions, Schedules, Subscriptions, Customers, and PaymentMethods are cleaned
up, while Stripe's immutable paid invoices, events, and terminal records remain
as bounded provider audit history.
