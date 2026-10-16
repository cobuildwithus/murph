# Knowledge optional reads and CLI write guidance

Status: active (Stage 1 consumer merged in PR 4174; Stage 2 producer prepared
locally, publication held)
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

## Stage 2 gate: local preparation versus production adoption

- Stage 1 merged as `617753d7c2` (PR 4174), and its protected gradual
  release is deploying. The Stage 2 producer checkout starts from that exact
  base.
- Authorized now: local preparation only. That covers applying the producer
  hunks, focused and relevant deterministic checks, and recording evidence
  here.
- Still held, and unchanged by this preparation: publication, merge, any
  production saved caller, and any producer release that adopts
  `--if-exists`. These wait until the parent verifies Stage 1's exact protected
  Worker, native image, and config convergence and health. The rollback-floor
  rule in § Two-stage delivery still applies.

## Stage 2 scope

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

Stage 1 MCP result-shape correction, after ReviewGPT Round 1. Round 1 PASSED
on PR 4174 head `0d86418535`, which predates this fix, so that PASS does not
cover it.

- Parent finding: the `knowledgeShowResultSchema` union emitted no JSON Schema
  root `type`. Incur's MCP output schema requires a root `object`, so
  `knowledge_show` lost its `outputSchema`, and every successful call
  (including existing strict present reads) lost `structuredContent`.
- Fix: one annotation at the query owner,
  `knowledgeShowResultSchema = z.union([...]).meta({ type: "object" })`.
  Both branches are objects, so the annotation is truthful. Runtime
  validation, the union, and strict `knowledgeGetResultSchema` are unchanged.
  `gen:config-schema` changed only the skill hash, from `586c6dbed2103178` to
  `91f14583a075221c`, and a rerun is idempotent.
- Failing-before on head `0d86418535`: the new shipped-CLI MCP test failed at
  `outputSchema.type` (`undefined`, expected `object`). The test stopped there,
  so the missing `structuredContent` before the fix rests on the parent's
  probe plus Incur's `callTool` gating, not on this test's later assertions.
- Proof after the fix:
  - CLI `shipped vault-cli MCP keeps structured knowledge_show results for
    strict and optional reads` drives the built `vault-cli --mcp --vault`
    over stdio JSON-RPC with production registration and progressive
    discovery. `get_tool_details` shows an object `outputSchema` with two
    `anyOf` branches. The strict present read and the explicit optional
    absent read both return `structuredContent` equal to their text payload.
    The strict missing read is still `isError` with no `structuredContent`,
    and nothing is written.
  - Query: knowledge-contracts covers the object root, `anyOf` equal to the
    two exact branch schemas, and rejection of non-null degradation, a
    missing slug, an invalid slug, and absent-through-strict. Result: 4
    passed, plus root-surface for 5 total.
  - CLI: 5 files, 112 passed. Typecheck reported 0 errors for query,
    assistant-engine, and CLI. `complexity:diff` found no hotspots, and
    `docs:drift` passed.
  - Built `knowledge show --schema` and `--llms-full` both report
    `output.type: object` with two `anyOf` branches and the `ifExists` option.
- Still needed: a new independent ReviewGPT round and final-head CI. The
  parent decides any minimal live repeat; the CLI handler behavior is
  unchanged.

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

Stage 2 local preparation on base `617753d7c2`, executed and passed:

- Applied: the producer-only snapshot hunks applied cleanly except the live
  e2e file. There the two producer journeys (`real Codex optional knowledge
  ledger and wiki write e2e`), the `fakeMissingKnowledgePageShow` helper, the
  `knowledgeAbsentPageResultSchema` import, and the three fake-CLI absent
  fixtures were reapplied by hand next to the Stage 1 consumer journey. The
  consumer journey and its assertions are kept; only its comment no longer says
  saved callers do not use the option. The full pre-split diff was not
  applied.
- Also restored `knowledge-cli-guidance.test.ts`, rewrote the changelog
  fragment, and updated the command-surface owner sentence.
- Single saved one-shot producer: `buildOnboardingFirstPersonalReadAutomationSaveRequest`
  saves `MURPH_ONBOARDING_FIRST_PERSONAL_READ_INSTRUCTIONS`, which is the
  edited constant.
- Focused first (3 files, 129 passed): knowledge-cli-guidance,
  assistant-codex-turn-planning, and onboarding-first-personal-read.
  - The planning test's direct and scheduledEmail digests match the saved
    snapshot. Group, maintenance, and outputOnly are unchanged, and group
    prompts contain no `knowledge upsert`.
  - The guidance test runs the built CLI (`packages/cli/dist/bin.js`) on
    fresh synthetic vaults.
    - It parses the composed CLI-route prompt and executes its upsert shape
      with repeatable `--library-slug` and `--source-path`, producing one page,
      the index, the log, and one log entry.
    - The synthetic plural flags `--library-slugs` and `--source-paths` fail
      with `VALIDATION_ERROR` at `arguments` and write nothing.
    - Every production `knowledge show` in managed automations, the first
      read, and the connected-context skill uses `--if-exists`. That covers six
      slugs, and each returns exact `page: null` while a strict read stays
      `knowledge_page_not_found`, with no writes.
    - Unconfirmed absence (`knowledge_page_invalid`, stage `integrity`) is
      covered through the CLI by Stage 1's `device-knowledge-command-coverage`,
      and the shipped-MCP strict and optional `structuredContent` test is
      unchanged.
- Engine suites (9 files, 402 passed, 493 skipped): the files above plus
  managed-automations, managed-automations-core,
  system-prompt.dynamic-context, assistant-skill-assets, knowledge-service,
  and assistant-codex-real-e2e (live tests compile and skip without a real
  Codex).
- assistant-engine typecheck passed.
- `gen:config-schema` produced no diff. `complexity:diff` passed with
  `system-prompt.ts` debt unchanged. `test:scenario-integrity` passed (206
  scenarios).
- Web: `changelog:generate` and `changelog-page.test.tsx` passed (10).
- Changelog item `2026-10-16 · wiki-saves-and-scheduled-history`, priority 2.
  `sourcePullRequests` lists 4174 until the parent supplies the producer PR
  number.

Remaining Stage 2 proof (parent):

- Run the private provider-input measurement with Stage 1 as base; no bytes
  measured here are claimed. Run the producer live journeys, independent
  review, and CI.
- Add the producer PR number to the changelog fragment.
- Pass the production adoption gate in § Stage 2 gate, then close this plan
  through `scripts/finish-task`.
