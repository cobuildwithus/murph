# Native Codex voice on the website

Status: active
Created: 2026-09-20
Updated: 2026-09-20

## Goal

- Let an authenticated member talk to Murph on the website through native Codex V3 voice, with the existing engine retaining sole process, tool, and runtime ownership.

## Success criteria

- Prove native provider compatibility before building product integration.
- Reuse Codex conversation, transcript, delegation, steering, and result routing; remove redundant host assumptions where the proof supports deletion.
- Preserve authenticated member scope, accepted-work durability, canonical writes, cancellation, and usage settlement.
- Verify microphone-to-speaker behavior, successive native turns, correction, tool calls, disconnect, and runtime shutdown. Report provider or deployment gaps honestly.

## Scope

- In scope: pinned-binary compatibility probe; a deletion-first engine change; authenticated website media/control integration; narrow provider routes; focused proof and ReviewGPT review.
- Out of scope: a separate voice agent/sideband coordinator, a general voice framework, new task queues, automatic reconnection orchestration outside Codex, and unrelated cleanup.

## Constraints

- Native Codex is the preferred voice owner. Change or upgrade it only for a demonstrated missing capability.
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

- Start on Codex 0.153.4. Explicitly select V3 and audio. Native WebRTC defaults do not prove GPT-Live compatibility.
- ReviewGPT recommends native voice first, an upstream transport change second, and waiting before a permanent custom bridge.
- No implementation is justified solely by a feature flag existing; compatibility and host ownership are the first proof gates.

## Verification

