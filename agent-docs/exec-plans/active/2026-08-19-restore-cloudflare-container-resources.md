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

Effort: Patch. The resource rollback targets measured cold-start and
workspace-restore regressions without changing message semantics, recovery, or
the ten-minute conversation warmth policy.

Status: Hold until the protected production workflow accepts the generated
Wrangler config, deploy smoke passes, and a de-identified cold-path walkthrough
confirms correct reply delivery with the restored profile.

- Outcome: same-size cold workspace restore and accepted-to-reply timing return
  toward the preceding 2-vCPU profile's measured band, with correct reply
  delivery and the current ten-minute idle lease retained.
- Entry and promise: ordinary hosted conversation ingress and delivery remain
  unchanged; the first post-deploy cold conversation must complete normally and
  its container-start, Node-start, workspace-restore, and accepted-to-reply
  phases must be compared with the privacy-safe pre-cut trace.
- Reaches: cold conversations and CPU-heavy hosted reads. Follow-ups after ten
  idle minutes remain eligible for the cold path exactly as they are today.
- Proof: focused deploy-contract tests and a generated-config check prove the
  resource object and unchanged idle TTL before merge. The protected workflow
  intentionally resolves only public `main`, so its platform-native generated
  Wrangler dry run, deployment smoke, and de-identified cold-path comparison
  are post-merge release gates before this patch is called Ready.

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
- The protected production workflow's generated Wrangler dry run accepts both
  container bindings on the exact merged source.
- Required exact-head CI and routed ReviewGPT gates pass with no unresolved
  accepted findings.
- Protected production deployment and live smoke succeed on the merged source.
- A de-identified cold conversation completes through final reply delivery, and
  its phase timings are compared with the available pre-cut 2-vCPU trace; a hot
  follow-up inside the ten-minute lease remains warm.

Updated: 2026-08-19
