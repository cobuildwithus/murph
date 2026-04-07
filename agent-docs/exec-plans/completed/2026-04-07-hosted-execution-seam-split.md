# Shrink @murphai/hosted-execution to semantic ports and move Cloudflare topology behind injected runtime capabilities

Status: completed
Created: 2026-04-07
Updated: 2026-04-07

## Goal

- Hard-cut the hosted execution runtime so shared/runtime packages consume semantic injected capabilities only, while `apps/cloudflare` becomes the sole owner of worker-host topology and outbound proxy policy.

## Success criteria

- `packages/assistant-runtime/**` no longer constructs or inspects Cloudflare worker URLs/hostnames.
- `packages/hosted-execution/**` no longer exports worker host constants or shared Cloudflare callback/proxy base URL defaults.
- `packages/device-syncd/**` no longer hardcodes `device-sync.worker`.
- `apps/cloudflare/**` owns the internal worker host map and injects method-based runtime capabilities into the hosted runner.
- Hosted runtime behavior still passes the required verification lanes for the touched packages/apps.

## Scope

- In scope:
- `packages/assistant-runtime/**`
- `packages/hosted-execution/**`
- `packages/device-syncd/**`
- `apps/cloudflare/**`
- `ARCHITECTURE.md`
- package/app README files that describe the hosted boundary
- Out of scope:
- changing hosted product behavior beyond the boundary cleanup
- adding new hosted ports beyond `artifactStore`, `effectsPort`, `deviceSyncPort`, and `usageExportPort`
- reviving removed share-pack fetch routes or adding speculative runtime seams

## Constraints

- Technical constraints:
- The hosted runner crosses JSON process boundaries inside the container, so method-based capability injection must be rebuilt inside app-local runner bootstrap rather than serialized directly through the job payload.
- Missing injected capabilities must fail closed.
- Product/process constraints:
- Preserve unrelated dirty-tree edits.
- Keep the results/effects lane combined behind one semantic `effectsPort`.

## Risks and mitigations

1. Risk: runtime/platform inversion sprawls across too many files and regresses hosted execution.
   Mitigation: cut `assistant-runtime` first around a small `HostedRuntimePlatform` interface, then adapt Cloudflare onto it before deleting old topology helpers.
2. Risk: serializable runner payload constraints tempt a fallback to URL-based shared config.
   Mitigation: move the isolated child bootstrap into `apps/cloudflare` so method-based runtime dependencies stay app-local and non-serializable.
3. Risk: active hosted/device-sync lanes overlap touched files.
   Mitigation: stay within the existing hosted seam-split coordination lane, re-read files before edits, and avoid unrelated behavior changes.

## Tasks

1. Add `HostedRuntimePlatform` and refactor `assistant-runtime` internals to depend on semantic methods rather than callback URLs or worker hostnames.
2. Replace the Cloudflare hosted-runner entry/bootstrap path so `apps/cloudflare` builds the platform adapter, including isolated child execution.
3. Move worker-host constants and outbound routing ownership fully into `apps/cloudflare`.
4. Remove shared Cloudflare topology/defaulting from `hosted-execution` and `device-syncd`.
5. Update docs/tests, run required verification, audit the final diff, and commit via `scripts/finish-task`.

## Decisions

- Use a method-based `HostedRuntimePlatform` interface with four semantic capabilities: `artifactStore`, `effectsPort`, `deviceSyncPort`, and `usageExportPort`.
- Keep the current combined results lane as semantic `effectsPort` instead of splitting commit/email/journal into separate ports.
- Treat the serialized job payload as transport glue only; runtime behavior itself consumes injected methods, not URLs.
- Rebuild the injected platform inside `apps/cloudflare` runner bootstrap, including the isolated child path.

## Verification

- Commands to run:
- `pnpm typecheck`
- `pnpm test:coverage`
- Expected outcomes:
- Hosted runtime and Cloudflare runner tests cover the boundary cut without shared worker-host defaults remaining in runtime/shared packages.
Completed: 2026-04-07
