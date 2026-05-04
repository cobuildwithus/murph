# Persist hosted Codex resume continuity

Status: completed
Created: 2026-05-04
Updated: 2026-05-04

## Goal

- Preserve Codex native resume continuity across isolated hosted Cloudflare invocations by snapshotting safe `.codex-hosted` state, keeping hosted Codex working-directory inputs stable, and surfacing safe resume-plan diagnostics in hosted runtime logs.

## Success criteria

- Hosted workspace snapshots include safe `.codex-hosted` Codex app-server thread/rollout state.
- Hosted workspace snapshots exclude likely credentials, locks, sockets, tmp/cache/log roots, and other process-local Codex home files.
- Hosted checkpoints emit only count/class diagnostics plus keyed hashes when a fingerprint secret is configured for `.codex-hosted` snapshot candidates.
- Hosted runtime logs include safe provider-plan fields needed to distinguish native resume from thread-start fallback.
- Hosted provider turn planning and Cloudflare runtime bridge setup do not fall back to invocation-local launcher cwd paths for Codex `cwd`/vault roots; vault roots are explicit and scoped under the hosted workspace/child cleanup root.
- Focused tests prove the snapshot filter and stable cwd behavior.
- Required typecheck, tests, and completion audits pass or any unrelated blocker is documented.

## Scope

- In scope: hosted bundle filtering in `packages/runtime-state`, hosted provider cwd planning, Cloudflare runtime bridge call sites, focused tests, and directly relevant docs if needed.
- Out of scope: changing Codex provider resume semantics, changing provider credentials, changing hosted mailbox ordering, or touching unrelated active hosted work rows.

## Constraints

- Technical constraints: no credentials in hosted snapshots; keep hosted bundle restore encrypted and denylist-based for unsafe/process-local state; preserve assistant runtime privacy permissions.
- Product/process constraints: preserve unrelated dirty work; do not expose local account identifiers or home paths in files, commits, or handoff.

## Risks and mitigations

1. Risk: over-including Codex home secrets or process-local files.
   Mitigation: filter `.codex-hosted` through an explicit allow-by-default-with-sensitive-denylist helper and add exclusion tests for common credential/process-local paths.
2. Risk: incomplete stable-cwd fix leaves cache prefix instability.
   Mitigation: patch both turn planning and hosted Cloudflare bridge call sites, then test the specific fallback behavior.

## Tasks

1. Inspect current hosted snapshot and cwd planning paths.
2. Patch `.codex-hosted` hosted operator-home inclusion with a safe exclusion helper.
3. Patch hosted cwd/vaultRoot fallbacks so isolated launcher roots do not enter Codex turn planning.
4. Add `.codex-hosted` checkpoint diagnostics and provider-plan hosted runtime logs.
5. Add focused tests for snapshot inclusion/exclusion, stable cwd behavior, and hosted diagnostics.
6. Run required verification and completion audits.

## Decisions

- Treat `.codex-hosted` as hosted operational continuity state, not product truth; include safe non-secret state by default while excluding credentials, temp/cache/logs, locks, pid/socket files, and secrets.
- Hosted `.codex-hosted` diagnostics must expose counts, exclusion classes, and keyed hashed relative names only when a fingerprint secret is configured; no raw Codex home paths or filenames.

## Verification

- Commands to run: focused package/app tests, `pnpm typecheck`, coverage-bearing lane selected from `test:diff` or package/app coverage, plus completion audits.
- Expected outcomes: tests pass; audits report no blocking security/privacy, coverage, or final-review findings.
Completed: 2026-05-04
