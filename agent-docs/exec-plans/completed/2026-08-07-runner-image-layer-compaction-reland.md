# runner-image-layer-compaction-reland

Status: completed
Created: 2026-08-07
Updated: 2026-08-07

## Goal

- Reduce the hosted runner image transfer and storage footprint by removing a
  permission-only duplicate application layer while preserving the final
  container filesystem and runtime behavior exactly.

## Success criteria

- The current runner bundle is mode-normalized before it enters the final image
  and appears only once in final rootfs layers.
- Baseline and candidate `/app` content plus path/owner/group/mode/size manifests
  are identical.
- A current `linux/amd64` build proves a material image-size reduction and one
  fewer rootfs layer; startup latency is explicitly out of scope and is not used
  to justify the change.
- The candidate stays root-owned and immutable, runs as uid/gid 1001, passes
  health and native-tool smoke, and retains the patched Codex model catalog.
- Focused local proof, exact-head CI, preliminary coverage review, final
  ReviewGPT, mergeability, and parent final review complete without unresolved
  accepted findings.

## Scope

- In scope: the final runner Dockerfile, its focused image-contract test, and
  matching deploy documentation.
- Out of scope: runner bundle contents, dependencies, base-image contents,
  hosted boot code, Worker behavior, deploy orchestration, and startup claims.

## Constraints

- Preserve the current base image, entrypoint, command, user, ownership, modes,
  environment, model catalog, and application bytes.
- Keep Worker/container skew behavior-compatible during gradual rollout.
- Reuse Docker multi-stage copy semantics without adding scripts, runtime state,
  services, or compatibility branches.

## Risks and mitigations

1. Risk: copy semantics change final file ownership or modes.
   Mitigation: compare complete manifests and run the non-root permission smoke.
2. Risk: the fresh final stage omits the generated Codex catalog.
   Mitigation: keep catalog generation in the final stage and prove its file
   mode and expected contents in the real image.
3. Risk: the image looks smaller without reducing transferred rootfs content.
   Mitigation: inspect compressed image size, rootfs diff IDs, and layer history
   from current baseline and candidate builds.

## Tasks

1. [complete] Reinspect the closed experiment and current `origin/main`.
2. [complete] Apply the smallest current-tree Dockerfile/test/docs change.
3. [complete] Run focused tests and current real-image parity/size proof.
4. [complete] Commit, push, open the PR, and complete ReviewGPT plus CI gates.
5. [complete] Close this plan through the final scoped commit and prove current
   base mergeability.

## Decisions

- Reland on the independently measured image-footprint benefit. The prior
  alternating startup benchmark was neutral and is not part of the claim.
- Keep the Dockerfile change separate from the local CLI dependency patch.

## Verification

- Focused image-contract test: 11 passed.
- Cloudflare package typecheck: passed.
- Current `linux/amd64` baseline/candidate image size: 485,212,594 bytes and 13
  rootfs layers versus 462,238,155 bytes and 12 layers, a 22,974,439-byte
  (4.73%) reduction.
- Gzip-1 `docker save` transfer surrogate: 481,774,274 bytes versus 458,840,545
  bytes, a 22,933,729-byte (4.76%) reduction.
- Complete `/app` content and path/type/owner/group/mode/size/link-target
  manifest digests matched exactly.
- Candidate health, uid/gid 1001, root-owned immutable app/entrypoint/catalog,
  no group- or world-writable `/app` path, catalog contents, Node, and Python
  smoke: passed.
- Local benchmark image tags were removed after measurement.
- `git diff --check` and every required exact-head CI check passed.
- Preliminary ReviewGPT: one invalid packet omitted the unchanged base
  Dockerfile; the corrected supplemental-evidence retry passed with no findings.
- Final ReviewGPT round 1 passed with no findings. Parent final review found no
  additional issue, and GitHub reports the PR mergeable.
Completed: 2026-08-07
