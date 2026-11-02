# Retire local device tooling, direct providers, npm publishing, and background discovery jobs

Status: active
Created: 2026-11-02
Updated: 2026-11-02

## Goal and scope

Implement the four owner-approved deletion slices in the assigned isolated worktree, one commit per slice. Preserve hosted device commands, Junction ingestion and provider-labelled reads, runner startup laziness, required CI check names, and every explicitly retained product surface. No pushes, PRs, publishing, production access, migrations, or other-checkout edits.

## Tasks

1. A: Remove local daemon, launcher, HTTP listener, and fixture capture; retain hosted contracts and fixture readers.
2. B: Remove direct WHOOP/Oura/Strava APIs and routes after tracing Junction and read-only iOS callers.
3. C: Capture runner package inventory, replace publish metadata with an explicit bundle closure, and remove npm publishing while retaining CI coverage owners.
4. D: Retire research scout through existing managed automation tombstones; audit the already-retired Personal Patterns machinery and preserve member data.

## Findings and decisions

- Baseline is stacked on 480b53eb1c; worktree started clean.
- Personal Patterns is already documented as retired in the base; verify implementation before deleting anything by name.
- Hosted device mutation services currently reject direct CLI execution in favor of the authenticated root device tool. Preserve that authority boundary and existing CLI paths/flags.
- Web and Worker consume hosted-runtime, service, registry, config, Junction, companion, public-account, source availability, and persistence types from device-syncd. These are retained.
- Completed plans are historical records and remain unchanged.

## Verification

- Baseline pnpm install passed with the existing lockfile.
- Baseline pnpm build ran; package compilation passed; verify generated surface output before edits.
- Baseline runner:bundle in progress.
- Run the requested package checks, full runner assembly, workspace/dependency/CLI/doc/complexity/repo-tool guards. Record exact commands and failures here.

## Deployment analysis

B and D: pending dependency and persisted-state tracing. No deployment is authorized. Record mixed Web/runner behavior, retirement convergence, rollback floor and safe deploy order before completion.

### Slice A implementation and verification

Removed daemon binary/listener/launcher, local client transport, continuous worker/scheduler timers, launcher schemas and command registrations, and wearable capture tooling. Kept hosted device command paths/flags, root-tool authority rejection, catalog output, source/account types, finite reconciliation and fixture readers. Shared Web error formatting already lives in errors.ts and remains unchanged.

Passed: pnpm install (baseline and offline refresh); pnpm build; CLI schema/Incur/skill generators; device-syncd typecheck and test (1,596); operator-config typecheck and test (438); CLI focused device/wiring tests (17); assistant-engine CLI-surface/tool-contract tests (44, 38 opt-in skips); assistant-engine and assistant-runtime typechecks; Web and Cloudflare typechecks; workspace boundaries/cycles; deps:guard; no-js; docs:drift. Initial typechecks found stale daemon test references and were corrected. CLI verification is running; final full checks follow all slices.

Baseline full runner bundle passed: CLI startup 19,814 bytes, runner static boot 2,017,368 bytes across 22 chunks. Package inventory is retained in ignored task scratch for the publishing-metadata comparison. No hosted provider input claim is made from authored prose size alone.

### Slice B boundaries and rollout

Junction's local import graph from its provider and client contains 35 modules and does not reach the deleted direct transport modules. The client used only the shared API-error formatter; that helper now has its own module. Importer source identities, priorities, mappings, query filters, companion routes, and Fitbit migration remain. No other direct Garmin/Fitbit/Withings/Polar transport was found. No Prisma schema or migration changes are made; provider-generic connection, credential, OAuth-state and audit tables remain.

Read-only native iOS search found no calls to direct WHOOP/Oura/Strava OAuth or webhook paths. Generic Web route files remain registered for Junction; unknown retired provider names fail registry lookup. Native companion callers remain supported. An old native test still mentions the Patterns route already removed on the stacked base; this change does not delete that route.

B safe deploy order: deploy Web/control-plane configuration first, so new invocation snapshots contain only Junction. Drain already-created invocations and warm old Web functions before rolling the new runner. Old runners accept Junction-only snapshots. New runners deliberately reject old serialized direct-provider config; new-runner/old-Web is unsafe if the old Web environment still configures retired providers. No direct production connections are claimed from local diagnostics; the owner supplied the all-Junction production inventory. No deployment performed.

B verification: full build and CLI verification passed. Device tests: 1,412 initially passed, two migrated ingress fixtures failed and were corrected; focused rerun passed all 83 ingress tests. Importer typecheck and all 753 tests passed. Runtime focused suite initially passed 667 with nine stale direct fixtures; the corrected suites passed, including all 11 foreground ingestion proofs with explicit Junction source authority. Web focused suites passed after migrating source fixtures; Web/runtime/Cloudflare typechecks passed. Full runner bundle passed with 76 top-level packages captured before C; static boot 2,005,060 bytes across 22 chunks. Its local assembly unexpectedly attempted registry metadata resolution (DNS failure, no download); use a local offline pnpm wrapper for subsequent assembly. No registry mutation or publication occurred.

### Slice C implementation

Removed tag publication workflow, release orchestration, npm trust tooling, public tarball pack/publish helpers, npm notes and CLI changelog. Web's changelog generator does not consume those files. All workspace packages are private; public license/repository metadata remains. `files` lists remain because runner assembly actively consumes them; CLI changelog entry was removed. Replaced the CLI manifest's bundled dependencies with the identical explicit runner closure. Retained artifact secret guard, coverage plan/matrix, and protected `Release checks (ubuntu)` status. The former package-shape verifier is now a runtime artifact verifier, retaining generated artifact and entrypoint checks.

Before/after full runner assembly passed, including offline nested installs: exactly 76 top-level node_modules packages, no additions/removals. No publication or registry mutation. Local npm pack remains part of the authorized runner assembly; it does not publish. Offline wrapper is ignored task scratch; reproducible missing-offline-option friction is logged.

C checks passed: build, offline install and full runner bundle, CLI and Cloudflare typechecks, verify:cli (315 tests), and CI policy tests. Repo tools: 864 passed, 27 failed in unchanged ReviewGPT fixture tests because the machine privacy hook rejects their synthetic non-noreply email; both failing test files are identical to the stacked base and origin/main. No guard was weakened. The obsolete release-only doc exemption test was removed with its implementation.
