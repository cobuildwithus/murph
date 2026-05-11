# Murph Age CLI report

Status: completed
Created: 2026-05-11
Updated: 2026-05-11

## Goal

- Add a small read-only CLI surface that returns the existing public Murph Age calculator report for a vault input bundle.
- Keep product mode gated: current research/internal model cards must abstain unless the model-card authorization policy explicitly allows product display.

## Success criteria

- `murph age report` reads canonical/query-projected vault data through the existing Murph Age query helper.
- The command accepts explicit `--as-of`, chronological age, sex, and mode inputs.
- Product mode returns a safe public abstention/report boundary when model cards are not product authorized.
- Research mode can expose research-only public reports when local ignored model-card artifacts and matching vault evidence are present.
- Tests cover product abstention and research-only output without row/value leakage in the public report.

## Scope

- In scope: CLI command registration, command output schema, generated CLI schema/type metadata, focused CLI tests, manifest metadata.
- Out of scope: new model science, new model-card authorization tiers, web UI, data importers, recommendation/protocol claims, and ReviewGPT gating for local command plumbing.

## Current evidence

- `packages/query` already exposes `calculateMurphAgePublicReportFromVaultInputBundle`.
- `packages/health-metrics` already strips point ids, raw values, internal assessments, and source internals from the public report.
- Current model-card policy requires promotion-grade evidence before product authorization.

## Decisions

- Do not create a new scoring pathway in the CLI.
- Use the public report helper as the only command output boundary.
- Default mode should remain product, with research mode explicit.
- Keep the command read-only.

## Verification plan

- Focused CLI command tests.
- `pnpm --dir packages/cli typecheck`.
- CLI package coverage or truthful diff coverage.
- `pnpm typecheck`, `pnpm test:smoke`, and `git diff --check`.
- Required security/privacy, coverage, and final-review audits before closeout.
Completed: 2026-05-11
