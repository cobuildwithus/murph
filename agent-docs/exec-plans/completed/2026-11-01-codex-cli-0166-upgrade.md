# Upgrade Codex CLI to stable 0.166.0

Status: completed
Created: 2026-11-01
Updated: 2026-11-01

## Goal and protected invariants

Upgrade the registry CLI and native hosted source together to stable 0.166.0.
Preserve steering, public Live ownership, auth isolation, cache accounting,
provider egress policy, and pnpm supply-chain controls.

## Scope and authority

Update the existing package, image, native patch, protocol/error and reviewed
route owners. Compare against HEAD. Leave edits uncommitted for the parent;
no branch changes, Murph fetches, pushes, PRs, deployments or production access.
Historical plans and release notes remain unchanged.

## Evidence and approach

The registry latest release is 0.166.0. GitHub annotated tags resolve 0.163.0 to
83086188ae0614bd882818ff1aa23f3194962012 and 0.166.0 to
6ff1e1ca3b30fc8b914720681fcf5fe62e95f856. Review the three intervening release
notes, generated protocol schemas, provider endpoint sources and feature defaults.
Port the existing patch against isolated official source archives; do not add
another runtime owner or widen provider admission. Preserve upstream refactors.

## Tasks

1. Verify registry/tag/archive provenance and protocol/default/route changes.
2. Update all true pins, port native patch and cover error/parser compatibility.
3. Run focused CLI/runtime/egress/config tests, package typechecks, dependency
   guard/audit, upstream verifier, complexity, docs drift and diff checks.
4. Review the complete HEAD diff and record remaining native/CI/deploy proof.

## Risks and deployment

The native patch must compile against refactored upstream owners; applicability
alone is not build proof. No full local native build is planned. Exact-image
Linux permission, Live, steering, egress and hosted continuity proof remain CI
and protected-build responsibilities. Publish the new base and final runner
together; no Web/Worker payload or snapshot schema changes are intended. Keep
the previous complete runner artifact as the rollback candidate; a base-only
revert would separate the binary from reviewed provenance.

## Decisions and verification

### Provenance

- npm registry metadata: https://registry.npmjs.org/@openai/codex confirms
  latest 0.166.0, published 2026-10-29T19:56:19.746Z. The GitHub release is
  non-prerelease, published 2026-10-29T19:47:53Z.
- Annotated GitHub tags rust-v0.163.0 and rust-v0.166.0 resolve to the commits
  above. No Murph branch or remote-tracking ref was changed.
- Read release notes for
  https://github.com/openai/codex/releases/tag/rust-v0.164.0,
  https://github.com/openai/codex/releases/tag/rust-v0.165.0 and
  https://github.com/openai/codex/releases/tag/rust-v0.166.0.
- SHA-256 of registry wrapper
  https://registry.npmjs.org/@openai/codex/-/codex-0.166.0.tgz:
  `67ee6f4069d9328956401f54ac202c20369233159058af9f4ec1af731b87f5b7`.
- SHA-256 of official Linux helper archive
  https://registry.npmjs.org/@openai/codex/-/codex-0.166.0-linux-x64.tgz:
  `cbc00a26d3d0e2ceefc4be8891f8a81ef1e349b3b175bc0ae308762bc001fd93`.
- SHA-256 of official source archive at the resolved tag commit
  https://codeload.github.com/openai/codex/tar.gz/6ff1e1ca3b30fc8b914720681fcf5fe62e95f856:
  `1e33229b8b63237f666d62ba1476134383400d66032cdfde10b7f79debd15d28`.
- Both npm archives also match registry SHA-512 integrity. The Linux archive
  retains the Code Mode host and bwrap resources copied by the Dockerfile.

### Upstream behavior decisions

- Review delivery now admits only inline. Murph has no review/start caller,
  so there is no detached request to migrate. The generated-schema gate checks it.
- modelNotFound is terminal in turn/process classification and cannot become a
  capacity retry through misleading provider prose. policyCapacityUnavailable
  uses the existing five-minute capacity retry, without connection recovery or
  changing service tiers. Both kinds survive the bounded diagnostic allowlist.
