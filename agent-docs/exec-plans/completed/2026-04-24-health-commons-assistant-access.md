# Health Commons Assistant Access

## Goal

Give Murph first-class read-only assistant access to the Health Commons corpus, while preserving the product distinction between public protocol variants, private user protocol forks, and time-bounded experiments.

Success criteria:

- Hosted-safe assistant tool catalogs expose read-only `healthCommons.*` tools.
- Assistant prompts direct protocol discovery through Health Commons, not private `vault-cli protocol` records.
- `vault-cli protocol` remains the private user protocol registry, with optional Health Commons provenance added where useful.
- CLI parity exists under a distinct Health Commons/commons namespace instead of overloading `protocol`.
- Hosted runner/published CLI bundle paths can import the Health Commons generated catalog.
- Tests cover tool catalog visibility, Health Commons lookup behavior, prompt regression, CLI command behavior, and bundle closure.

## Constraints

- Preserve unrelated dirty work in the shared checkout.
- Do not expose personal identifiers, local paths, secrets, raw auth headers, or real contact identifiers in code, docs, tests, logs, commits, or handoff.
- Use `@murphai/health-commons` public package entrypoints/subpaths; do not reach into another package internals.
- Keep Health Commons assistant tools read-only and compact by default.
- Do not rename or repurpose `vault-cli protocol`; clarify and extend it as a private user protocol/adaptation surface.

## Product Model

- Health Commons `protocol_variant`: public source-backed reference protocol.
- Vault protocol: private user adaptation/fork, optionally derived from a Health Commons protocol variant and customized with user-specific dose, schedule, duration, device, safety notes, or constraints.
- Experiment: private time-bounded evaluation run, with hypothesis, run plan, metrics, adherence, and outcome. It may reference either a public Health Commons protocol directly or a private user protocol fork.

## Implementation Plan

1. Add shared Health Commons catalog reader/search helpers in `packages/health-commons`.
2. Add read-only native assistant tools in `packages/assistant-engine`.
3. Update assistant prompt guidance and prompt tests.
4. Add CLI parity under a distinct Health Commons/commons namespace.
5. Wire package dependencies, generated catalog path support, and hosted runner/published CLI bundle expectations.
6. Extend private vault protocol schema/commands only as needed for Health Commons provenance.
7. Add focused tests and run the required scoped verification plus completion-workflow audits.

## Verification Plan

- `pnpm typecheck`
- `bash scripts/workspace-verify.sh test:diff <touched task paths>`
- Focused assistant-engine, health-commons, CLI, and Cloudflare runner bundle tests as needed during iteration.
- Completion workflow: `coverage-write` audit when coverage-bearing verification is selected, then `task-finish-review`.

## Open Questions

- Preferred CLI root: `commons` only, `health-commons` only, or `commons` with `health-commons` alias.
- Whether private vault protocol provenance should land in this same slice or follow after first-class assistant corpus access.
Status: completed
Updated: 2026-04-24
Completed: 2026-04-24
