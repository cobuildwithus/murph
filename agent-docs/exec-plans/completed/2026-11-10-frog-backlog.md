# Resolve the Frog friction backlog

Status: completed
Created: 2026-11-10
Updated: 2026-11-10

## Goal

Resolve the open Frog reports, verify existing fixes, and close only issues with concrete resolution evidence.

## Scope and protected boundaries

The initial inventory has 77 repository entries and 81 matching open issues, including five duplicate pairs. Work belongs at the existing tooling and fixture owners. Preserve production behavior, verification assertions, privacy, and unrelated work. The Frog Action remains the sole publication and reconciliation owner; do not manually rewrite its journal or take over its bot branch.

## Architecture and approach

Compare every report with current source and its introducing commit. Prefer removal of obsolete fixtures and correction of existing configuration over new mechanisms. Already shipped fixes need source and focused proof before closure. Changes are isolated in this task checkout. No production mutation is required. External tooling or native-machine limitations must remain explicitly unresolved unless a verified repository-level correction addresses them.

## Tasks

1. Inventory issues, duplicates, merged fixes, and current defects.
2. Correct tooling, configuration, and synthetic fixture defects in related groups.
3. Run focused suites and relevant typechecks; inspect the complete diff and privacy boundary.
4. Commit verified changes, complete delivery gates, and close resolved GitHub issues with evidence.
5. Report any real external blockers without claiming the backlog is clear.

## Verification

Use the owning Vitest configs, executable tooling fixtures, shell syntax checks, and package/tool typechecks. Database proof uses a session-owned migrated loopback test database. No credentials or private data belong in issue comments or this record.

## Progress

- Installed frozen dependencies and confirmed active Frog use through today's report.
- Confirmed many issues were logged in the same commits that repaired them; local pending metadata is stale because reconciliation awaits its own bot PR.
- Closed 32 stale reports with existing main-branch fixes, applied and closed the native SwiftFormat fix in `cobuildwithus/murph-ios@e073f608de4c69d9e8f142dc9f64f5648be8028a`, and closed four duplicate reports against their canonical originals.
- Implemented fixes or supported-command documentation for 37 additional reports. The PR links each report to the candidate; closure depends on delivery.
- Added a Frog entry for inherited operator hooks in synthetic review archive repositories; isolated the fixtures and passed all ten archive tests.

## Candidate resolution inventory

- Scoped commits: #3830, #3885, #4716. Preserve real staged mutations, intent-to-add state, unrelated staging, rename destinations, original amend metadata, and published-history rejection.
- Build and test entrypoints: #4222, #4272, #4301, #4338, #4352, #4355, #4385, #4710, #4800.
- Supported verification recipes: #3890, #4241, #4319, #4369, #4408, #4442, #4446, #4472.
- Audit packaging and plans: #4365, #4394, #4487, #4493, #4514.
- Runner assembly: #4474, #4476. Offline remains explicit; an unsupported incomplete bundle fails before staging.
- Fixture ownership and generated assets: #4506, #4515, #4584, #4620, #4648, #4681, #4703, #4715, #4719, #4755.

## Evidence and limitations

- Focused repository-tool suites passed, including scoped commit, plan collision, archive metadata, complete Web source-resolution, live-runner preflight, and docs-drift behavior.
- Maintenance: 167 passing cases. Canonical live preflight: 10 passing cases. CLI preparation: 5 passing cases. Cloudflare dependency installation: 19 passing cases. Warmup: 6 passing cases with parent-owned PID cleanup proof. Machine routes: 26 passing cases.
- A session-owned loopback database received all 281 migrations. Native Telegram rejection cases passed (3); the subsequent global auth cleanup and game chat suites passed (24). Test rows are synthetic.
- Direct app-directory Web invocation passed 95 game-rule cases. Focused tunnel fixture passed from its package directory. Native SwiftFormat checked 142 files cleanly; a malformed synthetic vendor file under build was excluded.
- Tooling, CLI, engine, runtime, hosted-local harness, Cloudflare, and prepared Web typechecks passed. Missing generated Web changelog input in a direct compiler run was resolved through the canonical prepared entrypoint. The initial mailbox proof required the compiled capture worker; after its normal build all five cases passed.
- Docs drift, docs gardening, workspace boundaries, and complexity checks passed. Privacy PDF text changes only synchronize the existing meal-photo retention paragraph; a second generation produced identical artifacts. Diff privacy scan passed. Patch-file context contains required blank context prefixes; authored non-patch whitespace is clean.
- No production mutation or paid live-provider run was needed. ReviewGPT is not eligible: internal tooling, fixtures, documentation, and generated assets only. No member-facing product behavior or provider input changed.

## Unresolved reports retained

Seven original reports remain open. #3862 requires native Linux sandbox evidence rather than ARM-host AMD64 emulation. #4143 and #4398 need exact accepted-turn synthetic UI fixtures for upstream ReviewGPT failures. #4226, #4228, and #4475 did not reproduce in focused reruns with unchanged assertions and deadlines; their causes remain unknown. #4386 lacks reproducible pinned benchmark image inputs and a representative local labels API. None was closed merely because a focused run passed. Missing benchmark inputs were requested while independent delivery continued.

## Delivery

Publish the verified candidate with the issue links, wait for required exact-head checks, and close the linked reports only after delivery. Keep the seven unresolved reports visible. The Frog Action remains responsible for publication and metadata reconciliation; no journal was edited.
Completed: 2026-11-10
