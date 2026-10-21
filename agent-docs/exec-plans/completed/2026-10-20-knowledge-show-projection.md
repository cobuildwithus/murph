# Avoid duplicate knowledge page content in CLI reads

Status: completed
Created: 2026-10-20
Updated: 2026-10-20

## Goal

Return complete knowledge evidence once in ordinary CLI reads, preserving raw
file export and the exact revision used by internal compare-and-set writes.

## Evidence and design

The existing CLI returns rendered body and stored Markdown together. A synthetic
page with repeated neutral facts produced 68,573 bytes; removing only the duplicate
Markdown produced 34,379 bytes. This measures output size, not tokens or savings.
The existing CLI is the presentation owner. Derive its schema from the strict
query contract and omit Markdown at that boundary unless `--raw` is requested.
Keep the internal service, persisted pages, digest, errors, and CAS owner unchanged.
No new service, state, cache, dependency, or truncation policy is needed.

## Product UX

- Outcome: complete saved evidence with less repeated tool output.
- Reaches: ordinary and optional CLI reads; operators can explicitly request raw files.
- Proof: default/raw/optional reads, missing/degraded behavior, exact digest, and one
  synthetic assistant question answered from a saved page without writes.

## Tasks

1. Adjust only the show presentation schema and CLI output; preserve strict internal reads.
2. Migrate raw-output consumers and prove ordinary, optional, and explicit raw behavior.
3. Run focused tests, package typechecks, built CLI and real assistant proof, and complexity guard.
4. Inspect privacy and scope, close the plan, commit, and open a draft PR for parent review.

## Deployment and risk

The CLI and its output schema ship in one runtime bundle; old bundles retain the
larger shape and new bundles retain all semantic content. No persisted or remote
protocol changes. Explicit raw mode preserves exact-file tooling. Internal CAS
consumers stay untouched. The main risk is an undiscovered CLI consumer of
`page.markdown`; repository searches and command tests cover known consumers.

## Verification

- Query contract tests: 4 passed, including strict internal raw requirements and optional CLI Markdown.
- Focused CLI boundary, package-shape, built CLI, missing/degraded reads, and telemetry: 22 passed.
- Internal guarded-upsert, exact Markdown read, and optional absence tests: 3 passed.
- Query, CLI, and assistant-engine package typechecks passed.
- `pnpm complexity:diff --base origin/main` passed; no changed-function hotspots.
- Built CLI synthetic output: 112,841 bytes with raw Markdown versus 56,710 bytes
  by default (49.7% smaller). The complete body, exact digest, and stored file match.
- Focused real-Codex journey passed on gpt-6.1-sol through local subscription auth:
  one default page read, complete accurate answer, no raw expansion, no writes or
  outbox entries. Reply review: Ready.
- CLI config, generated types, and skill hash regenerated; package-shape proof passed.
- Initial bootstrap remains the same command index: knowledge is not a detailed
  hot-path signature. Only subsequently requested help/schema and read output change.
- Required exact-head CI and final review remain parent-owned; draft PR handoff only.
Completed: 2026-10-20
