# Focused Gemini video analysis with selectable temporal detail

Status: active
Created: 2026-08-26
Updated: 2026-08-26

## Goal

- Preserve the member's exact video question as the Gemini analysis task.
- Let Murph select standard or detailed-motion sampling before the single
  provider call, using 1 or 5 frames per second respectively.
- Use medium thinking for both modes and omit an explicit output-token cap from
  new Gemini requests.
- Keep replies direct, useful, and uncertainty-calibrated without routine
  policy recitals, apology, or medical overreach.

## Product UX Feature

- Outcome: a member can ask about a specific object, brief event, rep phase, or
  visible exercise form and receive an answer using the lightest sampling mode
  suited to that question.
- Entry and promise: an explicit request about a supported accepted video
  makes at most one Gemini call. Ordinary attachments never trigger analysis.
- Affected people: private-direct members; authenticated group uploaders once
  the separate group-authority change lands; other group participants whose
  membership alone grants no video authority; and members whose video cannot
  be analyzed.
- Choice: `standard` is the default at 1 FPS. `detailed_motion` is selected for
  rapid movement, exercise phases, quick scene changes, or brief events at
  5 FPS. Members do not choose a raw frame rate.
- Reply: answer naturally from visible or audible evidence. Mention camera,
  sampling, or health limits only when they materially affect the requested
  answer. Five FPS is denser sampling, not every source frame.
- Recovery: unavailable, unsupported, oversized, changed, or provider-failed
  videos say that no analysis ran. The runtime does not retry at another rate.
- Proof: exact request-shape tests, allowlist and compatibility tests, one-call
  regression proof, focused real-Codex mode-selection journeys, and a
  production-shaped hosted-local round trip where the harness supports it.

## Scope

- In scope: dynamic tool schema and selection guidance, shared Gemini
  capabilities, assistant request construction and result provenance,
  Cloudflare egress validation, deterministic tests, real-Codex journeys,
  durable architecture/security/deployment docs, and public changelog.
- In scope: a narrow rollout compatibility reader for the already deployed
  legacy request profile of 1 FPS, low thinking, and a 1,800-token output cap.
- Out of scope: raw member-controlled FPS, automatic second-pass analysis,
  queues, retries, a Files API lifecycle, durable analysis results, diagnosis,
  injury prediction, or widening requester/uploader authority beyond the
  separate group-authority change.

## Constraints

- Preserve the frozen video path, byte count, digest, MIME, accepted-turn,
  requester/uploader, credential, one-call, timeout, response-size, and
  retention owners.
- New profiles are exactly standard 1 FPS plus medium thinking and detailed
  motion 5 FPS plus medium thinking, both without `maxOutputTokens`.
- During rollout, the Worker accepts only those two new profiles or the exact
  deployed legacy profile. Mixed legacy/new shapes remain rejected.
- Deploy the compatible Cloudflare reader before the new runner writer. Remove
  the legacy profile only after warm old runners and the rollback floor advance.
- Preserve unrelated worktree state and integrate the separate group lane only
  from a committed, handed-off, or merged head.

## Tasks

1. Implement the shared semantic profile mapping, medium thinking default, and
   uncapped new generation config.
2. Extend the Cloudflare validator with exact new-profile and legacy-profile
   validation plus skew tests.
3. After the group lane hands off, integrate the optional sampling mode into
   the tool schema and assistant request owner without weakening its authority.
4. Add deterministic mode, request, provenance, one-call, and failure proof.
5. Add and run focused real-Codex journeys and review Murph's actual replies.
6. Update owning docs and changelog, run focused owner checks, then complete
   exact-head specialist/final ReviewGPT, CI, merge, deployment, and retirement.

## Product UX Walkthrough

- Pending implementation and direct journey proof.

## Verification

- Focused Assistant Engine analyze-video and real-Codex tests.
- Focused Cloudflare Gemini egress and intercept tests.
- Relevant package typechecks and `pnpm provider-requests:guard`.
- Production-shaped hosted-local standard and detailed-motion requests when
  the current harness can represent the selected profile.
- `git diff --check`, privacy inspection, exact-head CI, preliminary Product UX,
  prompt, and coverage ReviewGPT, plus final sensitive ReviewGPT.

## Local Evidence

- `pnpm exec vitest run --config vitest.config.ts --no-coverage
  test/assistant-codex-analyze-video-tool.test.ts` from Assistant Engine: 26
  tests passed.
- `pnpm exec vitest run --config apps/cloudflare/vitest.node.workspace.ts
  --no-coverage apps/cloudflare/test/runner-egress-gemini.test.ts
  apps/cloudflare/test/runner-egress-intercept.test.ts`: 262 tests passed.
- Assistant Engine, Hosted Execution, and Cloudflare package typechecks passed.
- The focused changelog page test passed with 9 tests, and the Web typecheck
  passed for the content-only release note.
- The focused real-Codex journey compiled and started against the default local
  subscription, but the lane returned `ASSISTANT_CODEX_USAGE_LIMIT` before any
  provider action. Live reply review remains `Hold` until one authorized
  alternate home or another exact journey run is available.
