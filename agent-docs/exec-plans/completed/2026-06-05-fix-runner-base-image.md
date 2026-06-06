# Fix hosted-local runner base image resolution

Status: completed
Created: 2026-06-05
Updated: 2026-06-06

## Goal

- Make hosted-local `pnpm dev` avoid Docker Hub auth failures caused by
  BuildKit resolving Murph's local-only runner base image tag as
  `docker.io/library/...`.

## Success criteria

- The final hosted-runner Dockerfile defaults to a pullable GHCR base image tag.
- The runner base preparation script still validates and refreshes the local
  fingerprinted base image used by local smoke/build helpers.
- Tests pin the new image contract.
- Focused Docker proof and Cloudflare verification pass.

## Scope

- In scope:
  - Dockerfile base-image default for `Dockerfile.cloudflare-hosted-runner`
  - Runner base-image preparation tag handling
  - Cloudflare runner base-image contract tests
  - Dev-worker skip-mode test that validates the prepared image tag
  - Minimal deploy/local-dev docs text if the contract wording changes
- Out of scope:
  - Changing Cloudflare container topology or runtime authority
  - Reworking Wrangler dev orchestration
  - Changing the native base image contents

## Constraints

- Technical constraints:
  - Keep production deploy paths source-rebuild capable.
  - Do not introduce secret-bearing config or Docker login requirements beyond
    the existing GHCR model/base-image rules.
- Product/process constraints:
  - Preserve unrelated working-tree changes.
  - Keep the fix small and directly tied to the startup failure.

## Risks and mitigations

1. Risk: deploy or smoke paths drift from the prepared-base contract.
   Mitigation: update existing contract tests and run Cloudflare focused checks.
2. Risk: GHCR availability becomes mandatory for local dev.
   Mitigation: retain `runner:docker:base` local fingerprint validation and
   document that the stable GHCR base tag is the default Dockerfile reference.

## Tasks

1. Update the Dockerfile base-image default to the stable GHCR base tag.
2. Update the preparation helper so a stable GHCR fallback does not self-retag.
3. Update tests and docs that pin the runner base image contract.
4. Run a focused Docker build proof, `pnpm test:diff` for the touched paths,
   and required completion reviews.
5. Commit the scoped fix with `scripts/finish-task`.

## Decisions

- Use the stable GHCR base tag for the final image default instead of passing
  build args through Wrangler. The checked-in Wrangler container config already
  has no build-arg surface, while the stable GHCR tag is pullable and resolves
  to the same digest as the prepared local base image.

## Verification

- Commands to run:
  - `docker buildx build --load --platform linux/amd64 -f ../../Dockerfile.cloudflare-hosted-runner -t murph-debug-runnercontainer:runner-base-fix .`
  - `bash scripts/workspace-verify.sh test:diff Dockerfile.cloudflare-hosted-runner apps/cloudflare/scripts/runner-base-image-contract.ts apps/cloudflare/scripts/runner-base-image.ts apps/cloudflare/test/container-image-contract.test.ts apps/cloudflare/test/runner-base-image.test.ts apps/cloudflare/test/dev-worker.test.ts apps/cloudflare/DEPLOY.md`
- Expected outcomes:
  - Docker app-layer image exports without `insufficient_scope`.
  - Diff-aware Cloudflare checks pass for the touched contract surface.
Completed: 2026-06-06
