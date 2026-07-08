Goal (incl. success criteria):
- Implement the Habitat foundation from `agent-docs/product-specs/habitat.md`: a new `habitat` bank family (one markdown file per aspect, atomic indicators in frontmatter, `declined` as a first-class value), a versioned domain catalog in `packages/contracts`, a `vault-cli habitat save/show/list` command surface, browser-vault replica inclusion, and a pure `computeHabitatCoverage` derivation.
- Success means: contracts registry/layout tests pass with the new family; `vault-cli habitat save` persists and re-reads an aspect record; the family appears in the browser-vault replica coverage tests; coverage derivation has focused unit tests; no prompt or UI changes in this pass.

Constraints/Assumptions:
- Additive only. No assistant prompt changes, no web UI changes, no proactive-collection behavior yet (phase 2 per spec).
- Follow the existing inline bank-entity pattern (food/recipe/provider/workout_format) rather than inventing new machinery.
- Indicators are typed per the domain catalog; unknown = absent/null; `declined` is a validated value.
- Preserve unrelated working-tree edits and ledger rows.

Key decisions:
- One family `habitat` covering all domains; `domain` is a record attribute (environment | workspace | exercise).
- Catalog lives in `packages/contracts` as a typed constant (domains → aspects → indicators with priority, question, target).
- Coverage is a pure function over (catalog, entities); no stored state.

State:
- Complete. Data foundation landed in commit `18f0239a4`; CLI write/read surface (`vault-cli habitat save/show/list/coverage/catalog`) implemented over a new `core/bank/habitat` registry module with merge semantics for indicators (`null` clears, `declined` respected, per-indicator recordedAt).

Done:
- Product spec landed (`agent-docs/product-specs/habitat.md`, PR #357).
- Contracts: `habitat` bank family (prefix `hab`, `bank/habitat`, frontmatter schema with catalog-aware indicator validation), `HABITAT_CATALOG` (10 aspects, 52 indicators), `computeHabitatCoverage`, schema artifacts regenerated, focused tests (contracts 139 pass).
- Query: canonical family + collector + read-model view `habitatAspects` + browser-replica inclusion + `listHabitatAspects/readHabitatAspect/showHabitatAspect` (query 386 pass; assistant-runtime replica test pass).
- Downstream fixtures patched; typechecks clean in contracts/query/vault-usecases/cli/assistant-engine/assistant-runtime/apps-web; e2e smoke: markdown aspect file → readVault → coverage.

- CLI: `core/bank/habitat.ts` (upsert with catalog validation + audit action `habitat_upsert`), public-mutations lock wrapper, `packages/cli/src/commands/habitat.ts` (bindingMode "none", memory-command pattern), manifest/routing/lazy-root registration; live smoke on an initialized vault: save → merge → clear-with-null → show/list → coverage (top gaps correct) → catalog. Core suite 518 + 2 habitat tests; cli suite 1027; contracts artifacts regenerated (audit-record).

Now:
- Ready for scoped commit.

Next:
- Phase 2 per spec: coverage snapshot in assistant prompt + opportunistic collection guidance + onboarding hook.

Open questions (UNCONFIRMED if needed):
- None blocking.

Working set (files/ids/commands):
- packages/contracts/src/{constants,zod,shares,bank-entities,vault-families}.ts, new habitat catalog module
- packages/query/src/{canonical-entities.ts,browser-replica/shared.ts,...}
- packages/cli/src/commands/*, packages/vault-usecases/src/usecases/*
- pnpm --dir packages/contracts test; packages/query + assistant-runtime replica tests
Status: completed
Updated: 2026-07-08
Completed: 2026-07-08
