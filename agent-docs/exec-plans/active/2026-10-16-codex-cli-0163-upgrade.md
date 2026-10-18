# Upgrade Codex CLI to 0.163.0 with default instant steering

Status: active
Release decision: Hold — native AMD64 runner-image/permission proof and hosted-local scenarios unavailable
Created: 2026-10-16
Updated: 2026-10-18

## Goal

- Evaluate and upgrade the repository-pinned Codex CLI from 0.160.0 to the latest stable 0.163.0 without weakening Murph's native voice, permissions, schema, transport, or delivery contracts.
- Expanded 2026-10-18 by explicit user request: enable upstream instant steering
  (`instant_interrupt`) by default for every Murph-launched Codex App Server, so
  an admitted follow-up preempts stale generation inside the same turn. Decide
  `code_mode_interrupt` independently from durable-tool evidence.

## Ownership

- 2026-10-18: the prior owner task handed exclusive authorship of this worktree
  and branch to the current authoring session at base `a83068ad`. The full-index
  binary diff of the 17 handed-off tracked edits plus this plan was rechecked
  before any new edit. Prior proof below covers that October 16 tree only.

## Success criteria

- Verified upstream release/source identity and compatible native patch; synchronized package, lockfile, image, and source-inventory pins.
- Passing real-binary CLI matrix, egress/source/image parity, payload measurements, local acceptance, fresh runner-image smoke, relevant hosted-local scenarios, and focused live journeys with Ready reply review.
- Scoped commit and PR with exact-head CI and required final ReviewGPT. No merge or deployment.

## Scope

- In scope: Codex pins, verified source inventory, required native-patch compatibility, focused regression proof, and the Murph-owned App Server feature defaults for turn steering.
- Out of scope: unrelated product work, shared/global CLI replacement before proof, production operations, a Murph cancel-and-restart controller, and any change to intake batching, journal ownership, or delivery policy.

## Product UX

- Effort: Product change (reply timing and stale-reply behavior on an existing journey).
- Outcome: when a member sends an admissible follow-up while Murph is still
  generating, Murph incorporates it in the same turn instead of first finishing
  the stale answer.
- Entry and promise: a direct or group conversation whose follow-up already
  qualifies for live steering (same conversation, exact successor, before the
  first completed answer, within the 50-message cap). Nothing about which
  messages qualify changes.
- Affected journeys: direct correction mid-answer; direct additive follow-up;
  group held-draft reconsideration; follow-up during an in-flight tool; follow-up
  after the first completed answer (unchanged: next ordinary turn).
- Done when: one coherent reply covers the steered input, no unfinished text is
  delivered, completed tools and progress effects are not repeated, and late
  input still reaches the next ordinary turn.

## Constraints

- Technical constraints: preserve upstream/native ownership, existing package supply-chain controls, isolated synthetic test state, and all current safety assertions.
- Product/process constraints: preserve unrelated checkouts; use the sanctioned isolated worktree and approved commit identity. Missing proof means Hold.

## Risks and mitigations

1. Upstream changes invalidate the native voice and transport patch.
   Mitigation: verify patch applicability and upstream behavior before changing pins; rebuild and test the actual candidate.
2. Local runtime prerequisites block full proof.
   Mitigation: inspect and start the existing local container runtime; report unavailable proof truthfully and retain the validated version.

## Tasks

1. Resolve release and current remote-main pins; establish isolated ownership.
2. Inspect upstream source changes and native patch compatibility.
3. Update authoritative pins and only necessary compatibility code.
4. Run deterministic checks, candidate builds, payload measurements, live journeys and local acceptance.
5. Review, commit, open PR, and complete exact-head CI and final review.

## Decisions

- Upstream GitHub stable release and npm latest both identify 0.163.0. The annotated tag resolves to commit 83086188ae0614bd882818ff1aa23f3194962012.
- Current remote main at a83068adbe524217d32a22c270902ef0b02c6921 uses 0.160.0; the older primary checkout is not the upgrade baseline.
- 2026-10-18: release and npm still identify 0.163.0 as latest stable. Remote
  main advanced to `1046d9e9`; reconcile through one ordinary merge after
  preserving the handed-off tree in an intermediate commit.

