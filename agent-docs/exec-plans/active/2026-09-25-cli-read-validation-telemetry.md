# CLI read validation telemetry

Status: active — implementation complete; parent validation pending
Created: 2026-09-25
Updated: 2026-09-25

## Outcome and boundary

Retain one finite field/code/missing diagnostic for rejected `knowledge show`
and `event payload-schema` inputs through the existing runtime-state allowlist.
The original typed fields already exist; the gap is observation, not a proven
prompt defect. No new owner, state, parser, schema, runtime query, retry, provider call,
command behavior or changelog entry. Preserve existing privacy and transport bounds.

## Implementation

- [x] Trace schemas, original-error emission, normalized reader and automation-list proof.
- [x] Add only `knowledge show: slug` and `event payload-schema: kind, for` to the production allowlist.
- [x] Extend finite-field/privacy tests, native timing parity controls and actual old-reader compatibility proof.
- [x] Update the validation owner's bounded natural-traffic query and consumer-first rollout guidance; index this plan.

## Validation handoff

Supplemental checks ran: the runtime-state test file under a temporary Node test
adapter passed 30 tests; four history-gated tests skipped. Two focused tests fail
against the unchanged snapshot owner and pass after the allowlist extension.
Five actual snapshot-old/current-reader compatibility cases also passed. This is
not a Vitest or Git-history-backed run. The three changed TypeScript files parse.

Repository-native validation is pending. The snapshot has no Git history or
installed dependencies/pnpm, and available Node is below the declared runtime.
`scripts/frog list` was attempted but cannot run without the installed dependency;
the Frog skill is absent. No production traffic, commits, PRs or deployment were
created. The parent owns verification, the commit/PR, final ReviewGPT, gates and
plan closure. No production trigger or live-model journey is needed.

Run from a supported checkout with dependencies and the named base in Git history:

```sh
MURPH_CLI_READ_VALIDATION_COMPAT_BASE=85d536703736f3553105e01120f5560a25b732e4 \
  pnpm exec vitest run --config packages/runtime-state/vitest.config.ts --no-coverage packages/runtime-state/test/cli-timing.test.ts
pnpm exec vitest run --config packages/cli/vitest.workspace.ts --no-coverage packages/cli/test/cli-timing-subprocess.test.ts
pnpm --filter @murphai/runtime-state typecheck
pnpm --filter @murphai/murph typecheck
pnpm complexity:diff
pnpm docs:drift
```

Deploy compatible Web/reader consumers before runner producers; verify both
source/bundle versions, including warm runners, before observing natural failures.
Old readers drop only new detail; null/absent detail is not evidence of health.
