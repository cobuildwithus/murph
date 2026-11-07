# OpenAI-only assistant inference

Status: completed
Created: 2026-10-07
Updated: 2026-10-07

## Outcome and invariant

Murph supports OpenAI assistant models only. Remove Venice and member-owned
inference endpoints, including setup, settings, secret storage, protocol
translation, verification, runtime selection, and associated configuration.
Preserve OpenAI model/reasoning selection, admission, usage accounting, and
normal personal and group replies.

## Ownership and evidence

The existing hosted-execution/operator-config contracts own model configuration;
Web owns saved settings and admission; Cloudflare owns credentialed egress; the
assistant runtime and engine own Codex configuration and turn execution. Source
inspection found alternative-provider paths across all four owners. Delete the
obsolete branches and state instead of introducing a replacement registry.

## Product UX

- Outcome: model and reasoning controls offer supported OpenAI choices.
- Entry: existing personal settings, assistant configuration tools, and local setup.
- Journeys: new members, saved OpenAI preferences, retired alternative-provider
  preferences, personal versus group runtimes, and scheduled model overrides.
- Proof: focused contract, settings, route, runtime, and egress tests; a focused
  real assistant journey; rendered settings evidence where available.
- Done when: supported choices work and retired controls cannot save or execute
  an alternative target. Separate Gemini video and xAI search tools remain outside this core-inference
  removal; that distinction was raised during implementation.

## Implementation

1. Remove shared alternative-provider contracts and setup configuration.
2. Remove Web storage/routes and provider settings UI; add a forward database
   migration without applying it to any shared or production database.
3. Remove Worker adapters, verification, and credential/env propagation.
4. Remove runtime/engine provider overrides; update tests and current docs.
5. Run focused verification and typechecks; inspect the complete diff and
   privacy boundaries, record limitations, close the plan, and commit locally.

## Deployment and failure boundaries

This is a coordinated retirement across Web, Worker, and runner code. A live
rollout must quiesce and drain old alternative-provider invocations before
removing their persisted state or switching their next execution to OpenAI.
No deployment, live credential deletion, or database mutation is part of this
local change. Historical migrations, settled usage records, release notes, and
completed plans remain historical evidence. After obsolete columns are dropped,
rollback requires a compatible forward fix or schema restoration.

## Verification

- Web and Cloudflare typechecks pass.
- Hosted-execution and operator-config focused tests, typechecks, and builds pass.
- Cloudflare egress/invocation/deploy contracts: 1,042 tests pass; hosted-control:
  86 tests and typecheck pass.
- Web settings/homepage/design: 99 tests pass. Phone and desktop Playwright
  model-selection proof passes; parent inspected the desktop render.
- Backend model/settings/admission/accounting suites pass. Fresh isolated local
  PostgreSQL proof passes 69 runtime-owner/checkpoint/account-cleanup tests after
  all ordinary and contract migrations. The isolated database was removed.
- The contract migration separately proves deletion and retry while preserving
  member model intent and runtime ownership fields. Historical migrations and
  settled usage snapshots remain intact.
- Setup: 95 tests pass with coverage; CLI: 175 focused tests pass; local harness:
  183 tests pass; release secret guard: 22 tests pass. Relevant typechecks pass.
- Runtime: 340 focused tests pass; six pre-existing native E2E gates remain
  skipped. Engine focused deterministic suites and typecheck pass.
- Changelog archive proof: 10 tests pass. Docs drift, doc gardening, complexity
  guard, whitespace, and added-line/new-file privacy checks pass.
- Parent review confirms removal of live endpoint routes, credential stores,
  adapters, provider choices, registry/env plumbing, and setup flags. Existing
  high-complexity runtime functions were simplified in place; no new abstraction
  or dependency was introduced. Legacy v1/v2 saved sessions normalize to OpenAI
  at the existing read boundary, preserving identity/history and clearing the
  incompatible model/profile/native resume. Strict new writes still reject
  retired targets. The 64-test parser suite and 67-test persistence/session
  suite pass, including composed read/restore/no-quarantine/idempotent rewrite.
- Focused real GPT-6 Sol local-subscription journey passes: exactly one model
  and reasoning update, read-only sandbox, and truthful next-turn confirmation.
  Parent reviewed the scenario and expected owned effects; reply UX is Ready.
  Initial subscription attempts failed before model work; an available local
  subscription completed the proof without changing or copying credentials.

## Product walkthrough and delivery

Model-only saves retain retry drafts and respect plan eligibility. Personal and
room configuration keep their existing authorization boundaries. Removed routes
cannot select or verify endpoints; setup rejects removed flags. Rendered model
choices match the surviving catalog. Product UX: Ready for the tested surfaces.
The new changelog item is `2026-10-07 / openai-assistant-models`.

This task ends with a local scoped commit. No PR, deployment, shared database
migration, credential deletion, broad CI, or external final review was run.
A future PR requires the repository's applicable exact-head CI and final review.


## Completion

Implementation, parent review, focused proof, browser evidence, schema cleanup
proof, and live assistant verification are complete. The cleanup is a net
reduction of roughly 18,000 lines. Current docs and the changelog reflect core
OpenAI-only inference. Historical records remain evidence of past behavior.
Completed: 2026-10-07
