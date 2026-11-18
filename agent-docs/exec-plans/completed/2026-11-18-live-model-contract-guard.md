# Catch provider request rejections before members do

Status: completed
Created: 2026-11-18
Updated: 2026-11-18

## Goal

- On 2026-11-18 the model provider rejected every GPT-6.2 request the new
  runner image built, so members on those models got no replies until a person
  noticed. CI, the deploy smoke and alerting all stayed green. Make each of the
  three catch this class of failure. The bug itself was fixed in #5185.

## Success criteria

- A credential-free test fails on the pre-#5185 image catalog and passes on the
  fixed one.
- The production deploy smoke runs a real turn for every model a member can be
  routed to, and one rejected model fails the release before serving changes.
- A rejected foreground reply sends one operator email within one cron period.

## Scope

- In scope: the scripted Responses stub and tool-input contract test; the deploy
  live-model smoke (Worker route, smoke container, container endpoint, smoke
  script); a Web runtime-log alert; DEPLOY.md, testing map and runtime-log docs.
- Out of scope: the catalog fix (#5185); murph-cloud workflow edits; any new CI
  secret or paid per-PR check (proposal only, below).

## Constraints

- Technical constraints: the deploy smoke's one-request egress fence is per
  model; the light container entrypoint must not gain cold-start imports.
- Product/process constraints: no production changes, no new spend or secrets
  without the owner, no real member data in tests or docs.

## Risks and mitigations

1. Risk: a Worker with the per-model smoke meets an image that predates it and
   the live turn fails.
   Mitigation: rollout skew is already retried on bundle mismatch; the first
   release from this commit rolls the image. Documented in DEPLOY.md.
2. Risk: five live turns per smoke phase raise the chance one transient
   provider error fails a release.
   Mitigation: accepted; the release is rerun. Retries stay off so the
   one-request fence keeps the original failure visible.
3. Risk: the pinned `web.run` digest goes stale when the provider or Codex
   legitimately changes the schema.
   Mitigation: the test fails closed with the re-proof command beside the pin.

## Tasks

1. Reproduce the provider rejection locally with the pinned Codex and the
   pre-fix catalog, with passing controls. Done.
2. Stub rule plus contract test over every image catalog model. Done.
3. Per-model deploy live smoke. Done.
4. Web provider request rejection alert. Done.
5. Docs, verification, draft PR. Done.

## Decisions

- Built: stub enforcement of the live-proven `web.run` parameters digest. The
  provider validates only `parameters` (replay with the description changed
  passed; with the incident parameters it failed).
- Built: one live turn per `HOSTED_ASSISTANT_PRODUCT_MODELS` entry in each
  enabled smoke phase, each under its own one-request fence, Astra on the
  `.astra` catalog. murph-cloud needs no functional change; its
  `live_model_turn` input description still says one `gpt-6.1-sol` turn.
- Built: Web alert on `input.reply-failed` rows with `turn_failed`,
  `failureRetryable: false` and zero provider actions. Seven days of production
  rows held this shape only during the incident (7 rows, first at 17:43:58Z).
- Rejected: an `experimental_supported_tools` allowlist test. #5185 already
  asserts the removed entry, and the digest test catches any catalog change that
  reaches the request.
- Rejected: enforcing the rule in the hosted-local E2E provider stub. That
  harness never sets the image catalog, so it would not have seen the incident
  shape.
- Rejected: a full member-runtime turn in the deploy smoke. Murph's own tools
  are not provider-reserved and the hermetic contract suite covers them; the
  smoke would need a member workspace and several times the spend.
- Not built, owner decision: a paid per-PR live check for Codex pin, catalog
  and provider-config changes. No workflow in this public repository holds a
  provider key today; it needs a new spend-capped secret and about five small
  turns per matching PR.
- Final ReviewGPT applies (hosted execution, deploy boundary) and was not run
  in this delegated task; the parent decides.

## Verification

- Contract test: passes on the fixed catalog; with the pre-#5185 Dockerfile
  swapped in it fails with the provider's `web.run` rejection.
- Deploy smoke command with the production config builder against the real
  provider: pre-fix catalog passes Luna and fails Sol and Astra with the
  incident's 400; fixed catalog passes Sol and Astra.
- Focused suites green: Cloudflare smoke, container, Worker route, egress and
  image contract; Web alert unit, cron and Postgres. Typecheck green for
  assistant-engine, assistant-runtime, Cloudflare and Web.
  `pnpm complexity:diff` passes.
- `assistant-codex-scripted-runtime.test.ts`: two `common list limit` cases
  fail in this worktree because the built workspace CLI is absent; they stop
  before any provider request and do not touch the changed stub rule.
- Not proven until the first production release: the production key on all
  five models and five turns inside one smoke request.
Completed: 2026-11-18
