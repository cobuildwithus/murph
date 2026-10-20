# Upgrade Codex CLI to 0.163.0 with default instant steering

Status: completed
Release decision: Ready for PR review — candidate proof complete; merge and rollout remain separately gated
Created: 2026-10-16
Updated: 2026-10-19

The final completion receipt below supersedes earlier dated Hold decisions.

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

### Candidate review and refreshed evidence

- Minimality review: completed-stream tracking stays the owner fix. Clearing all
  streams at the boundary would also drop completed non-final assistant text that
  existing fallback can use, so only never-completed items are removed. The two
  loops moved into named closures beside the existing fallback helper; `pnpm
  complexity:diff` now passes with `assistant-codex.ts` debt unchanged (181).
- Test trimming: the no-reply code-mode test sends no interrupt, so it is one
  default-config case, and the normal-completion lifetime variants collapsed to
  one default case; debug-only provider diagnostics were removed. The remaining
  four cases still pass.
- The permission-sandbox lane now also runs the SSE preemption, explicit-disable,
  and empty-reply cases against the extracted patched binary, because the native
  patch changes config loading and the Responses WebSocket client. Workflow
  guards (image contract 11, PR CI policy 25) pass.
- Complete first provider input, merged head source, identical synthetic
  fixtures, stock 0.160.0 versus 0.163.0 binaries, only `prompt_cache_key`
  excluded, no exact tokenizer available: direct native 163,815 -> 163,846
  (+31, +0.02%); direct code-only 156,347 -> 159,769 (+3,422, +2.19%); group
  native 144,638 -> 144,669 (+31, +0.02%); group code-only 133,303 -> 136,725
  (+3,422, +2.57%). Murph's own change adds no provider-visible content.
