# GPT-Live voice on the website

Status: active
Created: 2026-09-20
Updated: 2026-09-21

## Goal

- Let an authenticated member talk to Murph on the website through native Codex voice, with the existing engine retaining sole process, tool, and runtime ownership. The selected path is a minimal Codex compatibility patch for the public GPT-Live API, preserving native transcript and delegation handling.

## Success criteria

- Prove the selected provider path and hosted ownership before building product integration.
- Reuse Codex conversation, tools, steering, and result routing; prefer native transcript/delegation handling when supported and remove redundant host assumptions where proof supports deletion.
- Preserve authenticated member scope, accepted-work durability, canonical writes, cancellation, and usage settlement.
- Verify microphone-to-speaker behavior, successive turns, correction, tool calls, disconnect, and runtime shutdown. Report provider or deployment gaps honestly.
- Ship the patched CLI through the existing runner base-image workflow. Pin the public upstream revision and patch, preserve the matching sandbox resources, and include all build inputs in the image fingerprint. Local hosted development and deployment must consume the same package; no manual binary replacement or second release service.

## Scope

- In scope: pinned-binary compatibility probe; a deletion-first engine change; authenticated website media/control integration; narrow provider routes; focused proof and ReviewGPT review.
- Out of scope: a separate voice agent/sideband coordinator, a general voice framework, new task queues, automatic reconnection orchestration outside Codex, and unrelated cleanup.

## Constraints

- After comparing maintenance tradeoffs, the user selected a minimal Codex patch to use the public API with an already-entitled project key. Preserve native voice owners rather than building a Murph voice adapter. Keep the patch narrow and reproducible; do not adopt the unproven admission handshake. Publishing artifacts and production deployment remain separate from local implementation and PR verification.
- Provider secrets remain at the existing boundary. Development tests use synthetic inputs; production credentials are unavailable locally.
- One existing runtime owner admits effects. Voice does not authorize sending output to another channel.
- Build the smallest coherent interaction; use existing browser media primitives and design components.

## Risks and mitigations

1. Native V3 has a different wire contract from public Live. Prove the actual pinned binary against a synthetic provider, then check development project access before committing to product architecture.
2. Native handoffs can start backing turns internally. Prove host event/tool binding and accepted-input ownership before admitting writes.
3. Native voice lifecycle and usage may lack host evidence. Inspect and test these boundaries; do not add a second sideband as a workaround.

## Tasks

1. Inspect native source, runtime boundaries, and existing browser integration; ask ReviewGPT for a concrete deletion-first integration recommendation.
2. Run the pinned native V3 protocol probe with synthetic credentials and events; separately establish authorized development API compatibility.
3. Collapse the smallest proven engine boundary, retaining a single event/tool/process owner.
4. Integrate authenticated browser voice and exact provider routes, with product output and usage at existing boundaries.
5. Run focused tests/typecheck, native and rendered proof, review complexity, and complete scoped commit/PR/review and authorized release work.

## Decisions

- Keep the existing Codex 0.153.4 release (`3d2ee51ca2d5db578f328aa75e20aa22c0197c9a`) and matching bundled helpers. The main-based prototype proved public compatibility; its patch is backported to the release to avoid adopting unrelated upstream changes. Build only the patched CLI in the existing runner base image. The Dockerfile and native patch jointly identify the cache input.
- Earlier ReviewGPT advice led to local upstream experiments. Published-only reassessment withdrew the claim that a custom native admission handshake is necessary. Local native patches remain research, not a product dependency. The subsequent tradeoff discussion selected a minimal native public-API compatibility patch; implementation has resumed with the two tested shutdown fixes and without the admission experiment.
- No implementation is justified solely by a feature flag existing; compatibility and host ownership are the first proof gates.

## Verification

