# Restore Cloudflare container resources

Status: active

## Outcome

Deploy the hosted Cloudflare execution plane with each runner container at
2 vCPU and 6,144 MiB memory while preserving the existing 6,000 MB ephemeral
disk allocation and ten-minute post-completion conversation idle lease.

## Invariants

- The checked-in Wrangler scaffold, deploy-automation defaults, production
  GitHub Environment override, and deploy documentation remain aligned.
- Both the normal runner and deploy-smoke runner use the same custom instance
  type.
- `HOSTED_EXECUTION_RUNNER_IDLE_TTL_MS` remains `600000` in source and
  production; this change must not lengthen the warm lease.
- The custom instance type remains within Cloudflare's current custom-container
  CPU, memory, and disk ratios.
- Production uses the protected private deployment workflow and an immediate
  container rollout, then proves the deployed Worker and runner version with
  the existing smoke contract.

## Product UX Plan

Effort: Product change. The resource rollback targets measured cold-start and
workspace-restore regressions without changing message semantics, recovery, or
the ten-minute conversation warmth policy.

- Outcome: cold hosted conversations recover the prior CPU and memory capacity;
  warm conversations retain the current ten-minute idle lease.
- Entry and promise: ordinary hosted conversation ingress and delivery remain
  unchanged, while cold container startup and large workspace restores should
  improve.
- Reaches: cold conversations and CPU-heavy hosted reads. Follow-ups after ten
  idle minutes remain eligible for the cold path exactly as they are today.
- Proof: focused deploy-contract tests and a generated-config check must prove
  the resource object and unchanged idle TTL, followed by protected deployment
  smoke on the exact merged source.

## Evidence

- Production changed from 2 vCPU / 6,144 MiB to 1 vCPU / 3,072 MiB on
  2026-08-18 while the warm lease changed from twenty minutes to ten minutes.
- Production cold-start traces after that change show slower container startup,
  Node startup, and same-size workspace restore than the preceding profile.
- Cloudflare's current custom-container limits accept 2 vCPU, 6,144 MiB memory,
  and 6,000 MB disk.
- Production defines `CF_CONTAINER_INSTANCE_TYPE` and
  `HOSTED_EXECUTION_RUNNER_IDLE_TTL_MS` as separate GitHub Environment vars, so
  the instance override can change while the ten-minute TTL stays fixed.

## Steps

1. Update both checked-in container objects, the deploy default, focused tests,
   and operator documentation to 2 vCPU / 6,144 MiB.
2. Run focused Cloudflare contract tests, typecheck, generated-config proof, and
   the supported Wrangler dry run while asserting the idle TTL remains 600,000
   milliseconds.
3. Inspect the privacy-safe diff, commit and push the review candidate, open the
   PR, and run exact-head CI plus the required ReviewGPT gates.
4. Merge the reviewed source change into `main`.
5. Set only the production `CF_CONTAINER_INSTANCE_TYPE` GitHub Environment var,
   confirm the idle-TTL var remains 600,000 milliseconds, and dispatch the
   protected deployment with an immediate container rollout.
6. Verify the live deployment and runner smoke before asking for a cold test.

## Verification

- Focused deploy-automation and container-image contract tests pass.
- Cloudflare package typecheck passes.
- Rendered deploy config contains the 2-vCPU custom instance object and the
  unchanged 600,000-millisecond idle TTL.
- Wrangler accepts both container bindings in a deployment dry run.
- Required exact-head CI and routed ReviewGPT gates pass with no unresolved
  accepted findings.
- Protected production deployment and live smoke succeed on the merged source.

Updated: 2026-08-19
