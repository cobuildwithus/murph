# Move generated music to Eleven Music v2.5

Status: completed
Created: 2026-11-14
Updated: 2026-11-14

## Goal

- Every song Murph generates (ordinary `generate_song` calls and the recap
  show's theme song) is made with `music_v2_5`, ElevenLabs' newest music model.
- Requests saved or in flight before the switch still complete.

## Success criteria

- New music requests name `music_v2_5` on both request shapes: the prompt
  request (`/v1/music`) and the timed-lyrics request (`/v1/music/detailed`).
- A saved or in-flight `music_v2` request is still accepted, sent with its own
  model, and priced, at every boundary that validates the model.
- Usage for `music_v2_5` is priced at the same per-minute rate as `music_v2`.
- One real request per shape returns audio of the requested length through the
  upgraded SDK, with usable word timings on the timed-lyrics shape.

## Scope

- In scope: the ElevenLabs SDK version, the music model constant, the delivery
  and side-effect contracts, the priced-model list, the Cloudflare egress
  filter, their tests, and the recap show contract's wording.
- Out of scope: the request shapes themselves (one chunk, one style line),
  speech models, song instructions in the private skills repository, and the
  recap score experiment.

## Constraints

- Technical constraints: SDK 2.62.0 types and serializers know only `music_v1`
  and `music_v2`; `music_v2_5` arrived in 2.68.0. The detailed-music call
  depends on how the SDK returns the multipart response, which 2.62.0 typed
  wrongly, so that call is re-proved against the upgraded SDK.
- Product/process constraints: no new state, retry, queue or abstraction.
  Extend the existing owners. No production configuration changes: the music
  model is a code constant, not an environment variable.

## Risks and mitigations

1. Risk: Web prices a usage record before it knows the model, or a boundary
   rejects a model the other side already emits.
   Mitigation: every validating boundary accepts both models. Web deploys on
   merge and must pass admission before the Cloudflare runtime deploy. In that
   deploy the Worker reaches 100% before the serving runner rolls, so the
   Worker sees `music_v2` from old runners and `music_v2_5` from new ones.
2. Risk: the upgraded SDK changes the detailed-music return value and songs
   lose their word timings.
   Mitigation: keep the response validation, and prove one real timed-lyrics
   request before merge.
3. Risk: a saved outbox descriptor naming `music_v2` no longer parses.
   Mitigation: the stored contracts accept both; only new writes use v2.5.

## Tasks

1. Upgrade `@elevenlabs/elevenlabs-js` everywhere it is pinned, with the lockfile.
2. Make `music_v2_5` the model new requests use; accept `music_v2` and
   `music_v2_5` wherever a model is validated or priced.
3. Update tests at each owner and the recap show contract's wording.
4. Prove both request shapes against the real provider.
5. Changelog decision, candidate review, PR, exact-head CI, final ReviewGPT.
6. After merge: Web admission, then the Cloudflare runtime deploy.

## Decisions

- `music_v2_5` is the newest music model and the one ElevenLabs recommends;
  `music_v1` is deprecated (removal January 31, 2027) and `music_v2` is the
  previous generation. Source: https://elevenlabs.io/docs/overview/models
- The published API price is one Eleven Music rate, $0.15 a minute, with no
  per-model rows. Source: https://elevenlabs.io/pricing/api (read 2026-11-14).
  The allowance rate and pricing version are unchanged.
- Chunk plans, word timestamps and the `mp3_48000_192` output are the same on
  v2 and v2.5. Source: https://elevenlabs.io/docs/api-reference/music/compose-detailed
- The owner asked for the switch on 2026-11-14 after hearing both models on
  the same recap song plan.

## Verification

- Commands to run: focused tests for operator-config, hosted-execution,
  assistant-engine, Cloudflare egress and Web usage allowance; typechecks for
  the touched packages and apps; the repository's diff-scoped test lane.
- Expected outcomes: all pass, plus the two real-provider requests above.

## Results

Tasks 1–3 implemented in this checkout; no commit, push, PR, provider request,
secret access or environment-file read. Tasks 4–6 remain with the parent.

- Upgraded all three SDK pins and the lockfile to 2.78.0, the registry's latest
  release (published 2026-11-12 14:57 UTC). The normal install admitted it under
  the unchanged 1,440-minute release-age and no-downgrade trust policies. Its
  `ws` dependency resolves to the already-present 8.22.2; no policy exceptions.
- Added the tiny public `@murphai/contracts/elevenlabs-music` entrypoint because
  operator-config has no dependency on hosted-execution. It owns the new-request
  default and the accepted tuple; delivery, runtime validation and pricing derive
  from it. Saved v2 requests keep their model through both egress shapes. Formats,
  duration limits, request shapes, rate and pricing version remain unchanged.
- Added compatibility, rejection and new-request assertions at each affected
  owner, including both ordinary and recap generation. All 579 focused tests
  passed. Updated the recap contract sentence and its index verification date.
- Inspected the installed SDK and compared its published 2.62.0 source in memory:
  `MusicModelId` types/serializers now include v2.5; the music multipart wrapper
  and text-to-speech/text-to-dialogue client implementations are unchanged.
  The public music getter still declares detailed composition as a stream while
  the wrapper returns parsed audio and metadata. Kept runtime validation and
  corrected the version comment. Existing fake-provider speech tests pass for
  multilingual v2, v3 and v4, with the same request bodies and endpoints.

Commands below ran with captured, path-redacted logs and their actual process
exit codes under `.runtime/tmp/eleven-music-verification/`. Prisma commands use
its supported environment-file opt-out. Repeated commands include the final
check after the detailed egress guard was narrowed to preserve its existing
exact-model validation.

| Command | Exit code |
| --- | --- |
| `pnpm install --prefer-offline` | 0 |
| `pnpm build:workspace:incremental` | 0, 0 (each run) |
| `pnpm --dir packages/health-commons generate` | 0 |
| `env MURPH_PRISMA_SKIP_ENV_FILES=1 pnpm --dir apps/web prisma:generate` | 0 |
| `pnpm --dir packages/operator-config test test/assistant-cli-contracts.test.ts test/elevenlabs-runtime.test.ts` | 0 |
| `pnpm --dir packages/hosted-execution test test/assistant-usage.test.ts test/side-effects.test.ts` | 0 |
| `pnpm --dir packages/assistant-engine test test/assistant-codex-generate-voice-memo-tool.test.ts test/recap-media-files.test.ts test/channel-helpers.test.ts test/assistant-codex-voice-memo-dynamic-tools.test.ts` | 0 |
| `pnpm --dir apps/cloudflare test:node:workspace test/runner-egress-elevenlabs.test.ts test/runner-egress-intercept.test.ts` | 0, 0 (each run) |
| `env MURPH_PRISMA_SKIP_ENV_FILES=1 pnpm exec vitest run --config apps/web/vitest.workspace.ts --no-coverage apps/web/test/hosted-execution-usage-allowance.test.ts` | 0 |
| `pnpm --dir packages/contracts typecheck` | 0 |
| `pnpm --dir packages/operator-config typecheck` | 0 |
| `pnpm --dir packages/hosted-execution typecheck` | 0 |
| `pnpm --dir packages/assistant-engine typecheck` | 0 |
| `pnpm --dir packages/cli typecheck` | 0 |
| `env MURPH_PRISMA_SKIP_ENV_FILES=1 pnpm --dir apps/web typecheck` | 0 |
| `env MURPH_PRISMA_SKIP_ENV_FILES=1 pnpm --dir apps/cloudflare typecheck` | 0, 0 (each run) |
| `pnpm deps:guard` | 0 |
| `pnpm deps:audit` | 1 |
| `pnpm deps:ignored-builds` | 0 |
| `node scripts/verify-workspace-boundaries.mjs` | 0 |
| `node scripts/check-workspace-package-cycles.mjs` | 0 |
| `pnpm provider-requests:guard` | 0 |
| `pnpm test:scenario-integrity` | 0 |
| `pnpm complexity:diff` | 0, 0 (each run) |
| `pnpm --dir apps/web exec oxlint test/hosted-execution-usage-allowance.test.ts` | 0 |
| `pnpm docs:drift` | 0 |
| `git diff --check` | 0 |

`pnpm deps:audit` found six advisories (two high, three moderate, one low).
The high findings are unchanged `deepmerge-ts@7.1.5` through Prisma
(GHSA-ggr8-5vv4-36mx) and `zod@3.25.76` through the Cloudflare test pool
(GHSA-mrhx-c7xc-m3w5). Their lockfile entries and dependency paths are untouched;
no SDK advisory was reported. Dependency policy passes and no install builds
were ignored. The other listed checks pass; complexity debt is unchanged.

The current verification owner's PR-path rules differ from this plan's earlier
`test:diff` note: broad verification belongs to exact-head PR CI, and a root
manifest change would expand local `test:diff` to the entire workspace. Followed
that owner by running focused tests, all seven relevant typechecks, the workspace
build and applicable guards. Broad CI, real-provider audio duration/word-timing
proof, changelog, final review, PR and deployment remain unverified here and
parent-owned. No live-model journey was run: the change does not alter the
assistant's tool schema, instructions or decision policy.

### Parent proof and review

Task 4, real provider through the built `generateElevenLabsMusic` on SDK 2.78.0,
one request at a time (2026-11-14). Each track matched its requested length
within 40 ms:

| Request | Model | Asked | Measured | Timed words |
| --- | --- | ---: | ---: | ---: |
| Prompt shape | `music_v2_5` | 15,000 ms | 15,024 ms | not requested |
| Timed-lyrics shape | `music_v2_5` | 20,000 ms | 20,040 ms | 20 of 20 |
| Timed-lyrics shape, saved request | `music_v2` | 20,000 ms | 20,040 ms | 20 of 20 |
| Prompt shape, instrumental | `music_v2_5` | 10,000 ms | 10,032 ms | none |

The parent reran the focused suites after a clean workspace build: contracts
504, operator-config 65, hosted-execution 56, Cloudflare egress 227, Web usage
allowance 149 and assistant-engine 43 tests, all exit 0.

Candidate review: the private voice-memo runtime is assembled into the exact
public checkout at build time and names no music model, so it follows this
change without a private release. The SDK's `console.log` on a parsed
detailed-music response is present in 2.62.0 as well; it is not new output.

Product UX: Patch. A member who asks for a song, and a pair whose recap show
gets a theme song, hear the newer model; nothing else about the request,
delivery, timing or failure path changes. A song queued before the deploy is
generated with the model it was queued with. Ready.

Deployment: Web must price `music_v2_5` before a runner emits it, so Web
admission passes before the Cloudflare runtime deploy. Every boundary accepts
both models, so a mixed Worker and runner pair is safe in either direction.
Completed: 2026-11-14

### Source path map

The first exact-head CI run failed in the lanes that run from source without a
build: the runner bundle assembly under `tsx`, and unbuilt-package Vitest
lanes, could not resolve `@murphai/contracts/elevenlabs-music`. Local checks
had passed because a built workspace resolves the entrypoint from `dist`. The
entrypoint is now registered in `tsconfig.base.json`, `apps/web/tsconfig.json`
and `scripts/workspace-source-resolution.test.ts`, as the previous new
entrypoint was. Proof with `packages/contracts/dist/elevenlabs-music.js`
removed: a `tsx` import of `packages/hosted-execution/src/runtime-control.ts`
resolves with the path entry and fails without it; both state-cardinality
suites pass (7 tests); the source-resolution suite passes (20 tests). The gap
is recorded in the friction log.

### CLI import surface

The second exact-head CI run failed one shard: the scoped CLI probe
`condition list --format json` resolved 324 modules against a ceiling of 323.
The added module is `contracts/dist/elevenlabs-music.js`, two zero-import
constants, reached through the delivery contract that probe already loads.
Reproduced locally at 324; the ceiling is raised to the measured count with its
note, as the two previous single-module additions were. Every other shard on
that head passed.
