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
- Live provider access is unresolved: the authorized local/development credential returned HTTP 401 with `account_deactivated` on the bounded model-access check. An active development credential is needed; no credential values were recorded.
- Native subscription access is proven: after pre-provider authorization failures on earlier profiles, an already-authenticated local Codex profile received the V3 SDP answer, reached browser WebRTC `connected`, and stopped cleanly. This silent synthetic probe ran zero backing turns and sent no microphone audio. It does not prove hosted API-key access, audio quality, or usage settlement.
- A synthetic spoken request subsequently completed the full native path: browser audio input, one backing turn, one successful read-only dynamic tool, the correct backend answer, and the matching spoken answer with received audio. The provider owns all delegation and result forwarding. Earlier exploratory samples acknowledged the request or reported lookup failure, so this is compatibility evidence rather than production UX acceptance.
- The live browser channel emitted `session.usage.updated` with `audio_duration_ms`; the inspected native V3 parser does not expose that event to the host. Browser-reported usage cannot become billing authority. Native host usage evidence remains a release gap.
- Focused engine, hosted runtime, Worker, and Web tests plus relevant typechecks as implementation scope becomes concrete.
- Focused real-Codex journey and browser audio proof after deterministic boundaries pass.
- ReviewGPT review of the complete stable candidate; provider and deployment evidence remain separate completion requirements.
