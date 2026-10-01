# CLI timing CI admission — active remediation plan

## Outcome and scope

Complete PR #2872's source, accounting and CI admission without changing tool
semantics or widening production budgets/permissions. Current input is committed
`19cc13128488627327f0725eef96c04b5547ce91` plus the two applied, uncommitted patches:
CI correction `d77d2ab131235ef14153d19a1634c8ae1ed46327ccfefc3d186b75d970ac16e3`
and usage budget `8f2f63095e6312bcade3b70f171895914b93e9e6b9bc325dff2bba3ed722081a`.
The final test correction is incremental against that cumulative tree. Historical
`completed/shared-cli-timing.md` is immutable. Parent owns validation, scoped
commit/PR updates and plan closure; this preparation does not mutate the PR.

## Existing owners and protected behavior

- Web's own paths map resolves the two public timing exports directly to source.
  Its resolver test uses Web's TypeScript API; annotate the returned
  `ResolvedModuleFull | undefined` to remove the supported checker's TS7022.
  No resolver/dependency change or cast is required.
- CLI entry/action use native lazy imports, preserving the single runtime-state
  ALS owner, Incur exit/error/EPIPE and batch/query accounting. The CLI Codex test
  now checks the process's one explicit shell timing setting, ephemeral port/key
  shape and unchanged exact process environment. Assertions must not print the
  generated endpoint. Existing JSON-RPC assertions remain unchanged.
- The existing scoped import ratchet owns runtime graph admission. Parent CI
  measured `condition list` at 303 versus its previous 300 ceiling. Admit exactly
  the two runtime-state timing modules and `node:dgram`; `node:async_hooks` already
  belongs to vault context. The package allowlist and other probe ceilings stay
  unchanged. No lazy transport split/cache is introduced to manipulate the count.
- The usage port still trims only copied optional summaries against the complete
  UTF-8 body; `droppedCalls`, counter-only retention and whole-field absence retain
  their existing meanings. Never discard mandatory accounting to fit. The shared
  16,384-byte request ceiling and 8,192-byte datagram limit are unchanged.

This delta changes tests and live verification documentation only. All production
bytes, workflows, dependencies, permissions, 20,000-byte entry and 33,200-byte
static-closure budgets remain unchanged. Privacy risk is assertion failure output,
not a new telemetry field or transport. No public changelog is needed.

## Evidence and remaining gates

**Parent-reported on the cumulative input, not rerun here:** 38 budget-focused
tests; hosted-execution build/typecheck; Cloudflare typecheck; CLI closure
build/typecheck; actual complexity guard (budget helper complexity 6). CLI
regressions passed in grouped/isolated reruns after a load timeout, not a claim of
one clean full coverage run. Web resolver runtime tests passed; Web typechecking
still reported the one TS7022 addressed here. Fresh-built native hosted proof
passed four tests with 50 skips and no Vite transforms. Canonical production
bundler helper measured static closure 26,384/33,200 bytes and entry 793/20,000;
all eight parity/JSON-surface probes passed. Full Linux assembly and the
exact-first-parent total-output ratchet remain CI-owned.

Retain the prior actual-base-consumer, synthetic SQL and warm benchmark evidence;
these test-only edits change none of their production inputs. Historical methods
and limitations remain in the completed timing plan and live owner documentation.

**Observed locally for this delta:** Node 22.16.0/global TypeScript 5.8.3, not the
supported Node/Web checker. The actual Web resolver callback passes against its
source paths; its isolated explicit typing passes strict TypeScript checking.
Thirteen isolated spawn-assertion checks pass using the actual receiver's launch
arguments and extracted current test assertions: valid settings, range boundaries,
missing/extra/malformed settings, exact environment and no endpoint-value leakage.
These are not the full JSON-RPC repository test.

A native resolve hook on the two unchanged, TypeScript-emitted timing owners
observes exactly four URLs: `runtime-state/dist/node/cli-timing.js`,
`runtime-state/dist/cli-timing.js`, `node:async_hooks`, `node:dgram`. Source comparison
confirms the original vault context already imports `node:async_hooks`; the wire
module has no imports. Thus the added subtree is three modules and zero packages.
The full built-command total of 303 is parent CI evidence, not a local rerun.

Repository Vitest, supported full typechecks and the built CLI graph probe could
not start here: pnpm/workspace dependencies and built artifacts are absent.
Do not treat these supplemental checks as exact-head CI or a completed native gate.

## Parent validation and completion

Run on the supported toolchain from the repository root:

```sh
pnpm exec vitest run --config apps/web/vitest.workspace.ts --no-coverage \
  apps/web/test/next-config.test.ts
pnpm --dir apps/web typecheck:prepared
pnpm exec vitest run --config packages/cli/vitest.workspace.ts --no-coverage \
  packages/cli/test/assistant-codex.test.ts
pnpm --dir packages/cli typecheck
# Use the current built CLI, not a source-loader replacement.
pnpm --filter @murphai/murph... build
pnpm exec vitest run --config packages/cli/vitest.workspace.ts --no-coverage \
  packages/cli/test/vault-cli-import-surface-contract.test.ts
node --import tsx scripts/check-cyclomatic-complexity.ts \
  --base 19cc13128488627327f0725eef96c04b5547ce91 --json
```

Require the direct built import-surface owner before pushing, including the
unchanged package allowlist, unrelated probe ceilings and no-optional-heavy-load
assertions. The comparison includes both prior uncommitted corrections. The live
`docs/hosted-runtime-log-database.md` contains the broader source/usage/native proof
commands. Parent retains its prior supported evidence and must obtain corrected
exact-head Web/CLI coverage, full Linux runner assembly/first-parent budget and all
routed CI/review gates before Ready. Keep this plan active until parent validation
and normal scoped closure. No commits, pushes, merges, deployments, production
actions or secret access are performed by ReviewGPT in this preparation turn.
Status: completed
Updated: 2026-09-05
Completed: 2026-09-05
