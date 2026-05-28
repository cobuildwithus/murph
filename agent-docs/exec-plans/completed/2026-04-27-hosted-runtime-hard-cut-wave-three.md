# Hosted Runtime Hard Cut Wave Three

## Goal

Move from additive mailbox/workspace groundwork toward the actual greenfield
hosted runtime cutover described in `migration.md`, while keeping Cloudflare a
thin runner over local runtime semantics.

Success criteria for this wave:

- The runtime checkpoint primitive can perform multiple checkpoints in one
  invocation without reusing a stale expected workspace version.
- Mailbox expiry semantics cannot create a permanent strict-prefix lane gap
  before runtime import.
- The parent integration path is ready to replace the run-drain job shape with a
  workspace-run job shape, without preserving web-owned run adoption/finalize
  semantics.
- Legacy protocol deletion is mapped precisely, but broad deletion waits until
  the active job path no longer imports the old surfaces.

## Constraints

- Greenfield cut: no compatibility shims for hosted users.
- Preserve unrelated dirty work in the shared checkout.
- Do not reintroduce web-owned turn-input peek/adopt, run acquire/commit/finalize,
  committed sequence targets, or per-event completion state.
- Runtime mailbox watermarks remain inside portable assistant runtime state in
  the encrypted workspace snapshot.
- Web mailbox fetch is read-only from web's perspective; runtime import plus
  checkpoint is the only adoption step.
- Logs and status stay redacted and bounded; no plaintext payloads, provider
  headers, message bodies, contact identifiers, local filesystem paths, or
  decrypted vault content.

## Stress-Test Against `migration.md`

- Phase 2/3 are not fully done until checkpoint version ownership and
  before-delivery refresh both work in one runtime invocation using the same
  evolving workspace version.
- Raw payload cleanup policy says not to expire raw payloads before import. The
  current mailbox fetch path filters expired rows, which can conflict with strict
  lane prefixes. Fix this before wiring the active runner.
- Phase 5 should add a new workspace-run shape rather than adapting
  `RunnerRunProcessor`/run-drain finalization. Parent owns this integration.
- Phase 8 deletion is not safe yet because production code still imports
  `runDrain`/`HostedRun` surfaces. Do deletion only after the new job path is
  active and verified.

## Ownership

- Parent: stress-test integration, create the wave plan, then own the active
  hosted job-path cutover investigation and any central wiring.
- Worker A: checkpoint version ownership inside `packages/assistant-runtime` only.
- Worker B: mailbox expiry/gap semantics inside `apps/web` mailbox storage/tests
  only.
- Worker C: legacy protocol deletion readiness map, with optional low-risk edits
  only outside Worker A/B/parent write sets if a clear non-conflicting cleanup is
  found.

## State

In progress.

Completed:

- Wave One added shared contracts and web mailbox/workspace stores.
- Wave Two added runtime mailbox import/checkpoint helpers and Cloudflare
  semantic platform ports additively.
- Stress test identified the next blockers: evolving checkpoint versions, expiry
  gaps, and avoiding premature deletion.
- Runtime checkpoint requests now carry forward the workspace version returned
  by a successful checkpoint for later checkpoints in the same invocation.
- Web mailbox fetch now returns append-only lane rows without filtering expired
  items, so runtime import can preserve strict prefixes and classify missing
  payloads through payload fetch.
- Cloudflare runtime platform now exposes workspace read alongside checkpoint.
- Cloudflare now exposes the run-free `/internal/users/:userId/nudge` runner
  wake route and DO method without invoking legacy run-drain.
- Cloudflare status now returns the run-free runner-status projection instead
  of reading old hosted-run status.
- Hosted web producer handoff now nudges the runner nudge route rather than the
  old run route.
- `packages/hosted-execution` now publishes explicit
  `HostedWorkspaceRunRequest` / `HostedWorkspaceRunResult` contracts and parsers
  that reject old `runDrain` and run-token fields.