- The pinned codeload tarball for `83086188` matches the Dockerfile checksum.
- Main advanced to `dafcaf45` (#4180, web only); third ordinary merge was clean.
- Hosted-local: public PR CI is fixture-only by design, and no authorized
  pre-merge path runs real hosted-local scenarios on this image without local
  Docker. Protected `release_admission` runs the five production-core lanes on
  merged main before production; media/tool delivery and prompt-cache scenarios
  are not part of that set.

### PR #4194 checkpoint

- Draft PR #4194 opened from this branch. The first ReviewGPT launch on
  `927c2a79` was invalid before send: native review packaging still required
  upstream root `AGENTS.md`, which `rust-v0.163.0` deleted (upstream #49713).
  That owner was removed; a real-pin dry run packaged 69 patched upstream files.
- Local acceptance surfaced one argv-shape assertion in
  `packages/cli/test/assistant-codex.test.ts` that the steering defaults changed;
  it now pins the exact steering and timing prefix. A second run failed once in
  the hosted workspace runner wake-interrupt test, which then passed five
  isolated runs; the root cause is not established (load is a hypothesis, and an
  interaction is not excluded), and it is recorded through Frog without a
  production fix. The third `MURPH_VERIFY_EXECUTOR=local pnpm verify:acceptance`
  run on `73d86bfa` exited 0.
- The six documented CLI-upgrade live journeys passed on `73d86bfa` with Ready
  reply and effect review: nine-item native and code-only lists with no card and
  no invalid calls; one compact-table card for both comparison modes; one
  generation and one attachment with a truthful 300-second statement for Sol
  code-only and Luna mixed songs.
- Main advanced to `6fb79bfc` (#4191 completion admission, #4196 supplement
  labels); fourth ordinary merge was clean. On the merged head: typecheck, doc
  gardening, complexity (debt unchanged), Cloudflare runner/entrypoint/image/
  egress suites (479), targeted steering tests (15), and the patch verifier pass.
- The changelog fragment moved to the 2026-10-19 edition: it ships after
  #4191's same-day entry, whose "handled as before" detail stays true for its
  date.
- ReviewGPT round 1 (gpt-6-pro, full snapshot of `4c289edb`) returned one
  Complexity Collapse finding, accepted: the completed-stream tracking was
  unnecessary because every completed non-commentary reply already moves to the
  trailing candidate before the boundary clear, and suppressed contexts never
  record streams. The fallback fix is now the existing clear moved outside its
  conditional. The empty and media-only regressions fail with the old placement
  and pass with the new; mocked runtime suites (282) and targeted real-binary
  cases (14) pass, with complexity debt unchanged.

### Exact-head CI checkpoint at `c7e4d65d`

- Release Cloudflare verification failed the installed-binary route inventory
  on `/v1/decisionsanswerschoicemodelquestionsvalueinstructionsvariant` (same as
  the earlier head). Diagnosis on the exact lockfile-verified 0.163.0 Linux x64
  helper: the binary stores the `https://api.openai.com/v1/decisions` constant
  from `ext/guardian-v2/src/async_scorer/decisions.rs` beside that request and
  response's serialized `answers`, `choice`, `model`, `questions`, `value`,
  `instructions`, and `variant` labels, and the scanner stops at the following
  serde variant-index text. It is classified as one exact-token
  `binary_false_positive`, like the existing macOS form; the real Decisions route
  stays blocked and the scanner is unchanged. Rescanning that Linux binary leaves
  zero unclassified candidates, and the local conformance suite passes.
- Serialized positive proof on the final engine source (no concurrent edits,
  engine source equal to `c7e4d65d` before and after): mocked runtime suites 282
  passed (01:41:18Z-01:41:52Z), then the real-binary steering and preservation
  cases 14 passed (01:41:58Z-01:42:43Z), including unfinished empty, media-only,
  and no-reply replacements, the explicit-disable completed-answer baseline, and
  WebSocket discard and ignore.
- Host Support run `39184625416` on `c7e4d65d`: besides the route inventory
  (fixed in `4a1420aa`), job `117844621409` "Production runner bundle budget"
  ended with "The operation was canceled." at 01:56:44Z, before any one-vCPU
  latency sample. The candidate's `codex0.163.0-live1` base tag is unpublished,
  so the step compiled patched Codex from source; that compile had reached the
  final crates (`codex-exec` at 01:40:42Z) when `ELIFECYCLE`, Docker
  `context canceled`, and the step cancellation followed at 01:56:40-42Z, 33m18s
  into the 90-minute base-build timeout and far inside the 195-minute step
  limit. No script, Docker, or job timeout explains it, the run itself was not
  cancelled, and the check annotation names no cause. Historical from-source
  base builds take 31-47 minutes. Root cause is not established; resource
  exhaustion on this heavier two-checkout job is an unproven hypothesis. No
  code or budget change was made; the next exact-head run re-executes it.
- Cloudflare Runner Permission Sandbox run `39184625389` on `c7e4d65d` ended
  FAILURE. The patched-image compile passed, native voice and WebSocket cases
  passed 13/13, and native SSE steering cases passed 3/3. Native egress passed
  27 and failed 1 on the same
  `/v1/decisionsanswerschoicemodelquestionsvalueinstructionsvariant` token,
  which `4a1420aa` classifies. The permission and confinement smoke was skipped
  after that failure, so it has not passed and remains required proof.

### Base reconciliation at `52ad1721`

- Exact remote `main` refreshed by explicit refspec is `df2e9ec4` (#4197),
  matching `ls-remote`. `git merge-tree --write-tree` against it is clean, and
  the only file both sides touch is `agent-docs/index.md`. #4197's
  persisted-event Web reader floor lives in files this branch does not change,
  so no base merge is needed and that floor is untouched; pull-request CI also
  tests the merge ref.
- ReviewGPT round 2 PASS at `c7e4d65d` still covers the reviewed source: later
  commits change only the egress fixture and this plan.

### Hold

Still unexecuted required proof keeps this plan active:

- the native permission and confinement smoke;
- a one-vCPU runner-bundle latency comparison that reaches its samples;
- hosted-local scenarios on the current image: gateway and prompt cache, vault
  persistence, media and tool delivery, and steering through the image.

Those scenarios have no execution owner here. Private Murph Cloud's
`Public Murph Integration` would need a private PR that pins this exact public
source, and local `pnpm hosted-local e2e` would need an owned Docker runtime.
Neither is available or authorized in this task. Protected
`release_admission` runs only on `main` and does not cover these four
scenarios. The gap is missing execution capability, not a proven missing test.

### Ownership handback and hosted proof, 2026-10-19

The user explicitly handed completion of PR #4194 back to this chat. The
preceding Hold records an earlier checkpoint and is superseded by this section.
No merge or rollout is authorized by this handback; preserve the separate
release coordinator's reservation and all production admission gates.

- Reconciled clean local and remote head `6273ed253a8ba118fc4cda44f89ae97c16613529`.
  Current main retains Codex 0.160.0; latest stable remains 0.163.0.
- Exact-head native Runner permission sandbox run `39189084344` passed,
  including patched-image compilation, extracted-binary tests, egress, and
  permission/confinement smoke. Host Support run `39189084341` passed, including
  the one-vCPU bundle comparison with actual samples. PR evidence run
  `39189077380` passed. These resolve the first two preceding Hold items.
- Existing private diagnostic PR #192 supplies a reviewed, non-main,
  no-production-credential candidate lane. Its run `39195739584` selected exact
  public head `6273ed25`, built the actual image, passed gateway/prompt-cache
  (one test) and image/media delivery (three tests), then failed lost-active-
  operation steering. No duplicate private branch or implementation is needed.
- Failure cause: the test holds a provider response *before* Codex receives
  its tool call, but then requires that stale tool to run after steering.
  The default instant interrupt intentionally preempts this response. The
  test now requires the corrected provider request while the stale response is
  still held, rejects its tool from subsequent input, and preserves exact
  single delivery, mailbox progress, durable fence clearance, and fresh wake.
  This is test alignment to the already-reviewed behavior, not a runtime fix.
- The existing vault-persistence scenario previously skipped without a live
  provider key. It now additionally supports the stub profile, scripting only
  the provider while the candidate binary executes the real shell write and
  the original encrypted-checkpoint/restart assertions remain intact. It also
  requires exactly one synthetic reply. Live mode remains available and fails
  on missing credentials. No auth material is copied or read.
- After both test edits, Cloudflare typecheck, provider-support tests (39),
  real-binary instant-steer/explicit-disable controls (2), complexity, doc
  gardening, and doc drift all passed. Native
  hosted-local execution of the corrected steering, vault persistence, replies,
  and scheduled reminders remains required before Ready. ReviewGPT round 2
  remains the production-source review; these isolated proof changes follow
  the review-loop exemption and require their own verification and exact-head CI.

### Resumed verification receipts on `a89bd548`

- Native Runner permission sandbox run `39328838880` passed. The fresh image
  reports Codex 0.163.0; its extracted binary passes native voice/WebSocket
  tests (13), SSE steering cases (3; 137 unrelated filtered skips), egress (28),
  and the actual permission/confinement smoke. This is current-source image
  proof, not merely a source-contract check.
- Refreshed canonical local acceptance initially failed the unchanged reserved-
  voice owner-handoff test's one-second deadline. The owner starts no provider
  and is identical to the base. Three focused file runs (five cases each) and
  full assistant-runtime coverage (3,740 passed, seven skipped) then passed.
  The clean `MURPH_VERIFY_EXECUTOR=local pnpm verify:acceptance` rerun passed
  with exit 0 in 2,445 seconds: workspace typechecks, repo tools (898), all
  package coverage, Web verification (14,094 tests, lint and production build),
  Cloudflare Node/Worker checks (4,405 + 20 + 19 tests), and fixture smoke
  covering 206 scenarios. Existing opt-in skips are unchanged. Root cause of
  the initial timing failure is unproven; no assertion or deadline changed.
- Refreshed remote main `f54875376973da0c36a8eece4bb63ad91edbad96` matches
  `ls-remote` and retains Codex 0.160.0. Merge-tree proof is clean; intervening
  invite-UI and documentation changes do not alter this upgrade's owners.
- Hosted candidate proof `39328858199` attempt 2 failed at the held-response
  fixture boundary described below. Host Support
  `39328838919` diagnostic attempt 3 failed when the hosted runner lost
  communication; its build and diagnostic logs were never uploaded. Attempt 1
  canceled during compilation, and attempt 2 logged `Killed` / exit 137 before
  any latency samples. Resource exhaustion remains unproven.
- The budget job now bounds native compilation to the existing two-job default
  already proven in current-head native permission run `39328838880`. Only the
  CI build parallelism changes. The Dockerfile, patch, image source fingerprint,
  compiler target/profile, one-vCPU measurements, timeouts, and assertions stay
  unchanged. This is a bounded execution mitigation, not a claimed OOM fix.
- Existing latency-comparator and PR-CI policy tests pass (32), and workspace
  typecheck passes after the workflow edit. Parent review confirms the deployed
  source is unchanged; this low-risk build-tooling change does not create a new
  substantive ReviewGPT round under completion eligibility. Round 2 PASS still
  covers the production source. Fresh exact-head CI is required for the new
  setting, and the plan remains active until it and hosted proof are reviewed.

### Hosted response-stream boundary correction

- Candidate proof `39328858199` attempt 2 built and launched the actual patched
  Codex 0.163.0 image. Its first scenario then failed while waiting for instant
  steering; vault persistence, Linq delivery, and reminders did not run.
- Diagnosis is specific to the fixture: its function-call `beforeResponse`
  gate withheld HTTP headers. Verified upstream commit `83086188` in
  `codex-rs/core/src/session/turn.rs` awaits stream creation with full-turn
  cancellation, then applies the instant-steer preemption token inside the
  stream-read loop. The test required an active-stream behavior before that
  stream existed; this is not a newly introduced production regression.
- Preserve the existing header barrier and its assertion. A distinct
  `beforeStreamContent` hook emits `response.created` before holding the tool
  item. The hosted scenario waits for that boundary before steering. Its
  forbidden stale-tool, exact reply, mailbox, fence-clearance, and fresh-wake
  assertions remain unchanged. Architecture guidance now names the existing
  pre-header limit.
- Negative proof: the new wire test fails before the hook implementation
  because the held tool item is delivered. Positive proof: all 40 provider
  support tests pass, including concurrent correction while tool content is
  held and the unchanged header-barrier case. Workspace typecheck passes.
- Real pinned-binary proof passes three focused cases: interruption before a
  held shell tool creates its file (file absent, two provider requests, only
  the corrected reply), ordinary unfinished-SSE preemption, and the explicit
  disable control. There are 138 unrelated filtered cases. Production source
  and image fingerprint are unchanged; hosted execution of the corrected
  fixture and all three unexecuted scenarios remains required.

### Final candidate budget proof on `d8d1d500`

- Host Support run `39345224818` passed every job. The budget used the PR's
  synthetic merge `f2f1f4b183a881c00e188b2a5f2dab2b1c427722` against first
  parent `f54875376973da0c36a8eece4bb63ad91edbad96`. Native compilation with
  two Cargo jobs completed; the complete latency step took 46 minutes.
- All six one-vCPU median comparisons passed the unchanged limits. CPU/wall
  milliseconds, base to candidate: boot 728.652/667 to 739.672/679;
  seed 843.709/828.523 to 835.931/824.075; new-turn 220.371/211.166 to
  227.503/214.703. This proves the bounded compilation mitigation can complete
  and the candidate remains within budget; it does not establish the prior
  runner failures' root cause.
- All four branch-required checks and PR evidence pass on `d8d1d500`.
  Corrected hosted run `39345272648` and native permission run `39345224641`
  are still pending. This plan remains active and the release decision is Hold.

### Final candidate native-image proof on `d8d1d500`

- Native permission run `39345224641` passed on the current PR head. The newly
  compiled image reports `codex-cli 0.163.0`; extracted-binary Live/WebSocket
  tests passed 13, SSE steering passed three (138 unrelated filtered cases),
  and egress passed 28. The actual hosted runner permission/confinement smoke
  passed and independently reported `codex-cli 0.163.0`.
- All public CI is green. Hosted candidate run `39345272648` remains active;
  the corrected steering, vault, reply, and scheduled-reminder results are the
  last task-specific proof gap.

### Hosted steering pass and vault restart storage correction

- Native hosted run `39345272648` built and launched the patched 0.163.0
  image. Lost-active-operation steering passed (one test, 76.79 seconds),
  including corrected-request preemption, forbidden stale tool, exact reply,
  mailbox progress, durable-fence clearance, and a fresh wake.
- Vault persistence reached the post-restart assertion, proving the real binary
  write, initial encrypted snapshot contents, and exact single synthetic reply.
  The post-restart snapshot GET then returned HTTP 404. Delivery and reminders
  did not run because scenario two failed; the whole run is not a pass.
- Proven fixture cause: `persistDirOverride` retained Worker state, but MinIO
  defaulted to the stack's disposable temporary directory. `stack.stop` removed
  that object data. The new stack retained the committed snapshot reference but
  had an empty object store. MinIO/stack/snapshot-inspection source is identical
  to the base. The live-only scenario previously skipped without credentials.
- The fixture now sets the existing `MURPH_DEV_MINIO_DATA_DIR` to a child of its
  retained scenario-owned persistence root. The first start still resets that
  root; restart retains it; final cleanup owns its removal. Production storage,
  encryption, auth, snapshot checks, and exact reply assertions are unchanged.
- MinIO support tests pass 21 and Cloudflare typecheck passes. The failed native
  run is the negative proof; a new native vault/delivery/reminder run remains
  required as positive proof. The unchanged steering test need not be repeated.

## Final completion receipt

- Candidate decision: **Ready for review**, Codex 0.160.0 to 0.163.0. No merge,
  deployment, shared CLI replacement, or release admission is authorized or
  performed. The coordinator's rollout reservation remains separate.
- Final behavioral/proof head `187a57e8dec734eb1199033eca24d58c3001e372` changes
  only the vault fixture's storage lifetime and evidence from `d8d1d500`.
  ReviewGPT round 2 PASS at `c7e4d65d` still covers unchanged production source;
  subsequent isolated proof, docs and compilation parallelism meet the current
  review exemptions. Parent final review found no remaining accepted defect.
- Native hosted candidate `39352471410` passed on exact `187a57e8`, reviewed
  private head `61228ca42f01d3b0232d258a2a1b1a0bedd93142`, release scope none.
  The freshly built image reports `codex-cli 0.163.0`. Vault persistence passed
  its real shell write, exact one synthetic reply, encrypted snapshot readback,
  and full-stack restart/readback (one test). This is the positive proof for the
  preceding 404 failure; no snapshot assertion was removed or relaxed.
- Linq delivery passed 13 tests, including welcome/follow-up, ambiguous rich-link
  acknowledgment, definitive fallback, transport recovery without text replay,
  progress updates, immediate follow-ups, and mailbox quiescence. Four existing
  opt-in cases remain excluded: the real Web-model first-turn lane and three
  dedicated test-control reproduction lanes. These are not required upgrade
  proof; subscription-based real-Codex journeys were independently reviewed.
- Every scheduled-reminder process passed: image/checkpoint-race and usage
  accounting, foreground overlap ordering without duplicate delivery, and native
  nutrition-card delivery. The first process passed three tests including two
  timing/identity helpers; the other two each passed one journey. Cross-process
  filtered cases do not represent missing journeys. Synthetic replies and
  required/forbidden effects were reviewed **Ready**.
- Combined with native steering pass `39345272648` (one case), gateway/prompt-cache
  and media/tool passes `39195739584`, all required hosted surfaces have actual
  candidate-image proof. The earlier failed overall runs remain recorded.
- Current native permission run `39352455071` passed: actual patched binary
  version 0.163.0, Live/WebSocket 13, SSE three (138 unrelated filtered), egress
  28, and actual confinement smoke. Current budget job in `39352455036` passed
  all six unchanged one-vCPU comparisons: CPU/wall milliseconds base to candidate
  boot 1289.964/1216 to 1304.201/1229; seed 1387.976/1388.110 to
  1378.575/1387.972; new-turn 424.001/417.121 to 420.764/415.429.
- Canonical local acceptance, deterministic CLI matrix, first-request payload
  measurements, upstream verification and all focused live journeys retain the
  receipts above. Later proof-only edits passed focused tests, relevant typecheck,
  complexity and documentation guards. No production runtime changed after the
  reviewed and accepted source.
- All four branch-required checks pass on `187a57e8`. The closure commit contains
  documentation only; final-head required CI and the final PR evidence are
  tracked on PR #4194. The plan is closed under the completion workflow before
  that final documentation-head CI, not as a claim of merge or rollout.
- Refreshed main `3eb2eec191e4a58b663773443aaa872ad7235285` matched ls-remote and
  merge-tree proof was clean. Its metric-projection telemetry changes do not
  overlap the upgrade. No redundant base merge was needed.
Completed: 2026-10-19
