# Member-specific one-vCPU container experiment

Status: active
Created: 2026-09-10
Updated: 2026-09-10

## Goal

- Run one selected account on a real Cloudflare container with one vCPU,
  3 GiB memory and 6,000 MB disk. Preserve ordinary account sizing, exact slot
  ownership, write fences, checkpointing, deletion and warm-session retention.

## Success criteria

- The selected account reaches the smaller application after normal idle.
- Ordinary accounts cannot bind the smaller application.
- Protected deployment proves the exact native resources and immutable image.
- Focused tests, typechecks, exact-head CI and routed reviews pass.

## Scope

- In scope: one dedicated container class sharing RunnerContainer lifecycle,
  opaque namespace routing, fresh-allocation selection, protected provisioning,
  environment mapping and existing latency/CLI timing measurements.
- Out of scope: fleet-wide resizing, new telemetry, member-facing settings,
  changes to assistant prompts, tools, models or canonical workspace state.

## Constraints

- Cloudflare start options cannot override CPU/memory. Current deployment
  rendering applies the same resource shape to every class.
- Store the single account selector as SHA-256 in the protected environment;
  never commit identifiers or targeting digests. Match only at fresh allocation
  and independently guard fresh binding. No new hot-reply I/O.
- The dedicated class follows the serving image/release identity, with no
  separate release state machine or standby inventory.
- Explicit approval covers extension of the existing protected deployment path.
  Production credentials remain in that workflow.

## Risks and mitigations

1. New namespace is unavailable before allocation.
   Provision it with selection off, preserve serving images/capacities, then
   admit the dedicated application and prove native convergence before enabling.
2. Selection changes during an active turn.
   Preserve the exact bound session until normal retirement. Disable selection
   for future allocations; retain namespace readers while targets exist.
3. Timing comparison mixes cold starts or unlike commands.
   Use existing ingress and CLI phase telemetry, matched command families and
   explicit coverage counts. Keep production evidence aggregate and private.

## Tasks

1. Implement namespace identity, fresh allocation and binding eligibility.
2. Add fixed resource rendering and protected namespace/application provisioning.
3. Map the selector and provisioning control in private Murph Cloud.
4. Run focused proof, typechecks, complexity review, CI and ReviewGPT gates.
5. Merge, deploy, verify account convergence and close this plan.

## Decisions

- One vCPU and 3 GiB memory are explicitly selected by the user.
- No new logging is needed; existing CLI timing has usable baseline coverage.
- An isolated public branch is prepared; the protected-path approval is received.

## Verification

- Passed: 353 focused tests across eight Cloudflare files, plus the final
  seven-test selector/namespace suite after adding unavailable-binding proof.
- Passed: Cloudflare typecheck, complexity diff (no increased hotspot debt),
  and the real public/private environment forwarding contract (90 variables,
  37 secrets). Full workspace/private verification and PR gates remain pending.

- Focused allocation, slot lifecycle, namespace, configuration, staging and
  deployment tests; Cloudflare typecheck and complexity diff.
- Private workflow contract tests and required pnpm verify.
- Prove selected/ordinary accounts, malformed selector, unavailable binding,
  namespace confusion, replay after selector removal, retention and deletion.
- Prove first provisioning preserves serving resources, failed admission cannot
  enable routing, worker-only mode retains images, and later releases update the
  dedicated application. Verify actual 1/3/6000 resources after deployment.