- Runtime workspace checkpoint requests can now be built by a semantic snapshot
  adapter. The runner writes mailbox import state first, asks the adapter to
  snapshot the current local workspace, and only then calls `workspacePort`
  checkpoint. This is the primitive Cloudflare needs for the bridge-owned
  bundle upload plus web CAS path.
- `packages/cloudflare-hosted-control` has been hard-cut to browser-vault
  session, runner status, and runner nudge only; the legacy `/run`,
  `getStatus`, and `nudgeUserRun` client surfaces are gone.
- Cloudflare no longer exposes the public control `/internal/users/:userId/run`
  route; `/internal/users/:userId/nudge` is the runner wake surface.
- Runtime has an additive workspace-run job entrypoint that accepts
  `HostedWorkspaceRunRequest`, reads workspace state before mailbox import,
  fails closed without mailbox/workspace/read ports, imports and checkpoints the
  mailbox prefix through the semantic snapshot builder, and returns
  `HostedWorkspaceRunResult`.
- Cloudflare has a lease-scoped checkpoint bridge foundation split into
  snapshot/write and web-CAS validation helpers so the runtime snapshot builder
  can compose with a lease-validated `workspacePort.checkpoint` without double
  checkpointing.
- Cloudflare runner transport/container/node-runner surfaces in Worker G's
  scope now accept workspace-run jobs/results only, reject explicit non-workspace
  job kinds at the parse boundary, and no longer import the legacy run-drain
  result validation module.
- `migration.md` has been updated with the final remaining cutover sequence
  from the current checkout.
- Legacy protocol deletion readiness is mapped below.

Now:

- Required completion audit subagents for the Cloudflare runner hard cut are
  blocked by the local Codex usage limit; implementation and focused
  verification are otherwise complete for Worker G's ownership.

Next:

- Add the hosted workspace restore/null-bootstrap adapter and assistant phase
  to the workspace-run entrypoint before switching production traffic to it.
- Wire Cloudflare `createCheckpointSnapshot` to the snapshot/write helper and
  wrap `workspacePort.checkpoint` with the web-CAS lease validator.
- Run focused tests for assistant-runtime, apps/web mailbox/workspace, and
  Cloudflare runtime platform/job path after the bridge/job cutover slice.
- Run required security/privacy, coverage, simplify, and finish-review passes
  once local Codex subagent capacity is available, then close/commit the scoped
  Cloudflare runner hard-cut work.

## Deletion Readiness Map

Phase 8 is blocked by production imports in these remaining clusters:

- `apps/cloudflare`: `src/index.ts`, `src/worker-routes/shared.ts`,
  `src/hosted-email/worker-ingress.ts`, `src/user-runner.ts`,
  `src/user-runner/run-finalization.ts`, `src/user-runner/wake-inputs.ts`,
  `src/user-runner/runner-run-processor.ts`, `src/user-runner/runner-cleanup.ts`,
  `src/web-control-plane.ts`, `src/runner-outbound/turn-input.ts`,
  `src/node-runner.ts`, `src/node-runner-child.ts`,
  `src/container-entrypoint.ts`, and `src/runner-container.ts` still expose or
  consume `nudgeHostedRun`, `drainHostedRuns`, `runDrain`, web acquire/commit/
  finalize/status/log/release-finalize, `committedSeq`, `finalizeRequired`, and
  turn-input peek/adopt.
- `apps/web`: `prisma/schema.prisma`, `app/api/internal/hosted-run/**`,
  `app/api/browser-vault/session/route.ts`, `src/lib/hosted-run/**`,
  `src/lib/hosted-ingress/queue.ts`, `src/lib/hosted-ingress/lifecycle.ts`,
  and `src/lib/hosted-ingress/{store,store-append,store-data,store-projections,store.types,control}.ts`,
  `src/lib/hosted-retention/cleanup.ts`, plus producer services that call
  `nudgeHostedRunBestEffort` still depend on cursor/run ownership. Producer
  call sites include device-sync wake, hosted onboarding wake/Stripe, hosted
  share acceptance, and settings sync routes.
