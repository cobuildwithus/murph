# Codex Process Identity Env

## Goal

Make warm Codex App Server process identity use one explicit environment projection
for hosted and non-hosted execution.

Success means non-hosted turns no longer hash ambient process env into warm
process identity, hosted behavior stays on the same curated primitives, and
turn-scoped or incidental env changes cannot silently become process identity.

## Constraints

- Keep Codex prompt, session, and turn facts as request data, not process env.
- Keep the warm-process lifecycle single-slot and simple.
- Preserve unrelated active work in this checkout.
- Do not expose secret values or local identifiers in diffs or logs.

## Plan

1. Inspect existing hosted and non-hosted env shaping.
2. Add one explicit Codex process identity env projection.
3. Use that projection for hosted and local identity hashing.
4. Add focused regression coverage for unrelated env churn.
5. Run focused tests, typecheck, required audits, and finish through the repo
   commit path.

## Verification

- Focused assistant-engine Codex runtime tests.
- Assistant-engine typecheck.
- Scoped `test:diff` for touched files.