## Verification

- Follow the current CLI-upgrade matrix in `agent-docs/references/testing-ci-map.md`, source verification, Docker runner smoke, hosted-local scenarios, and `verify-murph-assistant` journeys.
- Run the explicitly requested local `pnpm verify:acceptance` in addition to exact-head PR CI.
- Expected outcome: all required checks pass against the candidate, with no assertion weakening or skipped prerequisite reported as success.

## Candidate evidence

- Registry helper and live journeys explicitly execute 0.163.0. The documented eight-file real-binary matrix passed 440 tests; 28 opt-in cases were skipped in that deterministic lane. Assistant-engine typecheck passed before subsequent version-comment edits.
- All six documented focused live journeys passed: native and code-only nine-item text and comparison-card cases, Sol code-only song duration, and Luna deferred mixed song duration. Each synthetic reply and required/forbidden effect was reviewed Ready; song cases made exactly one 300-second generation and one attachment. These prove the registry helper, not the still-unbuilt patched runner binary.
- Four complete-first-request measurements passed for each CLI version. Candidate request byte deltas versus 0.160.0: direct native +31, direct code-only +3,422, group native +31, group code-only +3,422. Only prompt_cache_key is excluded; no exact tokenizer was available.
- Image contract passed 11 tests. Updated egress inventory passed 11 tests after source review classified three newly observed binary strings and explicitly blocked the new Guardian Decisions POST endpoint. Source ownership now spans codex-rs because that endpoint lives outside codex-api.
- Dependency guard passed all 29 manifests. The unchanged dependency graph contains existing audit advisories; no Codex path appears in the audit. This upgrade does not remediate unrelated dependencies.
- The native patch was rebased for upstream Responses interruption state, transcript-tail history routing, and protocol fields, preserving those upstream behaviors. An initial schema-generation attempt was killed with SIGKILL in a 2 GiB container VM; the isolated larger-VM retry passed.
- Status remains Hold until final runner-image smoke, hosted-local scenarios, and exact-head review/CI are complete. No shared CLI or deployment changed.

### Native rebase proof

- Experimental schema regenerated successfully with the upstream generator after increasing isolated VM memory. Decompressed comparison retains the exact file inventory and changes only clientManagedInputs request/response fields and their generated TypeScript declarations.
- Upstream tag/commit, patch applicability, and all 13 reviewed source paths passed the canonical verifier. The patch is now based on pristine 0.163.0.
- Native codex-api library suite passed 200 tests, including the added regression proving completion-before-cancellation-acknowledgement and socket reuse after a delay longer than the response acknowledgement bound. App-server protocol library suite passed 316 tests; the ignored schema writer was executed separately and passed.
- Final combined egress/image parity passed 22 tests. Complexity guard passed with unchanged debt. Workspace package/app typechecks and 886 repo-tool tests passed inside the continuing local acceptance run.
- Hosted-local preflight initially lacked the external Temporal worker setting; the documented local package is available and configured preflight passes. No Temporal disabling or production fallback is used.

### Local verification follow-up

- The 28 deterministic skips are opt-in input-measurement cases (22 secondary-tool cases, two memory cases, four shared-schema cases). The four documented shared-schema measurements were separately enabled and passed for both CLI versions.
- Runner bundle assembly and its bundled/unbundled CLI parity probes passed. Its rebuild accidentally overlapped the first acceptance CLI lane, which reported ten failures in read-only-provider-error-recovery. With assembly finished, the unchanged suite passed all 60 tests. The first acceptance attempt is not accepted as proof; require a clean run without overlapping artifact rebuilds.
- An owned, isolated local Postgres container is ready for synthetic hosted-local scenario databases. No existing database was reset.
- Fresh production-platform runner-base build started through the canonical builder with one Cargo job and a task-specific Docker context. The global Docker context and shared CLI remain unchanged.

### Completed source and request review

