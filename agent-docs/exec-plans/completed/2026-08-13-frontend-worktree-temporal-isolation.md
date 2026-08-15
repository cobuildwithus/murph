# Isolate disabled worktree Temporal environments

Status: completed
Created: 2026-08-13
Updated: 2026-08-13

## Goal

- Make explicit `MURPH_DEV_TEMPORAL=disabled` a fail-closed isolation mode for
  sanctioned worktree startup, so remote Temporal connection or credential
  values cannot reach the Web, Worker, or runtime child environments and no
  local Temporal children start.

## Success criteria

- One existing Temporal environment owner enumerates the complete hosted and
  legacy address, auth, TLS, namespace, and task-queue surface.
- Disabled mode overlays explicit empty strings after every source merge and,
  specifically, after Web-only process overrides.
- A stack-level regression covers remote-shaped shell, Vercel-pull, `.env`,
  `.env.local`, and Web-override inputs; effective Web, Worker, and runtime
  values are empty and Temporal children remain absent.
- Focused stack/worktree tests, package typecheck, documentation checks, diff
  hygiene, and privacy scanning pass, with unrelated base failures isolated.

## Scope

- In scope: the hosted-local Temporal environment overlay, stack environment
  composition, focused regression coverage, and worktree operations guidance.
- Out of scope: production Temporal configuration, adding a second env-key
  registry, changing managed/external mode behavior, or GitHub publication.

## Constraints

- Technical constraints: reuse the Temporal module as the sole key-set owner;
  keep the worktree helper managed by default; use empty strings at child
  boundaries so later dotenv loading cannot restore remote values.
- Product/process constraints: preserve the supplied activation base and the
  original Batch B diff, use only the sanctioned worktree, avoid identifiers
  and secrets in durable artifacts, and do not bypass the storage guard.

## Risks and mitigations

1. Risk: a partial clearance list leaves an alternate legacy or TLS credential
   path live.
   Mitigation: derive every disabled clearance and CLI scrub from one complete
   hosted-plus-legacy Temporal key list.
2. Risk: clearing too early allows Vercel, local env files, Cloudflare state,
   or Web-only overrides to restore a remote value.
   Mitigation: apply the overlay to Cloudflare/runtime sources and as the final
   Web child layer after `webProcessEnvOverrides`.

## Tasks

1. Add a failing stack regression for disabled-mode multi-source isolation.
2. Centralize and apply the full disabled Temporal clearance overlay.
3. Correct worktree operations guidance for the fail-closed guarantee.
4. Run focused and scoped verification, inspect the diff, privacy-scan, and
   commit only if the external storage guard is clear.

## Decisions

- Empty-string values, rather than absent properties, are the Web child
  contract because `apps/web/scripts/dev-local.ts` reads `.env.local` and
  `.env` after process startup.
- `buildHostedLocalTemporalRuntimeEnv` remains the one Temporal configuration
  owner. Its overlay is applied to Cloudflare/runtime sources and repeated as
  the final Web-child layer after Web-only overrides; no parallel key registry
  or child launcher was introduced.

## Verification

- Focused stack, Temporal, and worktree Vitest: 128 tests passed, including the
  new disabled-mode multi-source isolation regression. The new assertion first
  failed against the pre-fix source with the shell-derived remote address still
  present.
- Hosted-local-harness typecheck: passed. Package-boundary verification: 2
  tests passed. Hosted Temporal architecture guard passed inside the diff lane.
- Doc gardening completed with zero issues; agent-doc drift checks passed.
- `pnpm test:diff` under the required Node runtime reached the affected package
  suite: 436 tests passed, 1 skipped, and the unchanged process-integration
  `minio-ready` timeout failed. The lane also repeated two unchanged Web
  workspace-boundary violations. The implicated files have zero diff from the
  supplied activation head.
- Final diff check and generic identifier/credential scan: passed.
Completed: 2026-08-13
