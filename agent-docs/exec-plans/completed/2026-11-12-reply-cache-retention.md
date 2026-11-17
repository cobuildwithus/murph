# Restore reply-only twelve-hour prompt caching

Status: completed
Created: 2026-11-12
Updated: 2026-11-12

## Goal

Restore twelve-hour OpenAI prompt-cache retention for conversation replies while
all other turns and compaction keep the provider's thirty-minute default.

## Success criteria

- Per-turn opt-in reaches HTTP and WebSocket requests, including tool continuations,
  silence closing calls, and same-thread reconsideration; no thread-level inheritance.
- Native lifetime accounting reaches existing TypeScript usage and Web pricing.
- Focused tests, typechecks, patch application verification, and a local native
  build pass, or the handoff precisely identifies unavailable proof.

## Scope

- In scope: a separate cache-only patch on Codex 0.167.1, turn policy, native usage,
  runner fingerprints, source verification, and deployment documentation.
- Out of scope: live OpenAI calls, production access, pushes, PRs, deployments,
  sandbox or permission changes, shared cache keys, and retired live voice code.

## Constraints

- Use the existing per-turn `turnTrigger` metadata label as the explicit opt-in.
  Murph's turn runner owns eligibility. The native request builder owns TTL and
  compaction exclusion; native token usage owns the twelve-hour subset.
- The removed patch explains the regression: stock Codex has neither request TTL
  selection nor lifetime accounting. Existing Web readers remain compatible.
- No new persisted owner, migration, auth path, or dependency is needed.
- Commit locally on the supplied branch. CI and required final ReviewGPT belong
  to the later user-owned PR; this task has no push authorization.

## Risks and mitigations

1. A reply alternates thirty-minute and twelve-hour writes and rewrites its prefix.
   Preserve the label throughout the native turn and reconsideration; exclude only
   compaction, which replaces the prefix. Prove multi-request sequences locally.
2. A reused thread carries a previous turn's opt-in into cron or notification work.
   Use native turn metadata, never thread settings, and test a later unlabeled turn.
3. Lifetime writes are dropped or charged twice.
   Preserve a subset of aggregate writes through native sums/deltas, sanitized usage,
   the hosted record parser, and existing mixed-lifetime pricing tests.
4. Runner/native skew changes retention.
   Ship TypeScript and native patch together. Old native binaries ignore the label;
   new binaries without a label use defaults. Existing usage readers need no deploy.

## Tasks

1. Done: cache-only patch, generated protocol exports, and native tests.
2. Done: provider-boundary turn classification and real native scripted requests.
3. Done: runner build/fingerprints/source and review packaging use both patches.
4. Done: accounting, package checks, owner docs, privacy, and parent diff review.
5. Close this plan in the requested scoped local commit.

## Decisions

- Internal-only cache policy and accounting restoration: no product copy or public
  changelog entry. Prompts and tool behavior are unchanged; no live model run.

## Verification

The cache-only native patch contains 276 added and two removed text lines across
Rust, tests, and generated schemas, plus two regenerated compressed protocol
exports. These generated binaries account for most of its approximately 656 KiB.
It applies after the unchanged WebSocket acknowledgement patch; no live-voice
code, sandbox settings, permission policy, cache keys, or thread identity changed.

Native commands ran in `/tmp/murph-cache-codex/codex-rs`, from checksum-pinned
Codex `0a94398fa60c4fac0e7659e4213a0a36e613dd46` (0.167.1), with both patches.
The local lockfile used the same workspace-version normalization as the Docker
build; that build-only lockfile adjustment is excluded from the patch.

- `cargo build --locked --bin codex -j 4`: passed; macOS debug binary, initial
  build 4m21s and final incremental rebuild 1m15s.
- `cargo test -p codex-api --lib --locked -j 4`: 199 passed. Includes HTTP and
  WebSocket serialization with/without TTL, lifetime parsing and accumulation,
  and the existing WebSocket acknowledgement tests.
- `cargo test -p codex-core hosted_cache_retention_requires_explicit_reply_opt_in --lib --locked -j 4`:
  1 passed. Covers known models, default/unknown labels, hosted/key restrictions,
  and standalone, pre-turn, and mid-turn compaction.
- `cargo test -p codex-app-server-protocol --lib schema_fixtures --locked -j 4`:
  6 passed, 1 intentionally ignored generator. Stable and experimental compressed
  exports match generated schemas. An intermediate run used the old experimental
  blob; regeneration and this final run resolved the mismatch.