- Native core realtime library tests passed 78 cases. All 69 app-server realtime integration tests passed, including public Live setup, client-managed inputs, owned shutdown, transport loss, and final usage. GNU ld exceeded the local test VM memory; an isolated LLVM-linker retry passed without changing the production build recipe.
- The clean acceptance rerun passed all 1,532 CLI tests; the earlier missing-module failures were caused by the overlapping bundle rebuild. The complete clean canonical gate subsequently exited successfully.
- Captured all eight synthetic first requests for each CLI version without changing the tests or provider behavior; four measurement cases passed per version. Private captures stay ignored. Reviewed deltas: tool-availability guidance; code-only shared MCP types plus list/read-resource declarations; fork_turns now supports all/none (Murph uses none); and history_initialization metadata. Other observed environment text differences are fixture locations and generated transport identities. Hosted configuration supplies its own Codex home and no MCP server configuration, and no remote board service is configured. Canonical Murph tool assertions remain intact.
- Complete candidate first-input sizes versus 0.160.0: direct native 163,699 -> 163,730 bytes; direct code-only 156,231 -> 159,653; group native 144,580 -> 144,611; group code-only 133,245 -> 136,667. Native +31 bytes; code-only +3,422 bytes. Only prompt_cache_key is excluded from these counts; exact token counts remain unavailable.

### Runner-image blocker and dependency recovery

- The canonical fresh production-platform base-image build failed in unchanged AWS-LC 0.45.0 while compiling its x86 assembly: the C compiler terminated with SIGSEGV under local AMD64 emulation. Both 0.160.0 and 0.163.0 pin that same registry dependency. The exact failing compiler command subsequently passed in an isolated AMD64 reproduction using the same AWS-LC source and toolchain. The full-build crash remains unresolved; neither a deterministic candidate regression nor a passing runner build has been established.
- The documented native permission gate also states that ARM64-hosted AMD64 emulation cannot install the inner Codex seccomp filter. Do not weaken or bypass that gate. A successful native AMD64 local runner-image build and smoke remain required by this automation.
- The older local external Temporal worker lacked the required compatibility script. An isolated checkout of the current external worker installed from its frozen registry lockfile and passed this Murph checkout's synthetic reconciliation-compatibility preflight. No consumer source or shared checkout changed.
- Hosted-local gateway/prompt-cache, vault persistence, reply delivery, media/tool delivery, and scheduled-reminder scenarios remain unexecuted because the candidate runner image is unavailable. Native source tests and registry-binary journeys do not substitute for these scenarios. No PR, commit, merge, or deploy has been performed.

### Final decision for this run

- **Hold.** The clean `MURPH_VERIFY_EXECUTOR=local pnpm verify:acceptance` run exited 0. This includes package coverage, all workspace typechecks, 13,938 Web tests, Web lint/development smoke/production build, 4,308 Cloudflare Node tests, and the Worker-runtime lane. Standard opt-in skips are not image or hosted-local proof.
- Final source verification passed the exact tag, commit, patch application, and 13 reviewed source paths; documentation gardening found zero issues; `git diff --check` passed.
- No compatibility failure remains in the completed registry-binary or native-source checks. The failed production-platform image build remains unresolved, and neither the fresh image permission smoke nor required hosted-local scenarios ran. Native AMD64 verification capability is needed; the local emulation limitation is documented in the current test owner. Do not promote this candidate or describe it as ready.
- Preserve the isolated candidate, private logs, native test cache, and ownership handoff for the next automation run. The shared installation/deployment remain unchanged. No commit or PR was opened because this automation requires all local gates before that step; ReviewGPT and exact-head CI therefore remain pending.

## 2026-10-18 instant steering and base reconciliation

### Decisions

- `instant_interrupt` and `code_mode_interrupt` are both default-on in 0.163.0
  upstream; Murph now sets both explicitly as CLI-layer `--config` defaults in
  the one App Server launch owner (`assistant-codex/config.ts`, composed in
  `prepareCodexAppServerProcessInput`) so every fresh, resumed, Ask, and hosted
  turn uses them and user-config isolation cannot drop them. An explicit caller
  value for the same key wins, the same precedence the model-catalog default
  uses; no rejection API or source scan was added. Managed-account login does
  not launch turns and is unchanged.