- The top-level TurnStartParams and TurnSteerParams TypeScript shapes are
  unchanged; their nested AdditionalContextEntry adds optional name. ThreadItem
  adds optional startedAtMs/completedAtMs. The schema gate checks optional name,
  and the envelope regression accepts lifecycle fields without changing readers.
  The remaining schema changes include image item fileId/result alternatives,
  optional image inputs, process output-drain status, native usage, feedback-save,
  hooks/account/config metadata and structured model-provider errors. Murph's
  record readers tolerate additions; native image items are not its image-tool
  result owner, and unknown RPC errors retain the existing fail-closed path.
- No Murph setting uses code_mode_tool_description_first or the other reviewed
  removed flags. instant_interrupt and code_mode_interrupt remain enabled by
  the existing explicit process overrides in assistant-codex/config.ts.
- Hosted native memory remains disabled by features.memories plus explicit
  generation/use flags; the fresh-profile memory-v2 default creates no new work.
- Accept the explicitly intended 0.165.0 reasoning-effort-override default.
  Murph already sends its selected effort per turn. Upstream can preserve the
  request baseline and record trusted effort updates in history. Do not pin the
  old disabled feature or change Murph's selected model/effort. The existing
  scripted model/effort switching and request-count assertions pass.
- Reviewed provider client source changes add no OpenAI route. GCP's project
  route uses a different origin; seven new exact linker concatenations receive
  test-only dispositions. Production egress admission remains unchanged.
  Upstream app-server WebSocket compression remains disabled by default;
  Murph's stdio RPC and provider WebSocket/SSE fallback and steering retain
  their existing owners. No additional Murph model call or retry loop was added.

### Native patch port: every manually reconciled hunk

Unlisted hunks retain the same additions/deletions with refreshed offsets and
blob hashes. Existing blank context-line formatting is preserved.

1. app-server/README.md: append host input/config-isolation documentation after
   the new upstream tail without dropping its documentation.
2. app-server startup/config plumbing in in_process.rs, lib.rs, main.rs,
   message_processor.rs, message_processor_tracing_tests.rs,
   user_verification_test_support.rs and cli/src/main.rs: retain upstream cloud
   skill and startup configuration additions beside ignore_user_config. Keep
   the refactored thread_extensions(config, dependencies) call and substitute
   only the existing isolated instructions provider. Register user_config_auth_tests
   beside the newly extracted lib_tests module, rather than restoring removed
   inline upstream tests. Add the false default to the new
   message_processor_workspace_routing_tests.rs constructor.
3. codex-api realtime_websocket/methods.rs, two transcript lookup hunks:
   include PublicLive beside V1/V2 while accessing the new
   ActiveTranscriptEntry.transcript.role field. Preserve upstream transcript
   lifecycle storage. realtime_call.rs needs refreshed surrounding context for
   upstream voice-session forwarding; its Murph adapter additions are unchanged.
4. core/client.rs, two hunks: use upstream realtime_client_setup and its mutable
   provider setup while retaining the authentication-mode consistency check;
   use upstream prompt_cache_key(responses_metadata) while retaining hosted
   twelve-hour cache options. Other client additions are unchanged.
5. core/realtime_conversation/sideband.rs: reconcile upstream's explicit
   transport-only cancellation cleanup with the existing owned-session shutdown.
   Frontend-owned calls close only their sideband transport. Owned public Live
   calls still send session.close and drain terminal usage with the existing
   deadline; a confirmed ProviderClosed event is not undone by later close
   failures. Retain close-only reattachment and prohibit replay of uncertain
   public Live appends. Keep upstream close_sideband_transport alongside the
   existing close_owned_session helper; avoid closing the same transport twice.
6. Guardian token delta moved from core/guardian/review_session.rs into
   ext/guardian-reviewer/metrics.rs. Remove the obsolete function/test hunks and
   carry cache_write_12h_input_tokens subtraction and the three relocated test
   literals into the new owner.
7. New realtime ConversationStartParams literals in
   core/src/realtime_conversation_tests.rs and
   core/tests/suite/realtime_conversation.rs receive client_managed_inputs: false.
   This preserves default native input ownership in upstream tests.
8. tui/src/chatwidget/tests/helpers.rs: remove the old patch's duplicate
   cache_write_12h_input_tokens initializer; retain exactly one field.