- `packages/assistant-runtime`: `src/hosted-runtime.ts`,
  `src/hosted-runtime/execution.ts`, `src/hosted-runtime/models.ts`,
  `src/hosted-runtime/parsers.ts`, `src/hosted-runtime/turn-input.ts`,
  `src/hosted-runtime/maintenance.ts`, and `src/hosted-runtime/platform.ts`
  still provide the legacy run-drain execution and turn-input adoption adapter.
- `packages/hosted-execution`: `src/contracts.ts`, `src/parsers.ts`,
  `src/parsers/run-control.ts`, `src/parsers/cursor.ts`, and `src/builders.ts`
  still publish the run/cursor/drain contract surface.
- `packages/cloudflare-hosted-control`: `src/client.ts` and `src/routes.ts`
  still expose the `/internal/users/:userId/run` nudge client/route naming.

Test-only blockers mirror those clusters in `apps/cloudflare/test/**`,
`apps/web/test/**`, `packages/assistant-runtime/test/**`,
`packages/hosted-execution/test/**`, and
`packages/cloudflare-hosted-control/test/**`. Active docs still describing the
old protocol include `ARCHITECTURE.md`, `README.md`,
`docs/hosted-hard-cut-migration-guide.md`, `docs/architecture.md`,
`docs/cloudflare-hosted-idempotency-followup.md`, package/app READMEs, and
`agent-docs/references/hosted-runtime-protocol.md`; completed exec plans are
history and should not drive deletion.

Minimal deletion order after the workspace-run job path is active:

1. Replace Cloudflare DO/client route methods and web producer nudges with the
   workspace-run wake/nudge result shape; remove `HostedRunNudgeResult`,
   `HostedRunDrainResult`, `targetCommittedSeqHint`, and `committedSeq` route
   plumbing.
2. Replace `HostedAssistantRuntimeJobInput.request.runDrain` with the
   workspace-run request shape and wire runner/container/node entrypoints to
   mailbox import plus workspace checkpoint.
3. Remove Cloudflare acquire/commit/finalize/status/log/release-finalize and
   turn-input peek/adopt clients, then delete `user-runner/run-finalization.ts`,
   run-drain wake input assembly, runner cleanup targets, and run breadcrumbs.
4. Remove assistant-runtime legacy `executeHostedRunDrainForCommit`,
   `completeHostedRunDrainAfterCommit`, `HostedRuntimeTurnInputPort`, and the
   run-drain parser/models once no production caller imports them.
5. Delete web internal `hosted-run` routes and `src/lib/hosted-run/**`, then
   remove cursor/run coupling from hosted ingress append/status/retention and
   browser-vault session by using `HostedWorkspace`.
6. Drop Prisma `HostedExecutionCursor`, `HostedIngressEvent`, `HostedRun`,
   `HostedRunLog`, aliases/payloads, and their `HostedMember` relations only
   after all app code and tests are off those models.
7. Prune shared `@murphai/hosted-execution` run/cursor/drain contracts,
   parsers, builders, exports, tests, stale docs, and boundary allowlists.

Do not delete the additive mailbox/workspace/runtime-log contracts, web
mailbox/workspace stores/routes, or assistant-runtime mailbox/workspace runner
ports; those are the new contract surface.

## Verification Targets

- `pnpm --dir packages/assistant-runtime test`
- `pnpm --dir packages/assistant-runtime typecheck`
- `pnpm --dir apps/web test`
- `pnpm --dir apps/web typecheck`
- `pnpm --dir apps/cloudflare test`
- `pnpm --dir apps/cloudflare typecheck`
- `pnpm typecheck`
- `git diff --check`
