# Hosted Runtime Launch Spec

## Goal

Move hosted runtime launch semantics into the local-first `@murphai/assistant-runtime`
owner package so Cloudflare acts as a thin executor/adapter.

Success criteria:

- One canonical runtime launch-spec primitive is exported from `assistant-runtime`.
- Cloudflare launcher/env helpers build the runtime manifest through that primitive.
- Transport-only concerns, including child-process env projection and loopback URL
  rewriting, remain outside runtime semantics.
- Existing hosted env filtering behavior is preserved unless a test proves a safer
  hard cut is available in this slice.
- Durable docs describe the new ownership boundary.

## Constraints

- Preserve unrelated dirty work in the shared checkout.
- Do not widen into active hosted LINQ cleanup, typing, or debug-log lanes.
- Do not expose local identifiers, secrets, or raw provider/contact identifiers.
- Keep package dependencies one-way and import through public entrypoints.

## Working Set

- `packages/assistant-runtime/src/hosted-runtime/**`
- `packages/assistant-runtime/src/hosted-runtime-contracts.ts`
- `packages/assistant-runtime/src/hosted-assistant-env.ts`
- `packages/assistant-runtime/test/**`
- `apps/cloudflare/src/runner-env.ts`
- `apps/cloudflare/src/hosted-env-policy.ts`
- `apps/cloudflare/src/node-runner.ts`
- `apps/cloudflare/test/runner-env.test.ts`
- `apps/cloudflare/test/hosted-env-policy.test.ts`
- `packages/assistant-runtime/README.md`
- `apps/cloudflare/README.md`
- `ARCHITECTURE.md`

## State

Implemented with focused proof. The launch-spec primitive now owns forwarded
env profile selection, child/platform env splitting, resolved runtime config,
commit-timeout parsing, and user-env sanitization. Cloudflare keeps only
adapter policy: ambient/container env source selection, container loopback URL
rewriting, runner-secret allowlisting, and supervisor env.

Old Cloudflare semantic seams (`splitHostedRunnerRuntimeEnv`,
`buildHostedRunnerResolvedConfig`, duplicate profile-key maps, and node-runner
child-control stripping) have been removed from the touched source/test surface.
Focused assistant-runtime and Cloudflare runner env/policy tests pass, as does
the hosted-assistant runner env suite. The broader node-runner suite now passes
37/39 tests; its two failures are the unrelated active protocol hard-cut
protocol/regimen fixture drift from the removed share-pack path has been resolved by
the completed share-pack hard cut. Full owner typechecks may still be blocked by
unrelated active hosted/CLI dirty work in the shared checkout.
Status: completed
Updated: 2026-05-02
Completed: 2026-05-02
