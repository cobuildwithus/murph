# Persist hosted Codex resume continuity

Status: active
Created: 2026-05-04
Updated: 2026-05-04

## Goal

- Preserve Codex native resume continuity across isolated hosted Cloudflare invocations by snapshotting safe `.codex-hosted` state and keeping hosted Codex working-directory inputs stable.

## Success criteria

- Hosted workspace snapshots include safe `.codex-hosted` Codex app-server thread/rollout state.
- Hosted workspace snapshots exclude likely credentials, locks, sockets, tmp/cache/log roots, and other process-local Codex home files.
- Hosted provider turn planning and Cloudflare runtime bridge setup do not fall back to invocation-local launcher cwd paths for Codex `cwd`/vault roots.
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
4. Add focused tests for snapshot inclusion/exclusion and stable cwd behavior.
5. Run required verification and completion audits.

## Decisions

- Treat `.codex-hosted` as hosted operational continuity state, not product truth; exclude credentials, temp/cache/logs, locks, pid/socket files, and secrets.

## Verification

- Commands to run: focused package/app tests, `pnpm typecheck`, coverage-bearing lane selected from `test:diff` or package/app coverage, plus completion audits.
- Expected outcomes: tests pass; audits report no blocking security/privacy, coverage, or final-review findings.
