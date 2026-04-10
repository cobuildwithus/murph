# CLI List Summary Architecture

## Goal

Replace the current global list-item markdown stripping with a cleaner list-vs-show architecture. `list` results should use an explicit summary entity contract, body-owning families should expose compact excerpts instead of full markdown, and model-facing CLI execution should continue to avoid duplicate JSON transport.

## Why now

- The previous fix reduced model payload size quickly but used a shared post-processing strip in `asListEnvelope`, which is too blunt for body-owning families.
- Audit work showed some list surfaces hide essential page/provider body content unless a caller follows up with `show`.
- The command surface should reflect the repo architecture more directly: orientation data in `list`, canonical detail in `show`.

## Scope

- Define a dedicated list-entity schema/type separate from `readEntitySchema`.
- Remove shared post-processing that strips `markdown` from every list row.
- Add explicit list serializers for generic read surfaces and affected family-specific list paths.
- Preserve `show` behavior.
- Keep the already-landed `vault.cli.run` parsed-JSON dedupe.

## Constraints

- Do not touch unrelated `packages/core/**` runtime work in the dirty tree.
- Avoid changing incur-owned transport behavior; this is Murph payload shaping only.
- Keep list output compact but non-lossy for body-owning families by using bounded summaries/excerpts instead of full bodies.

## Expected proof

- Scoped typecheck and coverage-bearing tests for touched owners.
- Focused CLI/runtime assertions that list responses no longer contain `markdown` but still retain compact body orientation where required.
Status: completed
Updated: 2026-04-10
Completed: 2026-04-10
