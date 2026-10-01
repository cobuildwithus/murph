# Upgrade Codex CLI and ElevenLabs speech

Status: completed
Created: 2026-09-28
Updated: 2026-09-28

## Goal and protected invariants

Use the latest compatible runtime and speech model without increasing published provider rates. Preserve selected voices, explicit legacy model overrides, bounded requests, hosted credential isolation, exact write fences, and character-based usage accounting.

## Owners and scope

The operator-config speech adapter and preview helper own SDK requests. Cloudflare owns allowed egress and usage recording; hosted-execution owns priced-model validation; Web owns allowance rates. Extend these owners for single-voice Eleven v4 dialogue requests. No new dependency, state, retry, queue, or abstraction is needed. Existing voice choices and saved outbox requests keep working. Music and transcription are outside the voice-synthesis upgrade.

## Decisions and external evidence

- npm latest Codex CLI is 0.158.0; refreshed main pins 0.156.1. The exact shipped `patches/codex-public-live.patch` fails `git apply --cached --check` against tag rust-v0.158.0 in its experimental schema and five source/docs files. Retain 0.156.1 under the user's compatibility condition; porting the public Live integration requires separate work and live-session proof.
- User explicitly approved the Eleven v4 API migration after learning it is not a drop-in TTS model.
- https://elevenlabs.io/docs/overview/models identifies eleven_v4 and the Text to Dialogue API; v4 Turbo requires a separate websocket integration and is not used for buffered voice memos.
- https://elevenlabs.io/docs/api-reference/text-to-dialogue/convert accepts inputs containing text and voice_id and returns MP3. Existing 1,000-character runtime limit is below its recommended 2,000-character request ceiling.
- https://elevenlabs.io/pricing/api lists v4 at $0.022/1K until October 12 and $0.08/1K normally, the same regular price as Multilingual v2. Allowance accounting uses the durable regular rate, not a temporary promotion. Existing model rates retain their prior accounting contracts.

## Product UX

Journeys: default voice memo uses v4 with the selected voice; explicit legacy model preserves its endpoint; provider rejection/timeout preserves existing error behavior; malformed dialogue requests never reach the provider or bill usage. Preview generators use the same model family without regenerating checked-in media. No initial provider prompt or foreground reply call is added.

## Deployment and failure

Web must recognize and price eleven_v4 before the Worker/runner starts emitting its usage. Deploy updated Worker dialogue admission with the new runner adapter; preserve old speech endpoint support during skew. No persistent schema changes. An explicit MURPH_ELEVENLABS_MODEL_ID override continues to take precedence. Production configuration and audio quality are not inferred from local mocked proof.

## Tasks and verification

1. Extend the existing SDK adapters, guarded egress, model validation and allowance price.
2. Prove default/override requests and returned bytes, hosted credential stripping/write fence/usage, invalid dialogue rejection, and price accounting in focused tests.
3. Run relevant package/app typechecks, complexity and document checks. Review full diff and privacy, close plan and commit scoped changes.

## Results

Implementation complete in the task branch. Codex remains unchanged because the custom public Live patch is incompatible with latest upstream; the conditional CLI upgrade was not applied.

- Operator-config speech and lazy SDK loading: 19 tests passed.
- Preview generation helper: 5 tests passed.
- Hosted egress: 261 tests passed, including v4 credentials, write fence, usage accounting and twelve malformed dialogue cases.
- Web usage allowance: 142 tests passed, including v4 regular-rate accounting.
- Assistant voice planning, overrides and generation: 41 focused tests passed (105 unrelated tests filtered out). Every roster choice reaches the real SDK adapter with the same voice ID on v4. Existing planning tests cover persisted classic/warm/stale preferences.
- Dependency graph build and operator-config, hosted-execution, assistant-engine, Cloudflare, Web and repository-tools typechecks passed. The tools check used `node scripts/run-typescript.mjs package -p tsconfig.tools.json --pretty false`; an initial unsupported `tools` lane was corrected without changing configuration.
- Complexity guard passed; all existing hotspots are unchanged. Changelog generation and document gardening passed. Documentation drift passed after refreshing the indexed spec owner.
- Candidate review: existing request options, no-retry policy, timeout, response bounds, credential stripping, saved descriptors and explicit model overrides remain intact. No assistant prompt, tool schema, selected voice, storage schema or model subscription changes.
- Managed Linq source was inspected read-only in its private owner: it consumes the public model resolver and audio adapter and preserves preferredVoiceId. No private source was copied or changed.
- Changelog entry prepared; source PR list remains empty because this task has no PR yet.

## Remaining deployment evidence

Local deterministic compatibility is Ready. Production activation is Hold until the configured New York/default voice is confirmed as a library voice or a v4-retrained clone. ElevenLabs explicitly requires retraining old custom clones (https://elevenlabs.io/v4); public voice metadata requires authentication. No production credentials or member voice settings were read, no live audio was generated, and no deployment was performed. Keep an explicit older-model override until that provider prerequisite is met. The user was asked which voice category applies.

The published docs are inconsistent about v4's TTS endpoint: the model reference documents Dialogue, while the launch page also shows a TTS example. The adapter uses the documented Dialogue endpoint; hosted admission retains the compatible priced-model TTS route too.

A deployment must also publish the Web price/model support before the new Worker/runner, verify any existing model override, and complete required exact-head CI and ReviewGPT when a PR is opened. No push, PR, external review, or merge is claimed by this local implementation task.
Completed: 2026-09-28
