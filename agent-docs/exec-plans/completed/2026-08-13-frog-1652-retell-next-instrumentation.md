# Compile the Retell E2E fault preload outside the production Web graph

Status: completed
Created: 2026-08-13
Updated: 2026-08-14

## Goal

- Make the hosted-local Retell call-result roundtrip fault injection run in the
  actual Web request server without a TypeScript loader or a test hook in the
  production Web composition.

## Success criteria

- The scenario selects a typed, fixed harness capability rather than a module
  path or production environment flag.
- The harness compiles the repository-owned test preload to CommonJS and passes
  only emitted JavaScript to the Web child with `--require`.
- `@temporalio/client` is external in every Web server artifact, so source and
  production-start request handlers share the preload's physical module.
- The production Next instrumentation graph remains free of the hook and the
  legacy flag has no effect on its real `register()` function.
- Exact E2E-profile, test-route, member, workflow, signal, and mailbox-lane
  gates remain enforced.

## Scope

- In scope: the harness-owned compiled preload, typed Retell scenario input,
  unconditional Temporal server externalization, focused Web and harness tests,
  and hosted-local verification documentation.
- Out of scope: production Temporal behavior, other hosted-local scenarios,
  test-control route semantics, deployment, and private-repository CI changes.

## Constraints

- Never accept a caller-provided preload path.
- Never compose a TypeScript module with the Web process's loader chain.
- Keep production instrumentation independent of hosted-local test behavior.
- Do not terminate a process, push a branch, or open a pull request during this
  local implementation pass.

## Tasks

1. Move the hook implementation and preload entrypoint under Web test support.
2. Compile the fixed entrypoint to CommonJS in a per-stack ignored output
   directory and clean it up with the stack.
3. Pass a typed exact-member selection from the Retell scenario to the harness.
4. Externalize the Temporal client consistently in production and smoke server
   artifacts.
5. Prove compiled-preload module identity, unchanged real source/emitted Next
   registration, exact gates, and both Web launch paths.
6. Update hosted-local ownership documentation and run scoped verification,
   privacy, and diff review.

## Verification

- Passed under Node 24: a fresh smoke Next build and focused Web
  instrumentation and Next-config coverage (52 tests, zero skips), including
  the emitted instrumentation `register()` and request-bundle Temporal module
  identity checks.
- Passed: the fixed source compiles to CommonJS and a `pnpm --dir apps/web`
  subprocess proves its absolute `--require` changes the app's physical
  Temporal client prototype.
- Passed under Node 24: prepared-production-start and source-development
  harness launch-path assertions (2 focused tests), including compile
  arguments, child environment, legacy-flag absence, and cleanup ownership.
- Passed under Node 24: Web, Cloudflare, and hosted-local harness typechecks;
  focused Web lint; documentation drift; whitespace and privacy checks.
- Not run: the private full Retell/Temporal scenario. The fresh local smoke
  artifact proves production composition and emitted module identity without
  exercising the private cross-repository services and credentials.

Completed: 2026-08-14
