# runner-image-layer-compaction

Status: active
Created: 2026-08-06
Updated: 2026-08-06

## Goal

- Remove the hosted runner image's duplicated application-content layer while
  preserving the exact final filesystem ownership, modes, non-root runtime
  user, entrypoint, and runtime behavior.

## Success criteria

- The runner bundle is normalized in an intermediate image stage and copied
  once into a fresh final base stage.
- The final `/app` tree remains root-owned, readable/executable as needed, and
  unwritable by the `runner` user.
- A real `linux/amd64` local image build shows one fewer application-content
  layer and a smaller image than the unchanged baseline.
- Focused Dockerfile contract tests, Cloudflare typecheck, container health,
  and runtime permission smoke pass.
- Required exact-head ReviewGPT and CI complete with no unresolved findings.

## Scope

- In scope: `Dockerfile.cloudflare-hosted-runner`, its focused image-contract
  tests, and directly matching Cloudflare deploy documentation.
- Out of scope: runner bundle contents, Node/module startup behavior, runtime
  imports, application code, dependencies, base-image contents, or deploy
  orchestration.

## Constraints

- Preserve the existing root ownership and recursive `a-w` plus `a+rX` mode
  normalization contract.
- Preserve execution as the existing non-root `runner` user and immutable
  `/app`; do not weaken smoke or permission coverage.
- Keep the change backward compatible across gradual Worker/container rollout.

## Risks and mitigations

1. Risk: the fresh final stage loses the patched Codex model catalog.
   Mitigation: keep catalog patching in the final stage and prove stage/order
   placement in the focused Dockerfile contract.
2. Risk: `COPY --from` changes ownership or modes.
   Mitigation: normalize in the intermediate stage, copy with explicit root
   ownership, and inspect the built container as `runner`.
3. Risk: the Dockerfile looks smaller but image history still duplicates app
   bytes.
   Mitigation: compare baseline and candidate image history, total size, and
   layer count from real `linux/amd64` builds.

## Tasks

1. [complete] Capture the unchanged Dockerfile contract and real-image
   baseline.
2. [complete] Implement the two-stage app-permission normalization and update
   focused tests/docs.
3. [complete] Run focused tests, typecheck, real Docker build, health, permission,
   history, and size proof.
4. [in progress] Commit, push, open a draft PR, and complete ReviewGPT and CI
   gates.

## Decisions

- Use no new scripts, dependencies, or runtime abstractions; Docker's existing
  multi-stage copy is sufficient.
- Keep Codex catalog generation in the fresh final stage so the application
  normalization stage contains only `/app` and cannot become runtime authority.

## Verification

- Focused image-contract test: 11 passed.
- Cloudflare package typecheck: passed.
- Real `linux/amd64` baseline/candidate build: 486,045,439 bytes and 13 rootfs
  layers before; 462,194,303 bytes and 12 rootfs layers after. The candidate is
  23,851,136 bytes (4.91%) smaller.
- Baseline/candidate `/app` content digest matched exactly. A second complete
  path/owner/group/mode/size manifest digest also matched exactly after keeping
  the final `/app` directory at root-owned `0555`.
- Direct candidate container smoke: `/health` returned healthy; the process ran
  as uid/gid 1001 `runner`; `/app` and `dist-bundled` were root-owned `0555`;
  the entrypoint and Codex catalog were root-owned `0444`; no regular file or
  directory under `/app` was group- or world-writable; Python 3.11.2 and Node
  24.14.1 resolved on the baked runtime path.
- `git diff --check`: passed.
- Pending: exact-head ReviewGPT and CI.
