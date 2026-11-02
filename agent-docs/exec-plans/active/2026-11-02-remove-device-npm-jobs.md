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
