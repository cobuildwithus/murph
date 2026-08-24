# Vault CLI public-path boundary remediation

Status: completed
Owner: Codex
Started: 2026-08-24

## Goal

Make model-facing Vault CLI recovery metadata explicitly owner-authored. Domain
owners may expose only finite public field paths and generic recovery stages;
raw validation paths, dynamic record keys, stored-state paths, provider
responses, and arbitrary exception text remain private.

## Success criteria

- `VaultCliError.context.issues` produces field guidance only from an explicit
  `publicPath`; legacy/raw `path` is ignored.
- Escaped raw Zod failures keep a fixed validation code, message, and stage but
  expose no field paths.
- Known errors preserve only the fixed generic `validation`, `read`, `write`,
  `configuration`, `authorization`, `transport`, `response`, `filesystem`,
  `render`, `persistence`, `conflict`, or `integrity` stages, and issue presence
  never manufactures or overwrites a stage.
- Blood-test result/link, typed workout assembly, and typed scheduled-log
  workout/food fields publish finite owner-mapped paths. Workout validation
  points back to the owning public option (`workoutSet`, `workoutExercise`,
  `workoutMedia`, or the matching scalar option), not an internal assembled
  workout-object path.
- Stored workout-state and device-service response failures remain neutral.
- Existing safe outcomes for invalid public-corpus status (native Incur enum
  validation), a duplicate regimen slug (field-specific), ambiguous or
  conflicting regimen identifiers (field-neutral), and unavailable interactive
  chat input remain typed and useful without arbitrary-message projection.
- Direct, full-output, built-Incur, setup-bridge, no-echo, and no-write proof
  exercises the boundary.

## Constraints

- Keep one pure projection owner in `@murphai/operator-config`.
- Add no repair abstraction, registry, state owner, dependency, or generic
  context serializer.
- Do not mutate or push the existing foundation PR while its review is active.
- Preserve child-PR-owned recovery metadata for later integration rather than
  broadening this isolated preparation patch.

## Work summary

1. Replace raw path inference with explicit `publicPath` projection and a small
   stage allowlist.
2. Add finite field mappings at the direct submitted-input owners and remove
   misleading metadata from internal/stored/provider failures.
3. Typed the safe release outcomes at their existing owners, including a
   field-specific duplicate-slug collision and a field-neutral ambiguous or
   conflicting regimen-identifier collision.
4. Update the canonical CLI architecture note and focused regression coverage.
5. Run focused tests, affected typechecks, package/bundle/privacy checks, inspect
   the final diff, and close with `scripts/finish-task` on the isolated branch.

## Product UX Patch

- Affected people: local or hosted model callers correcting structured CLI
  input, and terminal users receiving a safe deterministic command failure.
- Intended result: callers receive only actionable fields the domain owner can
  prove public, with truthful phase information and no submitted, stored, or
  provider-derived identifier leakage.
- Recovery: submitted validation can be corrected; stored, provider, and
  unowned failures remain neutral and cannot be mistaken for input errors.
Updated: 2026-08-24
Completed: 2026-08-24
