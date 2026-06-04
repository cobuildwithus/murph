# CLI Output Diet

## Goal

Reduce default CLI output size for the high-token hosted assistant paths:
Health Commons search, Health Commons protocol show, and timeline reads.

Success means the default outputs are materially smaller, still preserve the
fields needed for discovery/setup, and direct detail reads remain available
through existing commands instead of new output modes.

## Scope

- Change `packages/cli` command defaults/output shape, generated config schema,
  and the matching command-surface contract.
- Add focused CLI tests for the smaller defaults and retained detail paths.
- Do not add new persistent state, dependencies, services, or broad output
  framework changes.
- Preserve unrelated assistant prompt and hosted reset script edits.

## Plan

1. Shrink `commons search` default result count.
2. Make `timeline` default to a smaller index-style result and remove broad
   per-entry data from the CLI response.
3. Make `commons protocol show` return setup-relevant protocol detail by
   default while leaving full generic entity detail available through
   `commons get`.
4. Regenerate CLI config schema; generated input types stay unchanged unless
   argument or option shapes change.
5. Add or update focused CLI tests.
6. Run required CLI verification and completion audits.

## Verification

- Initial verification before the concurrent experiment-onboarding checkout
  changes:
- `pnpm --dir packages/cli test commons-command-coverage.test.ts search-command-coverage.test.ts`
  - Passed.
- `pnpm typecheck`
  - Passed.
- `pnpm test:diff packages/cli/src/commands/commons.ts packages/cli/src/commands/search.ts packages/cli/test/commons-command-coverage.test.ts packages/cli/test/search-command-coverage.test.ts`
  - Passed.
- `pnpm --dir packages/cli gen:config-schema`
  - Passed; regenerated `packages/cli/config.schema.json` for the changed
    defaults.
- `git diff --check -- packages/cli/src/commands/commons.ts packages/cli/src/commands/search.ts packages/cli/test/commons-command-coverage.test.ts packages/cli/test/search-command-coverage.test.ts agent-docs/exec-plans/active/2026-06-04-cli-output-diet.md agent-docs/exec-plans/active/COORDINATION_LEDGER.md`
  - Passed.
- Completion audits:
  - Coverage-write added narrower assertions for omitted protocol-show fields
    and retained `commons get` detail.
  - Task-finish review found stale `timeline` contract docs; fixed in
    `docs/contracts/03-command-surface.md`.
- Final post-audit reruns:
  - `pnpm --dir packages/cli test search-command-coverage.test.ts`: Passed.
  - `git diff --check -- packages/cli/src/commands/commons.ts packages/cli/src/commands/search.ts packages/cli/test/commons-command-coverage.test.ts packages/cli/test/search-command-coverage.test.ts packages/cli/config.schema.json docs/contracts/03-command-surface.md agent-docs/exec-plans/active/2026-06-04-cli-output-diet.md agent-docs/exec-plans/active/COORDINATION_LEDGER.md`: Passed.
  - `pnpm --dir packages/cli test commons-command-coverage.test.ts search-command-coverage.test.ts`: Blocked by concurrent experiment-onboarding schema/content changes outside this task; `search-command-coverage.test.ts` passed in the same run, while Commons catalog parsing failed on `experimentOnboarding.schemaVersion`.
  - `pnpm typecheck`: Blocked by concurrent experiment-onboarding contract changes outside this task (`packages/contracts` test expects fields removed by that separate work).
  - `pnpm test:diff packages/cli/src/commands/commons.ts packages/cli/src/commands/search.ts packages/cli/test/commons-command-coverage.test.ts packages/cli/test/search-command-coverage.test.ts packages/cli/config.schema.json docs/contracts/03-command-surface.md`: Blocked at CLI typecheck by the same separate experiment-onboarding schema change in `packages/cli/src/commands/experiment.ts`.
- Manual output-size probes:
  - `commons search "it band" --format json`: 5 hits, about 6.8 KB.
  - `commons protocol show <IT-band protocol key> --format json`: about 10.5 KB, no raw `body`, no onboarding `contextReview`, no test plans in the default response.
  - `timeline --format json --entry-type event --kind activity_session --from 2026-06-01`: default limit 50 and no per-entry `data` field.
Status: completed
Updated: 2026-06-04
Completed: 2026-06-04
