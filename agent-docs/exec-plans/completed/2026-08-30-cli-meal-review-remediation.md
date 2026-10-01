# Preserve actionable nested meal import diagnostics

Status: completed
Created: 2026-08-30
Updated: 2026-08-30

## Goal

- Keep unknown top-level `meal import-json` fields private while preserving
  concrete nested schema diagnostics that let an agent correct and retry once.

## Success criteria

- Root-level unknown fields still return generic unsupported-field copy without
  echoing the submitted key, value, or input path.
- A synthetic typo under `nutrition.micros` retains its concrete nested path and
  schema correction instead of being flattened to a generic message.
- Differing `photo`/`photoPath` or `audio`/`audioPath` values reject before a
  write with fixed field guidance; equal aliases remain accepted.
- Validation failures expose the existing safe `validation` stage and bounded
  public field-error projection without submitted values or paths.
- The rejected command writes no meal.
- One production-derived real-Codex journey makes exactly one rejected import,
  exactly one corrected retry, and exactly one meal write with no duplicate.
- The focused deterministic suite, focused live journey, and touched-owner
  typechecks pass.

## Product UX

- Effort: Product UX Patch.
- Affected person: an assistant logging a structured private meal whose first
  payload contains one unsupported top-level field and one nested micronutrient
  typo.
- Ordinary entry: a private request to log a fully specified meal.
- Last observable boundary: one canonical meal write plus one concise truthful
  completion reply after the corrected retry.
- Recovery: the first call fails before persistence, gives a useful nested
  correction without disclosing the root field, and permits one corrected call.

## Scope

- In scope:
  - Root-only sanitization in the existing meal schema issue formatter.
  - Pre-write conflict validation for the two documented path alias pairs.
  - Reuse of the existing structured validation-error projection.
  - A deterministic real-command regression for mixed root and nested issues.
  - One focused production-prompt and food-journal-skill live journey.
- Out of scope:
  - New meal fields, nutrition semantics, automatic correction, or retries in
    the CLI itself.
  - Changelog semantics beyond the existing top-level typo rejection outcome.

## Tasks

1. Narrow generic issue formatting to root-level unknown fields.
2. Reject differing media-path aliases before persistence while preserving
   equal, canonical-only, and alias-only inputs.
3. Strengthen deterministic proof for nested guidance, alias conflicts,
   structured recovery, privacy, and zero writes.
4. Add and run one focused real-Codex reject-correct-write journey.
5. Run touched-owner typechecks, inspect the final diff and privacy boundary,
   then close the plan with the scoped remediation commit.

## Verification

- `pnpm exec vitest run packages/cli/test/meal-add-typed-parity.test.ts`
- `pnpm test:assistant:live -- --test "recovers one strict meal import typo without duplicate write"`
- `pnpm --filter @murphai/murph typecheck`
- `pnpm --filter @murphai/assistant-engine typecheck`
- `git diff --check`

## Outcome

- Root unknown fields retain fixed private-safe copy, while nested validation
  issues keep their concrete public field path and correction.
- Differing media alias pairs now fail before persistence with fixed recovery;
  equal aliases continue through the existing canonical projection.
- All validation failures reuse the existing bounded `validation` stage and
  public field-error projection instead of adding a second error contract.
- The focused real assistant recovered the synthetic malformed import with one
  rejected call, one corrected retry, exactly one meal write, and no duplicate.

## Reaches

- Production code: the structured `meal import-json` CLI validator only.
- Deterministic proof: the existing meal typed-parity suite.
- Live proof: one opt-in production-prompt and food-journal-skill journey.
- No importer, canonical writer, nutrition semantics, prompt, tool schema,
  generated CLI artifact, or changelog semantics changed.

## Proof

- `pnpm exec vitest run packages/cli/test/meal-add-typed-parity.test.ts`
  passed: 1 file, 13 tests.
- `pnpm --filter @murphai/murph typecheck` passed.
- `pnpm --filter @murphai/assistant-engine typecheck` passed.
- `pnpm test:assistant:live -- --test "recovers one strict meal import typo without duplicate write"`
  passed with `gpt-5.6-terra` and local subscription auth: two import attempts,
  one canonical write, and the concise reply `Dinner imported successfully.`
  Product UX verdict: Ready.

## Progress

- 2026-08-30: Accepted the specialist finding after confirming nested Zod
  `unrecognized_keys` issues carry the actionable `nutrition.micros` path.
- 2026-08-30: Accepted the parent cross-family finding that differing media
  aliases were silently resolved by precedence instead of failing closed.
- 2026-08-30: The first provider-reaching live run proved two import attempts
  and one write with a concise outcome-only reply; widened the truthful outcome
  matcher to accept the natural verb `imported` before the required same-home
  rerun.
- 2026-08-30: The same-home live rerun passed with one rejected import, one
  corrected retry, one write, no duplicate, and a truthful outcome-only reply.
Completed: 2026-08-30