- Pinned-binary local provider probe: verify exact RPC, HTTP, and sideband event shapes without provider calls.
- Passed the pinned 0.153.4 native V3 compatibility test: one WebRTC create, one native sideband, two successive backing turns, two tool calls on the same thread, native result forwarding, and explicit stop. No host `turn/start` requests or live provider calls were used.
- `pnpm --dir packages/assistant-engine exec vitest run --config vitest.config.ts test/assistant-codex-native-voice.test.ts --no-coverage`: passed.
- `pnpm --dir packages/assistant-engine typecheck`: passed.
- The initial authorized local/development credential returned HTTP 401 with `account_deactivated`. The replacement root development key is active; no credential values were recorded or copied.
- The replacement key passed a public GPT-Live session probe: `POST /v1/live/sessions` returned 201, WebRTC connected, and `session.closed` reported `close_requested` with final `usage.seconds` of 15. The key stayed in the server process. This was silent connectivity evidence, not native tools or hosted deployment proof. Current native V3 instead posts multipart to `/v1/live` and received 403 with either its default model or explicit `gpt-live-1`. The [public WebRTC contract](https://developers.openai.com/api/docs/guides/voice-webrtc?api=live) differs; native public-protocol support is now a demonstrated requirement. A fresh upstream fetch through `bb054a2b03` contained no such transport change.
- Native subscription access is proven: after pre-provider authorization failures on earlier profiles, an already-authenticated local Codex profile received the V3 SDP answer and reached browser WebRTC `connected`. The probe received the native closed notification, then closed its own browser peer. This silent synthetic probe ran zero backing turns and sent no microphone audio. It does not prove hosted API-key access, audio quality, provider-resource closure, or usage settlement.
- A synthetic spoken request subsequently completed the full native path: browser audio input, one backing turn, one successful read-only dynamic tool, the correct backend answer, and the matching spoken answer with received audio. The provider owns all delegation and result forwarding. Earlier exploratory samples acknowledged the request or reported lookup failure, so this is compatibility evidence rather than production UX acceptance.
- A host-finalized output probe also passed: `clientManagedHandoffs: true` retained native backing-turn/tool ownership and suppressed automatic result forwarding; after a successful synthetic tool, the host sent its selected result via `thread/realtime/appendText` with assistant role, and the browser received the correct spoken answer. This is a candidate seam for the existing Murph presentation owner, with no second sideband. Successive turns, cancellation, and stale-result association still need composed production-owner proof.
- The live browser channel emitted `session.usage.updated` with `audio_duration_ms`; the inspected native V3 parser does not expose that event to the host. Browser-reported usage cannot become billing authority. Native host usage evidence remains a release gap.
- Native stop does not close the live provider resource in the tested pin: after `thread/realtime/closed`, a fresh synthetic audio input still produced provider `input_transcript.added` and `turn.created` events. No backing turn or tool ran after stop. Current upstream sideband teardown drops the connection, while the existing writer `close()` sends `session.close` but is not called by that teardown. Fix and verify native provider shutdown and final usage together before treating runtime revocation as complete.
- A local upstream candidate on `fix/live-owned-session-shutdown` now calls the existing close operation for sessions Codex created. Its app-server regression first failed for the missing provider message and then passed. A real connected-session probe received `session.closed` and accepted no subsequent synthetic audio. That first candidate did not fix the independently reproduced immediate-stop race while the native sideband was still connecting and was not a Murph dependency upgrade.
- The upstream candidate is committed as `f81044280b`. All 201 focused realtime tests across `codex-core` and `codex-app-server` passed; two app-server cases needed an initialization-timeout retry. Rust formatting and diff checks passed. Full-workspace testing remains pending the confirmation explicitly required by upstream `AGENTS.md`.
- The early-stop native candidate is committed as `5f553892b8`: the existing sideband owner finishes an in-flight join only long enough to close its owned Live session, with a five-second bound and an unconfirmed-shutdown error on failure. The regression failed for the missing provider close request before the fix. Fourteen focused shutdown/reconnect/tail checks then passed; one case retried after an initialization timeout. `just fmt` and diff checks passed. A real synthetic early-stop probe received provider `session.closed`, accepted no post-stop audio, and ran zero backing turns/tools. This remains local upstream code, not the Murph pin or final usage settlement.
- The native provider's `session.closed` frame includes final `usage.audio_duration_ms` and `usage.backend_model_usage`. A short synthetic connected-close probe observed zero audio duration. The native parser currently discards this frame, and the existing writer closes its WebSocket immediately after requesting session closure. A host usage contract must preserve the provider's final receipt; browser observations are compatibility evidence only.
- A synthetic event-order probe observed a backing provider request before the host received that turn's completed user-message notification. Notifications alone do not establish pre-provider durability. ReviewGPT recommends a native, awaited pre-input admission request before start-or-steer, reusing native input identity and Murph's existing durable source and acceptance owners. The existing command-based UserPromptSubmit hook is insufficient: failures and invalid responses can continue processing, and it lacks a stable per-input identity.
- The owner reduction passed 261 focused tests across process, recovery, tools, steering, turns, events, and subagent usage, plus the assistant-engine typecheck. Production source is reduced by 36 lines; measured complexity debt falls from 201 to 193. Same-batch RPC/tool identity, account response policy, compaction ordering, and tool draining have explicit regression coverage.
- Focused engine, hosted runtime, Worker, and Web tests plus relevant typechecks as implementation scope becomes concrete.
- Passed `pnpm test:assistant:live -- --test "real model canonical meal persists across assistant restart"` on the previously verified local subscription profile with `gpt-5.6-terra`: two provider turns, one canonical meal save, then correct readback after assistant restart and vault restore. Reviewed both synthetic replies: Ready for this preserved text journey. Website voice remains Hold.
- ReviewGPT review of the complete stable candidate; provider and deployment evidence remain separate completion requirements.

## Current prerequisites

- Development API access is proven with the replacement key. Native public-protocol compatibility is still required; private Codex subscription success and direct public connectivity do not prove the composed hosted path.
- ReviewGPT's native admission candidate is applied locally in the separate Codex checkout. Twenty focused admission and early-stop checks passed after correcting test fixtures, with one initialization timeout passing on retry. Coverage includes no provider/tool work before acceptance, strict rejection, start-or-steer identity, timeout, disconnect, stale responses, stop/replacement, and transcript-tail provenance. Protocol generation and broader native verification remain pending; this candidate is not yet a Murph dependency or durable journal integration.
- Native cleanup during connection setup now has a locally verified candidate. Adoption of a native release and trusted final usage forwarding remain unresolved; prefer native support over a second Murph sideband or billing authority.
- ReviewGPT's source-grounded design is captured and verified against the accepted prompt and GPT-6 Pro response. It recommends one existing engine interaction owner, central RPC response handling, native admission before execution, and existing Murph presentation and usage owners. The returned owner reduction is applied: RPC response resolution has one process owner, synchronous response observers preserve same-batch ordering, and stored running occupancy is removed. Reservation remains necessary until callbacks exist. Website integration and final PR review remain incomplete.
- Website integration and deployment have not been performed. Keep this plan active until the native prerequisites and composed engine authorization proof support the product implementation.
