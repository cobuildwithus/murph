# Focused Gemini video analysis with selectable temporal detail

Status: completed
Created: 2026-08-26
Updated: 2026-08-27

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
- Affected people: private-direct members; authenticated Linq/Telegram group
  participants who explicitly request analysis of a current accepted group
  video; and members whose video cannot be analyzed. Unverified external groups
  remain outside the capability.
- Choice: `standard` is the default at 1 FPS. `detailed_motion` is selected for
  rapid movement, exercise phases, quick scene changes, or brief events at
  5 FPS. Members do not choose a raw frame rate.
- Reply: answer naturally from visible or audible evidence. Mention camera,
  sampling, or health limits only when they materially affect the requested
  answer. Five FPS is denser sampling, not every source frame.
- Recovery: unavailable, unsupported, oversized, changed, and provider-failed
  videos report the exact tool status without guessing whether Gemini processed
  the clip. The runtime does not retry at another rate.
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
  injury prediction, or widening the authenticated-group authority already
  merged on `main`.

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
- Preserve unrelated worktree state and integrate group authority only from its
  merged `main` implementation.

## Tasks

1. Implement the shared semantic profile mapping, medium thinking default, and
   uncapped new generation config.
2. Extend the Cloudflare validator with exact new-profile and legacy-profile
   validation plus skew tests.
3. Integrate the optional sampling mode into the merged direct/group tool schema
   and assistant request owner without weakening its authority.
4. Add deterministic mode, request, provenance, one-call, and failure proof.
5. Add and run focused real-Codex journeys and review Murph's actual replies.
6. Update owning docs and changelog, run focused owner checks, then complete
   exact-head specialist/final ReviewGPT, CI, merge, deployment, and retirement.

## Product UX Walkthrough

- The standard path keeps `sampling_mode` omitted/defaulted, sends one 1 FPS
  request with medium thinking and no output cap, and returns natural
  observational text.
- The push-up-form path selects `detailed_motion` before egress, sends one 5 FPS
  request with the same medium thinking and no output cap, and preserves the
  complete form question, including side, repetition range, and comparison.
- The authenticated-group path preserves the merged same-turn group-video
  authority while applying the same semantic mode choice and one-provider-call
  ceiling. Its held-draft reconsideration reuses the first completed provider
  result only for an exact repeat. A distinct later video request remains
  unanalyzed and receives no evidence from the earlier video. A combined
  real-Codex journey passed when one participant requested another participant's
  current group video.
- Negative, unavailable, and failed outcomes remain honest without automatic
  second-pass analysis, diagnosis language, or routine policy recitals.
