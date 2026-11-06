# Native container provider read diagnostics

## Goal
Preserve privacy-safe stage, operation, and HTTP classification when the existing deployment provider cannot read native application state. The existing generic error hides transport, HTTP, JSON, and response-contract failures. Preserve fail-closed activation and all existing request/retry behavior.

## Scope and ownership
Only the existing native deployment read adapter, focused tests, and its documentation. Current open changes and dirty worktrees were inspected; no overlapping implementation was found. No runtime policy, credentials, state, provider payloads, direct production mutation, or recovery is in scope.

## Steps
- [x] Trace the failure to the existing provider read catch and inspect current source.
- [x] Obtain the implementation from ReviewGPT using synthetic inputs.
- [x] Run original-source red proof, focused regression tests, Cloudflare typecheck, complexity, and documentation/privacy checks.
- [x] Review the complete implementation patch and prepare the scoped commit.
- External completion: the PR records final exact-head ReviewGPT, required CI, and merge status.
- External observation: verify canonical workflow consumption separately; this plan does not claim a production recovery.

## Evidence and decisions
The existing provider read wraps every transport, HTTP, JSON and shape error in the same TypeError, and its higher-level read catches wrap it again. Existing diagnostic APIs already carry enough context to add finite categories without raw provider content. Current public source is the evidence packet; private runtime evidence is excluded.

## Verification
The original implementation collapsed four synthetic failure stages into one diagnostic. Applying the new tests before the source patch produced 33 assertion failures (36 tests passed). With the implementation, the receipt and adjacent release-provider suites pass all 156 tests. Tests cover all twelve operation/stage pairs, composed-reader propagation, successful provider reads, unchanged call counts/order, overlapping detail reads, forged errors, and status validation without coercion. Cloudflare typecheck passes after generating the declared Prisma client in the fresh worktree. Local Node is 24.14.1; required CI owns supported-engine verification. Complexity debt stays zero and maximum complexity stays 20; there are no changed-file hotspots above 20. The standalone four-stage reproduction now distinguishes all four failures without private exception text. Diff and authored text were reviewed for privacy. Documentation describes the exact read-adapter boundary; later release-contract validation remains unchanged.

## Deployment
Deployment-tool diagnostics only. They take effect when the protected workflow checks out the merged public source. Runtime activation is a separate authorized operation with its existing compatibility, ownership and recovery boundaries.

## Implementation review
ReviewGPT supplied the source and regression patch from public source and synthetic inputs. Parent review confirms no additional provider requests, retry, timeout, runtime-state, schema, or activation-policy changes. The only new type is a module-private error marker so enclosing catches preserve trusted diagnostics. No public changelog is needed because this changes operator deployment diagnostics only.
Status: completed
Updated: 2026-10-22
Completed: 2026-10-22
