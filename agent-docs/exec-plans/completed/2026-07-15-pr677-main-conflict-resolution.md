# PR 677 Main Conflict Resolution

## Goal

Reconcile the reviewed foreground-reply-authority patch with current `main`
without dropping either public runtime-contract export. Prove the combined
contract, push the merge head, rerun CI and correction verification, then merge
and deploy the Cloudflare runtime immediately.

## Evidence

- The base branch added `HOSTED_RUNTIME_ARTIFACT_READ_PURPOSES` to the runtime
  contract barrel.
- PR 677 added `HostedRuntimeArtifactReadError` at the same export block.
- The overlap is additive: both symbols are owned by and exported from the same
  platform module. No behavior, state, lifecycle, or compatibility layer is
  required.
- The base branch also made artifact read context mandatory. Three PR-owned
  test wrappers must transparently forward that context to their base store;
  otherwise the merged head does not typecheck.

## Verification Plan

- Export both existing symbols from the shared contract barrel and forward the
  existing artifact read context through the three PR-owned test wrappers.
- Run assistant-runtime typecheck and focused artifact/workspace restore tests.
- Run diff/privacy checks, push the merge head, wait for CI, and run the
  required post-conflict correction verification.

## Outcome

- Retained both independent runtime-contract exports in the shared barrel.
- Forwarded the required base artifact-read context through all three PR-owned
  wrapper stores without changing their failure injection behavior.
- Assistant-runtime typecheck and all 223 workspace-entrypoint tests passed;
  diff and privacy checks passed.

Status: completed
Updated: 2026-07-15
Completed: 2026-07-15