- Pinned-binary local provider probe: verify exact RPC, HTTP, and sideband event shapes without provider calls.
- Passed the pinned 0.153.4 native V3 compatibility test: one WebRTC create, one native sideband, two successive backing turns, two tool calls on the same thread, native result forwarding, and explicit stop. No host `turn/start` requests or live provider calls were used.
- `pnpm --dir packages/assistant-engine exec vitest run --config vitest.config.ts test/assistant-codex-native-voice.test.ts --no-coverage`: passed.
- `pnpm --dir packages/assistant-engine typecheck`: passed.
- The initial authorized local/development credential returned HTTP 401 with `account_deactivated`. The replacement root development key is active; no credential values were recorded or copied.
- The replacement key passed a public GPT-Live session probe: `POST /v1/live/sessions` returned 201, WebRTC connected, and `session.closed` reported `close_requested` with final `usage.seconds` of 15. The key stayed in the server process. This was silent connectivity evidence, not native tools or hosted deployment proof. Current native V3 instead posts multipart to `/v1/live` and received 403 with either its default model or explicit `gpt-live-1`. The [public WebRTC contract](https://developers.openai.com/api/docs/guides/voice-webrtc?api=live) differs; the explored public API-key path has a demonstrated compatibility gap, but this does not establish that Murph needs a fork. A fresh upstream fetch through `bb054a2b03` contained no such transport change.
- Native subscription access is proven: after pre-provider authorization failures on earlier profiles, an already-authenticated local Codex profile received the V3 SDP answer and reached browser WebRTC `connected`. The probe received the native closed notification, then closed its own browser peer. This silent synthetic probe ran zero backing turns and sent no microphone audio. It does not prove hosted API-key access, audio quality, provider-resource closure, or usage settlement.
- A synthetic spoken request subsequently completed the full native path: browser audio input, one backing turn, one successful read-only dynamic tool, the correct backend answer, and the matching spoken answer with received audio. The provider owns all delegation and result forwarding. Earlier exploratory samples acknowledged the request or reported lookup failure, so this is compatibility evidence rather than production UX acceptance.
- A host-finalized output probe also passed: `clientManagedHandoffs: true` retained native backing-turn/tool ownership and suppressed automatic result forwarding; after a successful synthetic tool, the host sent its selected result via `thread/realtime/appendText` with assistant role, and the browser received the correct spoken answer. This is a candidate seam for the existing Murph presentation owner, with no second sideband. Successive turns, cancellation, and stale-result association still need composed production-owner proof.
- The live browser channel emitted `session.usage.updated` with `audio_duration_ms`; the inspected native V3 parser does not expose that event to the host. Browser-reported usage cannot become billing authority. Native host usage evidence remains a release gap.
- Native stop does not close the live provider resource in the tested pin: after `thread/realtime/closed`, a fresh synthetic audio input still produced provider `input_transcript.added` and `turn.created` events. No backing turn or tool ran after stop. Current upstream sideband teardown drops the connection, while the existing writer `close()` sends `session.close` but is not called by that teardown. Fix and verify native provider shutdown and final usage together before treating runtime revocation as complete.
- A local upstream candidate on `fix/live-owned-session-shutdown` now calls the existing close operation for sessions Codex created. Its app-server regression first failed for the missing provider message and then passed. A real connected-session probe received `session.closed` and accepted no subsequent synthetic audio. That first candidate did not fix the independently reproduced immediate-stop race while the native sideband was still connecting and was not a Murph dependency upgrade.
- The upstream candidate is committed as `f81044280b`. All 201 focused realtime tests across `codex-core` and `codex-app-server` passed; two app-server cases needed an initialization-timeout retry. Rust formatting and diff checks passed. Full-workspace testing remains pending the confirmation explicitly required by upstream `AGENTS.md`.
- The early-stop native candidate is committed as `5f553892b8`: the existing sideband owner finishes an in-flight join only long enough to close its owned Live session, with a five-second bound and an unconfirmed-shutdown error on failure. The regression failed for the missing provider close request before the fix. Fourteen focused shutdown/reconnect/tail checks then passed; one case retried after an initialization timeout. `just fmt` and diff checks passed. A real synthetic early-stop probe received provider `session.closed`, accepted no post-stop audio, and ran zero backing turns/tools. This remains local upstream code, not the Murph pin or final usage settlement.
- The native provider's `session.closed` frame includes final `usage.audio_duration_ms` and `usage.backend_model_usage`. A short synthetic connected-close probe observed zero audio duration. The native parser currently discards this frame, and the existing writer closes its WebSocket immediately after requesting session closure. A host usage contract must preserve the provider's final receipt; browser observations are compatibility evidence only.
- A synthetic event-order probe observed a backing provider request before the host received that turn's completed user-message notification. Notifications alone do not establish pre-provider durability. ReviewGPT initially recommended a native, awaited pre-input admission request, but withdrew its necessity claim on reassessment. Event ordering proves the race, not that modifying Codex is the only solution. The existing command-based UserPromptSubmit hook is insufficient: failures and invalid responses can continue processing, and it lacks a stable per-input identity.
- The owner reduction passed 261 focused tests across process, recovery, tools, steering, turns, events, and subagent usage, plus the assistant-engine typecheck. Production source is reduced by 36 lines; measured complexity debt falls from 201 to 193. Same-batch RPC/tool identity, account response policy, compaction ordering, and tool draining have explicit regression coverage.
- Focused engine, hosted runtime, Worker, and Web tests plus relevant typechecks as implementation scope becomes concrete.
- Passed `pnpm test:assistant:live -- --test "real model canonical meal persists across assistant restart"` on the previously verified local subscription profile with `gpt-5.6-terra`: two provider turns, one canonical meal save, then correct readback after assistant restart and vault restore. Reviewed both synthetic replies: Ready for this preserved text journey. Website voice remains Hold.
- ReviewGPT review of the complete stable candidate; provider and deployment evidence remain separate completion requirements.

## Current prerequisites

- Establish the public API-key path through the selected minimal native Codex patch. Development public API access and local subscription-backed native voice are proven separately. Neither proves the composed hosted path. Published 0.155.1 is available; its release source still uses the same multipart Live endpoint, so an upgrade alone does not resolve that observed mismatch.
- Native admission experiments are set aside as research, not a shipping prerequisite. The local candidate passed 20 focused checks, then 547 native/protocol checks (one initially lacked the CLI binary and passed after building it), 163 TUI/request checks, the CLI build, scoped Clippy, and formatting. Stable/experimental schema generation passed using Python 3.12 after the installed generator rejected Python 3.14. These proofs establish the candidate behavior, not the necessity of changing Codex or a completed Murph integration.
- Adopt shutdown and trusted cumulative usage only with the verified public compatibility patch. Its provider receipt is host evidence; website usage settlement still needs the existing billing owner. Do not introduce a second sideband or billing authority.
- ReviewGPT's source-grounded assessments are captured and verified against their accepted prompts and GPT-6 Pro responses. Its revised recommendation is a bounded public Live proof within existing owners, using published Codex unchanged; no custom native admission requirement is established. The returned owner reduction is applied: RPC response resolution has one process owner, synchronous response observers preserve same-batch ordering, and stored running occupancy is removed. Reservation remains necessary until callbacks exist. Website integration and final PR review remain incomplete.
- Public native compatibility is proven on the prototype: two successive synthetic spoken requests each produced a distinct native turn, a successful read-only dynamic tool, the matching spoken answer, received audio, and provider-confirmed closure with trusted final cumulative seconds. Host-managed speech also passed. The initial tool failure was a missing matching Code Mode helper in the standalone build; packaging the existing helper fixed it. The direct API proof uses no host `turn/start` or second sideband.
- The release backport passes all 215 selected native realtime tests across API, core, and app-server after correcting the public fixture to explicitly enable the release voice feature. Three initialization-timeout cases needed the existing retry; no failing selected case remains. Scoped Clippy and formatting pass. The complete CLI builds with pinned Rust 1.95.0. Both native and host-managed synthetic browser speech pass against that packaged release: two backing turns and read-only tools, matching audible answers, provider-confirmed closure, and trusted final cumulative usage. The first direct native run timed out after one successful tool; its rerun passed, so this is compatibility evidence, not a reliability-rate claim.
- The existing runner base-image recipe now compiles the checksum-pinned release plus checked-in patch and preserves that release's npm-distributed helpers/resources. Patch changes invalidate the source fingerprint. Docker configuration validation, the real Linux npm-helper packaging stage, 21 packaging tests, 11 provider conformance tests, the stock native compatibility test, and Cloudflare/engine typechecks pass. Source verification checks the upstream release commit/tree and applies the exact native patch. Complexity debt remains reduced by eight. Native Linux CLI compilation, exact-image compatibility/sandbox proof, and deployment remain pending.
- Authenticated website integration, accepted-work durability, hosted usage settlement, and final PR review remain incomplete. The draft PR is not a deploy-ready feature.
- Deployment audit found that the protected Murph Cloud workflow forces a source build in separate fresh-runner smoke and deploy jobs, without persistent Docker caching. The native patch must not turn each deploy into a cold Rust build. Complete trusted BuildKit caching in that existing workflow and prove cold/warm behavior before claiming easy deployment. Do not replace its source-build authority with an unverified image-label check.
- [Deployment companion PR #166](https://github.com/cobuildwithus/murph-cloud/pull/166) adds the pinned Blacksmith Docker builder to those two protected jobs with one shared cache key. Forced source builds remain authoritative, and cache misses rebuild normally. Its 131 deployment-controller tests, production build, and 10 built-worker tests pass; an initial replay-suite failure passed its six-test focused retry. Exact-head CI and both required private review gates are running. No deployment or cache timing proof has occurred.

## Published-only investigation outcome

- [OpenAI's official integration example](https://openai.com/index/introducing-gpt-live-1-in-the-api/) connects public Live client delegation to published Codex. It omits connection and delegation handling. Adapting this pattern to Murph's existing app-server path is a candidate, not completed integration proof.
- The smallest candidate keeps browser media separate from the existing runtime's trusted Live attachment, admits requests through the existing durable mailbox, and returns selected results through the existing presentation owner. Client delegation requires bounded transcript context and delegation correlation; it does not supply a complete task prompt.
- Concrete work remains: authenticated admission, scoped provider WebSocket transport, voice lifetime between turns, cumulative voice usage accounting, and result targeting. Multiple steered callers can share one final result, so independently speaking each resolved promise would duplicate or misroute output.
- ReviewGPT recommends proving those boundaries on the actual hosted runner before committing to a full adapter. Waiting for native support could remove transcript/delegation glue, but would still require website auth, runtime lifetime, and billing integration. This historical assessment preceded the user's choice of the minimal native compatibility patch; it does not authorize another task/recovery owner.

- Selected direction after discussion: native compatibility patch. The public adapter remains a comparison, not the implementation plan. Prove the patch and its distribution before changing Murph's dependency or admitting website voice work.
