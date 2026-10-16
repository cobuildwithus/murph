# Knowledge optional reads and CLI write guidance

Status: active (Stage 1 consumer candidate; Stage 2 producer pending)
Created: 2026-10-16
Updated: 2026-10-16

## Goal

- Managed automations that probe optional derived ledgers get a successful,
  truthful absent result instead of a failed tool call, without ever treating
  uncertain or invalid wiki state as "no prior history".
- Direct-route wiki writes are guided by the real `vault-cli knowledge upsert`
  shape instead of the retired dedicated knowledge write surface.

## Two-stage delivery

One fix delivered in two narrow PRs through the existing protected deployment
path. No new deployment toggles, aliases, or rollout machinery.

- Why: native replacement is not atomic; gradual and immediate modes both
  have a mixed window (`apps/cloudflare/DEPLOY.md` § Production rollout
  policy). Saved instructions outlive the binary that wrote them. The
  onboarding first personal read is a one-shot saved record (due about 2
  minutes after save, active about 62 minutes) that seed reconciliation never
  rewrites. A first read saved with `--if-exists` and then executed by a CLI
  without that option fails the read and skips. That member permanently loses
  the one-shot first read. This is a valid-success regression, not an
  acceptable deployment risk.
- Stage 1, the consumer (this checkout): the additive CLI capability only.
  It writes no saved or managed instruction that uses `--if-exists`, and every
  existing caller keeps its current strict behavior under any old/new image
  mix.
- Stage 2, the producer (later checkout): the prompt and saved-instruction
  callers, applied only after the parent verifies Stage 1's exact protected
  Worker, native image, and config convergence and health. Both baseline and
  candidate CLIs then support the mode. After Stage 2 saves new instructions,
  Stage 1's CLI-supporting revision is the exact rollback floor. Prefer a
  forward fix, and any exact Cloudflare rollback still requires explicit
  permission.

## Stage 1 scope

- `getKnowledgePageIfExists` beside unchanged strict `getKnowledgePage`, both
  through one shared reader (`readKnowledgePageBySlug`). Absence is reported
  only from a fully valid generic graph (reserved room state excluded, as in
  degradation). Otherwise the read fails with the existing
  `knowledge_page_invalid` integrity error ("absence is unconfirmed").
- Query `KnowledgeAbsentPageResult` (`degradation: null`, `page: null`),
  `knowledgeAbsentPageResultSchema`, `knowledgeShowResultSchema` union, and
  public exports. `KnowledgeGetResult` and its schema are unchanged.
- `knowledge show --if-exists` option and manifest text; regenerated config
  schema, Incur types, and skill hash.
- `docs/contracts/03-command-surface.md` synopsis and semantics, and the
  `knowledge-show` smoke synopsis.
- Tests: the service (clean-graph absence, malformed different-basename
  unconfirmed, unrelated malformed, present with degradation, reserved,
  duplicate, unreadable, rename mid-read, no writes, exact strict
  not-found), the CLI (in-process and built CLI), and the boundary schema
  identity.
- One live consumer journey: `real Codex optional knowledge show e2e` ›
  `checks an absent wiki page once with the opt-in if-exists read and writes
  nothing`. It uses the production direct prompt and the real CLI, and the
  request names the opt-in option. It is not evidence for Stage 2 guidance.
  The strict missing-recovery journey is unchanged.
- Changelog: not applicable for Stage 1. This is compatibility preparation
  and switches no production caller. The Stage 2 PR's single item will name
  both PRs.

## Stage 2 scope (deferred, private snapshot)

- `system-prompt.ts` CLI-route write sentence.
- `managed-automations.ts` and first-personal-read `--if-exists` reads with
  fail-closed skips, plus the `journal-connected-context` skill ledger read
  (a failed read counts as a global opt-out).
- The command-surface owner sentence (prompt routes wiki work through
  `vault-cli knowledge`).
- Planning, onboarding, and guidance tests; the scheduled optional-ledger and
  authorized-upsert live journeys; and fake-CLI absent fixtures.
- The public changelog item: more reliable saves and first-time history
  checks, staying quiet when history is unreadable.

## Risks and mitigations

1. Risk: a malformed page under another filename declares the requested slug.
   Mitigation: unconfirmed absence fails instead of returning `page: null`.
2. Risk: one-shot first-read loss under mixed CLI versions.
   Mitigation: the consumer-first split above.
3. Risk: prompt growth (Stage 2).
   Mitigation: the private real-CLI-contract provider-input harness is ready to
   rerun with Stage 1 as base.

## Verification

Stage 1 exact candidate, executed and passed:

- Engine (`packages/assistant-engine/vitest.config.ts`): knowledge-service,
  managed-automations, managed-automations-core,
  onboarding-first-personal-read, system-prompt.dynamic-context,
  assistant-codex-turn-planning (base digests unchanged),
  assistant-skill-assets, and assistant-codex-real-e2e (compile; live tests
  skipped). Result: 8 files, 399 passed, 491 skipped.
- CLI (`packages/cli/vitest.workspace.ts`): knowledge-boundary, incur-smoke,
  incur-error-bridge, cli-timing, and device-knowledge-command-coverage.
  Result: 5 files, 111 passed.
- Query: knowledge-contracts (3) and root-surface (1). Result: 4 passed.
- Typecheck passed for query, assistant-engine, and CLI. Builds passed for
  query and assistant-engine.
- `gen:config-schema`: idempotent (skill hash `586c6dbed2103178`).
- `complexity:diff`: no hotspots. `test:scenario-integrity` (206 scenarios)
  and `docs:drift` passed.
- Stage 1 live journeys: the parent ran both exact Stage 1 journeys on
  gpt-6.1-sol with a local subscription, and both were reviewed `Ready`. The
  private-safe record is `parent-validation.json`.
  - Optional show capability: exactly one opt-in target show and no other
    wiki command. The full vault was unchanged, the outbox was empty, and the
    reply truthfully reported the page absent.
  - Strict missing recovery: one strict target show and no write. The reply
    invented no contents and was a truthful, concise recovery.

Pre-split full candidate (Stage 1 plus Stage 2 together; not Stage 1 proof):

- Results: engine 402 passed, CLI 111, query knowledge-contracts 3, Web
  changelog 60, typechecks passed.
- Three parent live journeys were `Ready` on gpt-6.1-sol with a local
  subscription: strict missing recovery, optional scheduled absence, and
  authorized wiki write.
- Failing-before on a base `1cd83349c3` snapshot: the old CLI rejects
  `--if-exists` with `VALIDATION_ERROR`, and the old prompt names the retired
  writer.
- Provider input with real CLI contracts: direct +58 bytes (+0.031%; only the
  Stage 2 write sentence), both group fixtures unchanged. The CLI contract was
  equal at 6,531 bytes.

Remaining Stage 2 proof:

- Apply the snapshot to a new checkout and rerun the focused suites, the
  provider-input measurement against Stage 1, and the producer live journeys.
- Add the changelog item with both PR numbers.
