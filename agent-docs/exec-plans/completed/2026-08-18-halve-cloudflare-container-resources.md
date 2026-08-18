# Halve Cloudflare container resources

Status: completed

## Outcome

Deploy the hosted Cloudflare execution plane with each runner container at
1 vCPU and 3,072 MiB memory, while preserving the existing 6,000 MB ephemeral
disk allocation, and reduce the post-completion conversation idle lease from
20 minutes to 10 minutes.

## Invariants

- The checked-in Wrangler scaffold, deploy-automation defaults, production
  GitHub Environment overrides, and deploy documentation remain aligned.
- Both the normal runner and deploy-smoke runner use the same custom instance
  type.
- The custom instance type remains valid under Cloudflare's current minimum
  3 GiB memory per vCPU and maximum 2 GB disk per 1 GiB memory ratios.
- The idle lease changes only post-completion container warmth; active work,
  dirty-state checkpointing, lifecycle re-evaluation, and shutdown safety stay
  unchanged.
- Production uses the protected private deployment workflow and an immediate
  container rollout, then proves the requested Worker and runner version with
  the existing smoke contract.

## Product UX Plan

Effort: Product change. The user explicitly requested the smaller production
resource and warm-lease footprint, which reverses the current two-vCPU
performance allocation without changing delivery, recovery, or data semantics.

- Outcome: hosted conversations remain functional and recoverable on the
  previously deployed one-vCPU / 3-GiB shape, with the accepted trade-off that
  heavier reads can take longer.
- Entry and promise: ordinary hosted conversation ingress still reaches the
  same reply destination; this change does not promise that latency is
  unchanged.
- Reaches: cold conversations, heavier established-member reads, and follow-ups
  arriving 11–20 minutes after a completed turn. The last group moves from the
  warm path to the cold path under the ten-minute lease.
- Proof: the exact instance object has prior production history, the current
  Wrangler build/dry-run must accept both bindings, and the protected managed
  deployment must pass deployment-status, runner-bundle, direct-R2, and live
  model-turn smoke on the exact reduced profile. Any provisioning, process,
  retry, or smoke failure requires restoring the prior variables and
  redeploying rather than adding compensating runtime machinery.

Walkthrough: Ready for a controlled rollout. A follow-up inside ten minutes
keeps the existing warm path. A follow-up after ten minutes may pay the existing
cold-start cost and a heavier read may run more slowly, but delivery,
exactly-once behavior, and recovery owners are unchanged. The requested shape
was the production default before the two-vCPU upgrade, and the rollout remains
incomplete until the exact managed smoke passes.

## Evidence

- Public source and production currently configure the custom instance object
  as 2 vCPU, 6,144 MiB memory, and 6,000 MB disk.
- Production currently defines both `CF_CONTAINER_INSTANCE_TYPE` and
  `HOSTED_EXECUTION_RUNNER_IDLE_TTL_MS` as GitHub Environment overrides.
- The protected deployment workflow resolves the public Murph `main` branch,
  so the source change must merge before deployment.
- Cloudflare's current Containers limits document accepts the requested
  1 vCPU, 3,072 MiB memory, and 6,000 MB disk combination.
- The same 1 vCPU, 3,072 MiB memory, and 6,000 MB disk tuple was the production
  default before the two-vCPU upgrade merged in PR 878; the upgrade publicly
  documented shorter heavier-read latency, so this rollback deliberately does
  not claim latency neutrality.
- Wrangler 4.90.0 completed a strict dry-run after assembling the canonical
  runner bundle, building both container images and accepting the 600,000 ms
  Worker lease. Local exact-limit image smoke reached the runner but could not
  finish because Docker Desktop's AMD64 emulation cannot install the nested
  seccomp profile; the native managed deployment smoke owns that remaining
  proof.

## Steps

1. Update the checked-in Wrangler container objects, deploy-automation
   defaults, idle-lease defaults, focused expectations, and operator docs.
2. Run focused Cloudflare deploy-contract tests, typecheck, config rendering,
   and a Wrangler dry-run/config validation where supported by the repo path.
3. Inspect the privacy-safe diff, commit and push the review candidate, open the
   PR, and run the required specialist and final ReviewGPT gates with exact-head
   CI.
4. Merge the reviewed source change into `main`.
5. Set production `CF_CONTAINER_INSTANCE_TYPE` to the exact JSON object and
   `HOSTED_EXECUTION_RUNNER_IDLE_TTL_MS` to `600000` through `gh variable set`.
6. Dispatch the protected Cloudflare deployment with an immediate container
   rollout, wait for completion, and verify Worker/container smoke plus the
   resulting deployment status.

## Verification

- Focused deploy-automation and container-image contract tests pass.
- Cloudflare package typecheck passes.
- Rendered deploy config contains the expected custom instance object and idle
  TTL without exposing secrets.
- Required exact-head CI and both routed ReviewGPT stages pass with no unresolved
  accepted findings.
- The protected production deployment completes successfully and its existing
  smoke step proves the deployed Worker and managed runner bundle.

Updated: 2026-08-18
Completed: 2026-08-18
