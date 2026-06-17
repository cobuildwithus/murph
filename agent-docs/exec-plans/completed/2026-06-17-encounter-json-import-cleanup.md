# Encounter JSON Import Cleanup

## Goal

Replace the ambiguous `encounter save --input` surface with a simple Incur-native shape for rich encounter bundles:

- `encounter scaffold` emits the canonical nested payload shape.
- `encounter import-json --input @file.json|-` imports that payload.
- Assistant guidance, command docs, generated types, and tests no longer advertise `encounter save`.
- The baseline invariants document the general rule: complex agent-visible `--input` payloads must be explicit JSON escape hatches with a paired Incur-discoverable shape path.

## Constraints

- Keep canonical health writes owned by `packages/core` through the existing vault-usecases path.
- Do not add a Murph-specific hidden payload-schema extension to Incur discovery.
- Keep the implementation narrow and composable; one payload schema/normalizer source should back runtime validation and scaffold examples where practical.
- Preserve unrelated worktree changes.

## Plan

1. Inspect the merged encounter command, payload normalizer, assistant prompt guidance, generated Incur map, and CLI tests.
2. Add `encounter scaffold`, rename/remove `encounter save` in favor of `encounter import-json`, and share the payload schema/normalization path.
3. Update docs, assistant guidance, smoke manifests, generated Incur types, tests, and the generalized command-payload invariant.
4. Run CLI-focused verification, typecheck, required completion audits, final review, then commit and push to `main`.

## Verification

- `pnpm --dir packages/cli verify:prepared-runtime`
- `pnpm --dir packages/cli gen:config-schema`
- `pnpm exec vitest run --config packages/cli/vitest.workspace.ts --no-coverage packages/cli/test/encounter-import-json.test.ts packages/cli/test/canonical-json-input.test.ts packages/cli/test/cli-typed-agent-inputs-schema.test.ts`
- `pnpm --dir packages/vault-usecases test -- test/encounter.test.ts test/public-entrypoints.test.ts`
- Direct built CLI scaffold -> import-json round trip against a temp vault.
- `pnpm exec tsx e2e/smoke/verify-scenario-integrity.ts --coverage`
- `git diff --check`
- `pnpm docs:drift`
- `pnpm typecheck`
- `pnpm test:diff`
- `security-privacy-review` completion audit: no findings.
- `coverage-write` completion audit: no findings and no file edits.
Status: completed
Updated: 2026-06-17
Completed: 2026-06-17
