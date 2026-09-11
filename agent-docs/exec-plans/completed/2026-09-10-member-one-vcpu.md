# Member-specific one-vCPU container experiment

Status: completed
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
5. Merge, deploy, verify native convergence and record account-allocation limits.

## Decisions

- One vCPU and 3 GiB memory are explicitly selected by the user.
- No new logging is needed; existing CLI timing has usable baseline coverage.
- An isolated public branch is prepared; the protected-path approval is received.

## Verification

- Passed: 353 focused tests across eight Cloudflare files, plus the final
  seven-test selector/namespace suite after adding unavailable-binding proof.
- Passed: Cloudflare typecheck, complexity diff (no increased hotspot debt),
  and the real public/private environment forwarding contract (90 variables,
  37 secrets).
- Full workspace typecheck passed. Public final ReviewGPT round 1 passed on
  the initial candidate with verified Pro evidence and 366-second capture.
- CI exposed missing local harness namespace parity and stale capacity
  expectations. The correction changes isolated local proof scaffolding only;
  142 focused tests, both affected typechecks and complexity diff passed.
- Public PR #3206 and the matching private deployment change merged after their
  required exact-head CI and routed reviews passed. Private preliminary review
  found two coverage gaps; both were corrected in the existing contract test.
- Private final ReviewGPT round 2 passed on the corrected candidate with verified
  Pro evidence and a 489-second capture. The final local `pnpm verify` run passed,
  including all deployment-controller and built-worker tests. An earlier local
  run timed out in four unchanged deployment-controller tests.
- Optional hosted integration repeated failures in unchanged foreground-priority,
  reminder/device-sync and wearable-replay scenarios. The protected deployment
  retains all of its predeployment gates.
- The protected selector and first-provisioning controls are configured. All
  protected predeployment gates passed. Namespace bootstrap stopped before any
  Worker mutation because retained native image metadata failed the new-image
  contract. A synthetic tagged-image regression reproduces the exact failure.
- The forward fix permits an exact observed image reference only in the
  namespace-only preservation path. New release admission remains digest-only;
  native before/after receipts, resource checks and routing-off ordering remain.
- The correction merged as PR #3216 after 100 focused tests, Cloudflare
  typecheck, complexity checks and all required exact-head CI passed. Final
  ReviewGPT round 1 passed with verified Pro metadata and a 366-second response
  capture, including 27 independently executed checks. The first tooling
  attempt was invalid because its archive was absent; the exact captured thread
  was inspected before the successful same-round full-snapshot retry.
- The protected full retry passed all predeployment gates and stopped before
  Worker mutation: pinned Wrangler 4.90.0 rejects the bootstrap no-rollout flag.
  An actual-CLI synthetic probe proves that omitting the flag can reconcile an
  existing application when native fields differ, despite matching image and
  resources. Native Wrangler 4.93.0 provides the migration-only skip without
  a deployment patch. The existing macOS compatibility correction is unrelated.
- A separate main-branch upgrade shipped Wrangler 4.93.0 while the experiment's
  dependency candidate was being verified. That candidate is superseded; the
  outcome follow-up retains only the actual-CLI regression and task records.
- Against the upgraded main branch, the frozen lockfile install, 36 actual-CLI,
  bootstrap and deployment tests, and Cloudflare typecheck pass. The actual CLI
  uploads the new namespace with selection off and makes no Container API call;
  a plain deploy attempts a native application patch in the synthetic case.
- Protected deployment completed successfully using the main-branch Wrangler
  upgrade. All predeployment gates, deployment, final endpoint smoke and live
  convergence verification passed. Native application admission checked the
  exact 1-vCPU / 3-GiB / 6,000-MB specification. The final receipt reports the
  dedicated application created at version 1 with capacity 1; ordinary serving
  capacity remains 702 and retired applications remain at zero.
- The protected selector metadata is unchanged, selection remains enabled, and
  the one-time bootstrap control was cleared after namespace provisioning. A
  later deployment had already begun; the existing-namespace branch skips
  bootstrap before consulting that control, so the cleanup preserves its path.
- Documentation drift, gardening and complexity checks pass. The outcome
  follow-up changes isolated CLI proof and historical records only; it does not
  require another final ReviewGPT production review.

## Outcome and remaining measurement

The smaller application and fresh-allocation eligibility are shipped. Existing
warm sessions retain their exact target until normal retirement. The selected
account's first smaller-container allocation has not been independently observed;
that original success criterion remains an operational verification limit.
Existing aggregate hot-reply and CLI timing provides the baseline, but no
post-change timing or performance conclusion is claimed. Normal member traffic
can supply the next allocation and the comparison data.

- Focused allocation, slot lifecycle, namespace, configuration, staging and
  deployment tests; Cloudflare typecheck and complexity diff.
- Private workflow contract tests and required pnpm verify.
- Prove selected/ordinary accounts, malformed selector, unavailable binding,
  namespace confusion, replay after selector removal, retention and deletion.
- Prove first provisioning preserves serving resources, failed admission cannot
  enable routing, worker-only mode retains images, and later releases update the
  dedicated application. Verify actual 1/3/6000 resources after deployment.
Completed: 2026-09-10