- Schema generation used `CODEX_APP_SERVER_SCHEMA_ROOT=/tmp/murph-cache-codex/codex-rs/app-server-protocol/schema`
  and `CODEX_APP_SERVER_SCHEMA_EXPERIMENTAL=0`, then `=1`, with
  `cargo test -p codex-app-server-protocol --lib schema_fixtures_tests::write_schema_fixtures_from_env --locked -j 4 -- --exact --ignored`:
  both passed. `rustfmt --check --edition 2024 --config skip_children=true`
  over the 34 changed Rust files passed.

Repository commands, all passed:

- `pnpm --dir packages/assistant-engine exec vitest run --config vitest.config.ts --no-coverage test/assistant-codex-runtime-config.test.ts test/assistant-codex-final-coverage.test.ts test/codex-runtime-helpers.test.ts test/app-server-protocol.test.ts`:
  239 tests. Classification runs through the production provider boundary;
  `turn/start` omits the opt-in on later default turns.
- `MURPH_TEST_CODEX_COMMAND=/tmp/murph-cache-codex/codex-rs/target/debug/codex pnpm --dir packages/assistant-engine exec vitest run --config vitest.config.ts --no-coverage test/assistant-codex-scripted-runtime.test.ts -t 'keeps (reply requests opted in|in-turn compaction)'`:
  2 passed, 145 unselected. Uses a credential-free local provider stub and the
  final native binary. Proves silence tool continuation/closing call, same-thread
  reconsideration, later unmarked turn before compaction, idle compaction, and
  12h/default/12h in-turn compaction. All selected scenarios are also selected by
  the existing deployed-binary CI lane.
- `pnpm --dir apps/web test:prepared --no-coverage test/hosted-execution-usage-allowance.test.ts`:
  147 passed. Native scripted usage reaches `helpers.ts` and the public hosted
  usage parser with 200,000 input, 100,000 cache reads, 60,000 aggregate writes,
  40,000 twelve-hour writes, and 14 output tokens. The matching Web record costs
  340,140 USD micros, including twelve-hour writes at $5/M versus $2.50/M for
  thirty-minute writes. Existing mixed-tier and invalid-subset tests pass.
- `pnpm exec vitest run --config apps/cloudflare/vitest.config.ts apps/cloudflare/test/runner-base-image.test.ts apps/cloudflare/test/container-image-contract.test.ts apps/cloudflare/test/deploy-artifacts.test.ts --no-coverage`:
  90 passed, including retention-only base and bundle invalidation.
- `pnpm exec vitest run --config scripts/vitest.config.ts scripts/review-gpt-native-context.test.ts --no-coverage`:
  11 passed; either patch triggers packaging of both committed postimages and
  patch digests, while unsafe source handling remains closed.
- `node --test scripts/check-container-latency-ci.test.mjs`: 9 passed.
- `node --test scripts/package-audit-context-custom.test.mjs`: 3 passed.
- `pnpm --dir packages/assistant-engine typecheck`,
  `pnpm --dir apps/cloudflare typecheck`, `pnpm --dir apps/web typecheck`, and
  `node scripts/run-typescript.mjs check -p tsconfig.tools.json --pretty false`:
  all passed.
- `pnpm --dir apps/cloudflare verify:codex-upstream-source`: passed; exact
  upstream tag/commit, ordered patch applicability, and 16 reviewed source paths.
- `pnpm complexity:diff`: passed after removing an unnecessary adapter null
  fallback; no added complexity debt. Existing large-function hotspots reviewed.
- `pnpm docs:drift`, `git diff --check`, and
  `bash -n scripts/package-audit-context-full.sh scripts/repo-tools.config.sh`:
  passed. Ruby YAML parsing of the changed CI workflow passed.

## Parent review and remaining proof

The change adds no awaited operation, provider round trip, database work, cache
key sharing, or model-visible instruction/tool change. Retention and its opt-in
metadata are transport fields; individual/group prompt assembly remains owned by
existing code. Review covered per-turn ownership, continuation propagation,
compaction replacement, cumulative usage and deltas, reader compatibility,
runner fingerprints, CI selection, review packaging, and public-data hygiene.
No repository-actionable Frog entry was needed.

Deployment: build the patched base and ship the application runner with the
TypeScript opt-in. Existing Web readers need no update. Old/new application and
native skew uses provider defaults until both are present. Existing readers can
price the new subset and continue to read old rows; no migration or historical
repricing is needed. Verify the deployed fingerprint and fresh reply write
subsets, with none on cron rows, as documented in the deployment owner.

Unproven here: live OpenAI cache-hit/rate behavior, deployed usage rows, Linux
release/container build, hosted smoke, exact-head CI, and final ReviewGPT.
No live OpenAI calls, production reads, deployments, pushes, or PR creation
were performed. The user owns the later push/PR and its external review gates.
Completed: 2026-11-12