- `code_mode_interrupt=true` was assessed independently. Real-binary proof
  showed no difference for Murph nested tools: in both settings a yielded cell
  never reached a later turn and each nested effect ran once, because Murph
  drains its own in-flight tool before closing and App Server aborts a finished
  turn's pending server requests. `true` keeps the upstream Stable default and
  stops interrupted cells; the shell-cell termination itself is upstream-proven,
  not re-proven here.
- One Murph defect was proven before fixing: when a steer preempted an
  unfinished answer and the steered reply had no text (empty or media-only), the
  unfinished deltas became Murph's final reply text. The fix drops never-completed
  assistant streams at the steered user-message boundary in the existing event
  owner. No-reply already suppressed the text.
- Base reconciliation: preserved the handed-off tree as `2fa75e28`, then one
  ordinary merge of `origin/main` `1046d9e9` (`27a97a08`). The only conflict was
  the native patch: main's PR #4147 `--ignore-user-config` hunks were ported onto
  pristine `rust-v0.163.0`; two `lib.rs` hunks were adapted by hand, and the
  `Cargo.toml`/`Cargo.lock` keyring hunks were dropped because 0.163.0 already
  declares that dev-dependency. The regenerated patch reproduces the ported tree
  exactly on the pristine tag.
- Changelog: member-visible improvement; an entry is still required before the
  PR is marked Ready.

### Evidence at this checkpoint

- `verify:codex-upstream-source` passed on the merged tree (tag, commit, patch
  applicability, 13 reviewed source paths). Installed helper is 0.163.0.
- Mocked runtime suites with updated launch-arg expectations passed (281 tests),
  including the default/precedence owner test.
- New real-binary (npm 0.163.0) regressions passed. SSE: preemption drops the
  stale stream and delivers only the steered reply; the explicit-disable baseline
  restores queued delivery; rapid successive steers produce one reply with two
  dropped streams; empty, media-only, and no-reply replacements carry no stale
  text (the empty and media-only cases failed before the fix); a steer passes a
  slow in-flight nested tool with one effect; `code_mode_interrupt` true/false
  never carries a cell tool into the next turn. WebSocket: the binary sends
  `response.interrupt`/`discard_partial_items`; a discarding provider yields only
  the steered reply and an ignoring provider falls back to the queued result.
- Cloudflare egress/image parity passed (22 tests) and assistant-engine
  typecheck passed after edits.
- The documented CLI-upgrade matrix plus steering, journal, and live-input
  suites (16 files) passed on rebuilt runtime artifacts: 734 passed, 30 opt-in
  skips. A first run had two list-limit failures caused only by pre-merge CLI
  `dist`; `pnpm build:test-runtime:prepared` fixed them without source changes.
  Hosted runtime Codex-config/turn-input suites passed (104). The opt-in shared
  schema first-input measurement passed for all four cases on the merged tree.
- Main advanced to `de9a56bf` (#4187, #4190: friction sync and runner-container
  startup context); a second ordinary merge was clean (`40b9c828`). On that head
  the patch verifier, doc gardening/drift, Cloudflare parity and runner-container
  suites (323), and the 17 targeted steering/transport tests passed.
- Focused live journey `instant steer: correction mid-answer replaces the stale
  reply` (`pnpm test:assistant:live -- --test 'instant steer: correction
  mid-answer'`, gpt-6.1-sol, local subscription, no tools): the steer was sent
  while the answer streamed, zero stale segments, one corrected swimming reply.
  Reply review: Ready. A stochastic pass for this model and run only.
- Not yet proven: native compilation and tests of the regenerated patch (no local
  Rust toolchain; the local container runtime is stopped and was not started),
  patched-binary runs of the new WebSocket cases, native AMD64 runner
  image/permission smoke, hosted-local scenarios, the changelog entry, ReviewGPT,
  and exact-head CI. Hold.
