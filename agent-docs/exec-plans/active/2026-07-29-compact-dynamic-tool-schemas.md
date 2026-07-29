# Compact Dynamic Tool Schemas

## Outcome

Reduce the fixed Codex context cost of ordinary hosted group turns by moving
the full `murph.automation` and broad `murph.group` request schemas behind
explicit on-demand schema discovery.

## Constraints

- Preserve the existing invocation-scoped root-turn authority checks.
- Preserve the current-conversation route binding for automation writes.
- Keep canonical automation records in the vault and keep Web-owned group
  authority at its existing boundary.
- Keep the existing strict request validators as the execution contract.
- Do not add persisted state, a second mutation owner, or a compatibility
  service.
- Keep narrow detached group-read tools direct so one-shot reads do not gain an
  unnecessary discovery round trip.

## Plan

1. Replace the always-advertised automation and broad group request schemas
   with a compact `schema | execute` envelope.
2. Return the existing exact request schema and action guidance only when the
   model calls the `schema` action.
3. Validate `execute.request` with the existing strict Zod/domain validators
   before any effect.
4. Update prompt guidance and focused tests for discovery, execution, invalid
   requests, and the maximum fixed schema size.
5. Measure before/after token cost, run canonical verification and direct
   request-path proof, complete required review gates, and close this plan with
   a scoped commit.

## Verification

- Focused assistant-engine tests for hosted domain tools, group actions, prompt
  guidance, and Codex request shaping.
- `pnpm test:diff packages/assistant-engine/src/assistant-codex/dynamic-tools.ts packages/assistant-engine/src/assistant-codex/dynamic-tools/automation.ts packages/assistant-engine/src/assistant/system-prompt.ts`
- `pnpm verify:acceptance`
- Direct serialized-schema token measurement before and after the change.
- Preliminary `completion-specialists` ReviewGPT pass with prompt and coverage
  lenses, followed by parent final review and the final ReviewGPT gate.

## Deployment

The dynamic-tool contract fingerprint changes, so a runtime using the new
bundle starts a fresh Codex thread contract instead of resuming a thread with
the old schemas. The change is internal to the runner bundle and needs no Web
or persisted-state migration.

## Progress

- Codex App Server accepts dynamic tools at thread start and persists them with
  the thread; it does not expose a configuration-only lazy schema registry.
- The broad automation and group definitions now advertise compact discovery
  contracts. The existing request schemas are returned only by `schema`, and
  `execute.request` still passes through the existing strict validators.
- Prompt-known simple group actions and the separately planned narrow
  scheduled/detached group reads remain direct.
- Tokenizer proof for the two fixed tool definitions: 6,164 tokens before,
  430 after, saving 5,734 tokens.
- Focused engine/runtime verification passed 489 assertions. Canonical
  `pnpm test:diff packages/assistant-engine packages/assistant-runtime` passed
  after generating the fresh worktree's ignored Health Commons catalog; the
  first run's 22 CLI failures were all missing-generated-file errors, and the
  exact affected files then passed 54/54 before the clean canonical rerun.
