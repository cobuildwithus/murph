# Bundled CLI query timing: one installed owner

Status: implementation handoff complete; parent acceptance evidence pending.
Created: 2026-09-09. Closed: 2026-09-09.

## Goal and boundary

Restore the already documented query phases to the existing bounded private-safe
CLI timing report at the hosted runner's `.bundle/bin.js` boundary. The requested
base is `728d0b15631f15495d62775dffa8f2110c366315`; implementation uses the supplied
source archive. The archive contains no Git metadata, lockfile, installed
workspace dependencies or built artifacts, so its ancestry and correspondence to
the named checkout were not independently verified.

Parent owns testing/evidence, Git, PR, final review and deployment. This record
closes author implementation only; it does not mark acceptance, readiness or
rollout complete. No commit or external repository mutation was performed.

## Decisions and implementation

- [x] Trace the literal CLI import, variable native query loader, installed timing
  import and shared runner bundle policy. Reproduce isolated versus shared
  module state using the actual production timing owner before repository edits.
- [x] Externalize only `@murphai/runtime-state/node/cli-timing` and add its
  installed implementation to the existing shared forbidden-input guards.
  Keep the lazy CLI import, all other runtime-state entrypoints, budgets,
  collectors, timing vocabulary, caps, unknown/loss semantics and CLI behavior.
- [x] Extend existing bundle tests with an actual esbuild negative control,
  successful synthetic native query read, actual production CLI bundle step,
  retargeted wrappers, private-safe report normalization and disabled parity.
  Test a relative-import bypass against both bundle guards.
- [x] Extend the existing opt-in hosted gate to accept the assembled `.bundle`
  entry and require its successful installed `dist` baseline as well as enabled
  and disabled bundle parity. Retain real query/transport and phase-isolation
  assertions; add deterministic rejection cases for the third child.
- [x] Update the live observability owner and index with artifact prerequisites,
  compatibility, unknown pre-fix absence and parent-owned normal-traffic 72h
  measurement. No generated production output changes are required by this diff.

No optimization, new fields, collector, dependency, global registry, process
output or runtime authority is introduced. Synthetic test-only report files use
the existing report shape and callback, not an additional production transport.
Member-visible behavior is intentionally unchanged, so no member changelog is
warranted.

## Author evidence and limitations

The pre-edit local mechanism reproduction transpiled the unchanged production
node timing owner/catalog, installed their public exports, and modeled an
additional bundled copy. Variable native query loading lost all of
`query-freshness`, `query-manifest` and `query-status` in the split case and
preserved `setup`, `dispatch`, `post-dispatch`, `teardown` and `total`. Sharing the
installed owner restored all three query phases. Every case returned the same
successful synthetic value and exit status; telemetry-disabled cases emitted no
report. This **was not an esbuild execution** or production assembled CLI proof.

Available local checks used Node 22.16.0 and TypeScript 5.8.3, below the repository's
supported toolchain: syntax transpilation of all changed TypeScript passed;
11 unchanged timing tests passed after scratch-only transpilation and adapting
the runner import from Vitest to Node's test runner; two extracted deterministic
hosted parity assertion tests passed. The extracted three-child launcher and
validator also executed successfully with synthetic entries (not esbuild output).
These are bounded author checks, not the
repository Vitest suites or a project typecheck. Missing esbuild, pnpm, installed
workspace dependencies and failed registry access prevented the actual bundle
fixture, project typechecks, production assembly and pinned-Codex hosted gate.
No elapsed-time, byte-budget, deployment or production measurement is claimed.

## Parent validation still required

- [ ] Confirm the clean candidate base and apply the complete patch.
- [ ] On supported Node/pnpm, build the candidate public timing exports and run
  both runner bundle tests per the live observability owner. Observe the actual
  esbuild negative control losing query phases, corrected bundle/wrappers
  retaining them, identical successful output/exit and disabled no-op.
- [ ] Run the focused source tests and typechecks below, preserving isolation,
  bounds, late-work exclusion, native failure and cancellation behavior.
- [ ] Run canonical Linux production assembly without overrides. Preserve entry,
  static-closure and existing exact-first-parent total-output budget gates.
- [ ] Run the opted-in hosted timing gate against that intact assembled
  `.bundle/bin.js` artifact, per `docs/hosted-runtime-log-database.md`, not merely
  checkout source or `dist/bin.js`. Retain real cold/warm and private-safe report
  evidence. Run existing diff/complexity/docs checks and exact-head CI.
- [ ] Complete parent final review, Git/PR and deployment decisions. Observe 72h
  of ordinary traffic only after rollout; missing old spans remain unknown.

Focused commands from the repository root, after ordinary dependency preparation:

```sh
pnpm --dir packages/runtime-state test
pnpm --dir packages/query exec vitest run --config vitest.config.ts --no-coverage \
  test/query-projection-concurrency.test.ts
pnpm exec vitest run --config packages/cli/vitest.workspace.ts --no-coverage \
  packages/cli/test/cli-timing.test.ts packages/cli/test/cli-entry.test.ts \
  packages/cli/test/batch.test.ts packages/cli/test/batch-protocol-error-stages.test.ts \
  packages/cli/test/vault-cli-import-surface-contract.test.ts
pnpm --dir packages/assistant-engine exec vitest run --config vitest.config.ts --no-coverage \
  test/cli-timing-transport.test.ts test/cli-timing-profile.test.ts
pnpm --dir packages/assistant-runtime exec vitest run --config vitest.config.ts --no-coverage \
  test/hosted-runtime-codex-config.test.ts -t 'shared CLI timing'
pnpm --dir packages/runtime-state typecheck
pnpm --dir packages/query typecheck
pnpm --dir packages/cli typecheck
```

The live observability owner contains the bundle test/typecheck commands and
full assembled-artifact preparation command. The default source run above skips
only the existing opt-in artifact gate; that skip is not acceptance evidence.