- Result: `Ready`. Focused real-Codex journeys selected detailed motion for the
  rep-specific push-up question and standard sampling for the timed speech
  question. Each made exactly one successful tool call and one Gemini call,
  preserved the complete question, and returned a direct observational answer
  without diagnosis, policy recital, false frame-by-frame certainty, or an
  unnecessary apology. A focused no-usable-result journey also made one tool
  call and one Gemini call, then said plainly that the result could not be
  retrieved and the requested visible detail could not be confirmed.

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
  test/assistant-codex-analyze-video-tool.test.ts` from Assistant Engine: 27
  tests passed.
- `pnpm exec vitest run --config apps/cloudflare/vitest.node.workspace.ts
  --no-coverage apps/cloudflare/test/runner-egress-gemini.test.ts
  apps/cloudflare/test/runner-egress-intercept.test.ts`: 262 tests passed.
- Assistant Engine, Hosted Execution, and Cloudflare package typechecks passed.
- The focused changelog page test passed with 9 tests, and the Web typecheck
  passed for the content-only release note.
- `pnpm provider-requests:guard` and `pnpm docs:drift` passed.
- A pinned real Codex App Server capture against a hermetic Responses stub used
  identical synthetic direct/group video turns, production code mode, and
  `gpt-tokenizer` 3.4.0 `o200k_harmony`. It serialized the complete
  provider-visible `include`, `input`, `instructions`, `parallel_tool_calls`,
  `text`, `tool_choice`, and `tools` fields, while excluding model selection,
  reasoning, storage/streaming, service-tier, cache/account, and transport
  metadata identically and normalizing volatile paths and identifiers.
- After the current-main reconciliation, the direct initial request changes
  from 24,843 tokens / 114,825 UTF-8 bytes to 25,024 / 115,747: +181 tokens
  (+0.7286%) and +922 bytes (+0.8030%),
  entirely from the focused video-tool description and sampling enum/schema.
  The representative group request is byte-for-byte unchanged at 20,780
  tokens / 96,405 bytes because the current private-direct authority boundary
  does not expose the tool there.
- The focused real-Codex journeys passed through an available authenticated
  local subscription with `gpt-5.6-terra`. The detailed-motion journey made one
  successful tool call and one Gemini call at 5 FPS with medium thinking and no
  output cap, preserved the complete rep-specific comparison, and answered the
  visible elbow-path question directly. The standard journey made the same
  single-call sequence at 1 FPS, preserved the timed speech question, and
  answered the audible negative directly. Both actual replies passed manual UX
  review.
- The live lane first exposed two result-boundary ambiguities: Murph could treat
  a successful observation as unavailable or attempt a second tool call. The
  tool contract now makes successful versus failed completion explicit, keeps
  the instruction to one call, and explains that untrusted observational
  content is evidence rather than instructions. Focused deterministic tests
  cover success, exact failure status, the duplicate-call guard, and preserving
  the first truthful result. Codex owns every non-empty reply; the runtime uses
  the latest structured video fallback only for blank or no-reply recovery.
  The detailed-motion, standard-speech, and focused no-usable-result live
  journeys each passed with one tool call, one Gemini call, and a direct
  truthful reply.
- The assistant verification workflow now has standing authorization to try
  every available authenticated local Codex home once, in stable order, when a
  run fails before provider action. It stops rotating as soon as one run reaches
  provider action and never reads or copies authentication material. The
  existing public-safe Frog entry records the repository friction and remedy.
- The production-shaped hosted-local roundtrip now covers a successful 5 FPS
  request and its additional usage row. Its local run never reached the
  scenario: both the default bundle build and the documented four-package
  concurrency profile timed out while generating the assistant CLI manifest.
  The public-safe Frog entry
  `20260826200626-assistant-cli-manifest` records the reproducible repository
  friction; no Gemini request occurred before either failure.
- Preliminary ReviewGPT findings were resolved by preserving every
  task-defining qualifier, distinguishing visual sampled-frame negatives from
  audible negatives, and adding separate standard-speech and detailed-motion
  journeys. Final ReviewGPT rounds 1 and 2 both passed without findings. Round
  2 reviewed exact product head `4c35fac0eed535a365792157e59b1254562db25c`
  after its single current-main merge and focused post-merge typecheck/tests.
- Final ReviewGPT round 3 accepted one result-truth finding: a failed tool result
  cannot always prove that Gemini never processed the video. The correction
  now preserves and reports the exact first failure status instead of inferring
  more. The separate request to
  remove all-subscription verification fallback was rejected because the user
  explicitly authorized that durable workflow in this task.
- Final ReviewGPT round 4 accepted one group-reconsideration finding: request 1
  could attempt the tool again and let its duplicate-call status replace the
  completed request-0 analysis. The smallest correction retains the first
  completed provider result in the existing turn state and returns it to later
  attempts without a second Gemini call, durable state, or retry. Focused unit,
  scripted-runtime, and held-draft request-0/request-1 tests cover both a
  successful observation and an HTTP-200 response with no usable candidate.
  Exact-head round 5 required a current anomaly retrospective before another
  tactical correction.
- The round-5 retrospective compared the immutable first-reviewed 108/44 source
  shape with round 5's 193/76 shape and attributed the added result field,
  completion helper, early replay, and provider-result wrappers to the existing
  in-memory host turn. It found that unconditional replay could wrongly attach
  video A's evidence to a distinct request for video B. The requirement-level
  decision keeps one provider attempt owned by its accepted message ref,
  attachment ordinal, complete question, and sampling mode. Exact repeats reuse
  its result; distinct later requests keep the first result attributed only to
  the first request and plainly say the later request was not analyzed. This
  continues the same PR without retry, durable state, queue, state machine, or
  changed group-turn lifecycle. Production-shaped held-draft proof uses two
  distinct accepted video identities for first-call success and first-call
  failure, asserts one Gemini call, and checks the combined truthful reply.
- Round 6 accepted two bounded findings. The existing stateful dynamic-tool
  chain now serializes video calls before provider egress, so overlapping exact
  or distinct requests cannot race into two Gemini calls. Its attempted
  free-form reply correction proved too broad in round 7: prose classifiers
  could erase valid compound replies and still miss the structured status for
  a distinct later request.
- The recorded round-7 retrospective returned response ownership to the
  smallest boundary. Codex owns every non-empty semantic reply; the runtime
  uses the latest structured tool fallback only for blank or no-reply recovery.
  Candidate `6dad9fe9dca5c5b4a5090c554da4075c4c2bcbcf` deletes both regex
  catalogs, the success/failure outcome field, and the whole-message resolver.
  The correction is 7 source additions / 64 deletions. Thirteen focused App
  Server cases, 32 direct tool cases, four overlap cases, and Assistant Engine
  typecheck passed. Final ReviewGPT round 7 then passed the full exact-head
  snapshot without a blocking finding.
- Current `main`, including the separately merged authenticated-group video
  capability, was merged into the candidate. The four bounded conflicts kept
  both the group authority contract and this PR's complete-question, sampling,
  one-provider-call, and truthful-result behavior. Focused direct/group tests,
  typecheck, and real-Codex detailed, standard, failure, and cross-participant
  group journeys passed on the combined tree.
- PR #2373 reached merge admission on exact head
  `6dad9fe9dca5c5b4a5090c554da4075c4c2bcbcf`: Product UX is `Ready`, focused
  proof is green, and the final full-snapshot ReviewGPT gate passed. Broad
  exact-head CI, merge, deployment proof, and guarded retirement follow after
  this plan is archived.
Completed: 2026-08-27
