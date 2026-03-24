Goal (incl. success criteria):
- Audit the Incur-backed CLI surface for correctness and robustness, then land focused hardening patches for any concrete bugs uncovered during the review.
- Success means the root CLI path awaits asynchronous execution, saved/default vault injection covers every manifest-backed root command that requires `--vault`, and repeatable enum-style filters reject unsupported values instead of silently ignoring them.

Constraints/Assumptions:
- Preserve the existing command topology and public command names; this is a hardening pass, not a surface redesign.
- Keep error messaging and filter normalization behavior operator-friendly, especially for repeated flags and comma-delimited token mistakes.
- Local verification is limited because the provided container does not currently match the repo's documented Node/pnpm toolchain.

Key decisions:
- Fix concrete runtime bugs first (`bin.ts` awaiting and missing default-vault roots) before making any validation-tightening changes.
- Reuse a shared repeatable-option helper so `search`, `timeline`, and generic `list` validate consistently.
- Add regression tests around default-vault routing drift and unsupported filter values rather than expanding into broader command-manifest refactors during this pass.

State:
- completed with unrelated repo verification failures still open in other lanes

Done:
- Reviewed the Incur entrypoints, manifest wiring, generated command typings, and the existing smoke/default-vault tests.
- Identified three concrete issues to patch: missing `await` on the main `cli.serve(...)` path, missing `device`/`workout` coverage in default-vault auto-injection, and silent dropping of unsupported repeatable filter values.
- Landed the runtime hardening changes, switched `search.ts` to reuse `ALL_VAULT_RECORD_TYPES`, and added targeted regression coverage for default-vault injection plus unsupported repeatable filters.
- Ran `pnpm typecheck` successfully.
- Ran `pnpm test` and `pnpm test:coverage`; both failed for pre-existing unrelated issues in other active lanes, including assistant/channel regressions, contract/core/query export/type errors, and the existing coverage temp-file fanout failure.
- Ran focused sanity checks for default-vault injection/manifest alignment and repeatable-enum validation via `pnpm exec tsx --eval ...`; both passed.

Now:
- None.

Next:
- Keep the broader repo verification repair and coverage-temp stabilization in their existing active lanes; no further change is required for this CLI hardening slice.

Open questions (UNCONFIRMED if needed):
- UNCONFIRMED: whether the repo wants a future follow-up to make `--schema`/generated typings reflect enum-valued repeatable filters more precisely, since the most operator-friendly validation path currently lives in runtime helpers.

Working set (files/ids/commands):
- `agent-docs/exec-plans/active/2026-03-24-incur-cli-hardening-review.md`
- `agent-docs/exec-plans/active/COORDINATION_LEDGER.md`
- `packages/cli/src/bin.ts`
- `packages/cli/src/operator-config.ts`
- `packages/cli/src/option-utils.ts`
- `packages/cli/src/commands/search.ts`
- `packages/cli/src/usecases/integrated-services.ts`
- `packages/cli/test/assistant-cli.test.ts`
- `packages/cli/test/search-runtime.test.ts`
- `packages/cli/test/list-cursor-compat.test.ts`
