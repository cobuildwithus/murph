# Remove Personal Patterns feature and managed automation

Status: active
Created: 2026-10-19
Updated: 2026-10-19

## Goal

Remove the Patterns page, its managed automation, and feature-specific query,
CLI, replica, presentation, and alert infrastructure. Preserve Journal,
wearables, member-authored automations, and historical canonical records.
Environment is outside this task.

## Success criteria

- Patterns has no live navigation, route, report calculation, or CLI command.
- Existing managed Patterns jobs retire through the existing scheduler owner;
  no replacement seed or model turn is admitted.
- Journal remains usable without the Patterns vocabulary or insights.
- Shared automation/usage alerts, wearable queries, and replica loading retain
  focused regression coverage; affected tests and typechecks pass.

## Architecture and scope

Canonical events, knowledge pages, and automation records remain under existing
owners. Stop producing/reading the feature-specific derived report instead of
introducing another state store or migration framework. Old derived pages stay
as historical member data; no bulk data deletion is part of this change.
The existing retired managed automation IDs archive the exact shipped job.
Shared Journal/goals icon assets remain because they have live consumers.

## Product UX

Outcome: the workspace no longer offers Patterns or spends usage on its daily
managed analysis. Existing members lose its navigation and Journal insight
links; new members receive no seed. Bookmarked removed routes use normal
not-found behavior. Journal and ordinary wearable summaries remain available.
The companion endpoint is retired with the feature; independently shipped old
clients require release coordination and may see its standard missing route.
Proof: route/sidebar tests, journal/replica tests, existing-job retirement,
ordinary automation execution, and package/Web typechecks.

## Tasks

1. Inventory with Claude and verify source dependencies.
2. Delete query/report/CLI plumbing; retain deterministic Journal labels.
3. Remove Web surfaces and feature-only monitoring.
4. Retire managed jobs and delete scheduling/eligibility exceptions.
5. Update durable docs and changelog; inspect all remaining references.
6. Run focused proof, review privacy and complexity, and commit the scoped result.

## Verification

Passed focused query, vault-usecases, CLI, assistant-engine/runtime, runtime-state,
Web, and Cloudflare tests; affected package/app typechecks; Web lint (existing
warnings only); docs drift; complexity guard (no added debt). The two local
PostgreSQL suites passed 19 cases, including the changed automation-loss SQL.
Retirement proof covers active/paused records, fresh vaults, scheduler rejection,
and pending outbox rejection before provider entry. Legacy replica report fields
are ignored without losing Journal. Member-authored same-slug jobs survive.

The existing Journal Playwright journey passed at 320, 390, and 1280 pixels,
including calendar keyboard interaction and sleep charts. Screenshots reviewed.
The focused real-Codex weekly-insight retirement journey passed on GPT-6.1 Sol
with local subscription auth: skip, no tool calls, no member message. Initial
profiles failed before any action; the authorized alternate-profile retry passed.
UX verdict: Ready for the tested unchanged-evidence quiet path.

Complete first-provider request capture with identical base/head fixtures:
individual 179,620 -> 179,261 UTF-8 bytes (-359, -0.1999%); group 155,434 ->
155,434 bytes. Actual native Codex serialization, production prompt builders,
dynamic tools and delegation configuration; excludes transport prompt_cache_key.
No exact target tokenizer is configured, so token counts are unavailable.

Claude inventoried the feature, helped remove its runtime and Web owners, and
reviewed the remaining source. Its findings were stale generated CLI artifacts and two retired-feature wording
references. These are corrected. The existing generator reuse path refreshed
CLI artifacts from the built command tree; its diff only removes the command
and changes the skill hash. Full prepared-runtime build admission is still
waiting on another worktree's verification.
A public-safe Frog entry records the generator's hidden admission-wait progress.

Remaining: full build admission, preview URL, PR CI, and final-head ReviewGPT.

## Deployment

Web and runtime changes must converge together. Already-running older runtimes
can retain the old recipe until replaced. The new runtime uses existing
retirement before scheduled work; no production mutation is performed locally.
Old Browser Vault reports are ignored on read and disappear on next publication.
Rollback to old code would reintroduce the feature; historical data is preserved.