9. Rebase both precomputed stable/experimental schema archives on 0.166.0,
   carrying only the existing clientManagedInputs and twelve-hour token fields.
   Preserve all new upstream definitions. Stable TypeScript/JSON exports were
   compared byte-for-byte with the ported source fixtures; internal/experimental
   JSON changes were merged structurally. The binary patch churn reflects new
   upstream compressed archives, not a protocol rollback.

### Verification commands and outcomes

- pnpm install: passed; exact version and six platform variants updated. The
  seven exact release-age selectors remain narrow. No lifecycle builds were
  blocked. Existing shadcn/Zod peer warnings remain. pnpm also normalized three
  pre-existing Vitest peer/optional snapshot entries without version changes.
- pnpm deps:guard: passed for all 29 manifests.
- pnpm deps:ignored-builds: none.
- pnpm deps:audit: failed with 41 findings (3 high, 33 moderate, 5 low).
  The high findings are existing deepmerge-ts, Zod and follow-redirects paths;
  those package versions are unchanged against HEAD. No unrelated upgrade made.
- pnpm --dir apps/cloudflare verify:codex-upstream-source: passed; exact tag,
  commit, version/base-tag agreement, isolated-index patch application and all
  16 reviewed source paths verified.
- Testing-map assistant-engine Vitest command, extended with websocket-stall
  and failures: initial run 484 passed, 41 skipped, three failures. The two
  common-list-limit cases required a built CLI; pnpm build:workspace:incremental
  passed, then their focused rerun passed both cases. The capacity retry test
  exposed the adjacent scheduler classifier; fixed and reverified below.
- pnpm --dir packages/assistant-engine exec vitest run --config vitest.config.ts
  --no-coverage test/assistant-codex-failures.test.ts
  test/assistant-automation-support.test.ts test/app-server-protocol.test.ts
  test/assistant-codex-runtime-config.test.ts: 215 passed. After strengthening
  the model-not-found prose guard, failures plus automation-support reran:
  106 passed. All originally failing cases now pass.
- The mapping command covered tool-input-contract, scripted-runtime,
  turn-planning, thread-instructions, runtime-config, runtime-tools,
  runtime-process, runtime-recovery, websocket-stall and failures suites.
  SSE preemption, rapid steering, nested-tool cancellation, WebSocket interrupt,
  sticky HTTPS fallback and request-count assertions passed without weakening.
- pnpm exec vitest run --config apps/cloudflare/vitest.node.workspace.ts
  --no-coverage apps/cloudflare/test/codex-openai-egress-conformance.test.ts
  apps/cloudflare/test/container-image-contract.test.ts: 16 passed.
- The same binary-inventory helper scanned the official Linux x64 release:
  zero unclassified routes, supplementing the macOS ARM64 conformance run.
- pnpm --dir packages/assistant-runtime exec vitest run --config vitest.config.ts
  --no-coverage test/hosted-runtime-codex-config.test.ts: 48 passed, 6 skipped.
- pnpm --dir apps/web prisma:generate: passed (documented Cloudflare typecheck
  prerequisite). Assistant-engine and Cloudflare package typechecks passed
  after the final TypeScript edits.
- Rustfmt syntax parsing passed for the patched Rust files. Complete struct
  literals for the changed host fields were audited. This is not Rust type or
  link proof. No full native build or upstream Cargo test was attempted locally.
- pnpm complexity:diff: passed against HEAD, six source files, no function above
  20. pnpm docs:drift and git diff --check passed; rerun after plan closure.

### Remaining proof and handoff

No real-provider model journey, native Rust compilation/test execution, patched
Linux binary run, image publication, protected deploy or production test was
performed. Skipped tests include patched-binary-only bounds and optional lanes.
CI must compile the native patch and run exact-image Live, auth isolation,
cache accounting, sandbox, steering, egress/catalog and continuity tests before
protected publication/deployment. A released binary passing does not establish
the patched binary's behavior. Final parent review and any required ReviewGPT
remain with the parent, since this task explicitly forbids commits and PRs.

The test prerequisite friction is recorded in
.agents/friction-log/20261101225406-codex-upgrade-test/friction.md and is left
uncommitted with the task as requested. No changelog is added for the internal
runtime dependency upgrade. No new persisted state, production policy owner,
provider credential access or user-facing product surface is introduced.

Completed: 2026-11-01
