# Make Web and scenario-integrity verification entrypoints truthful

Status: completed
Created: 2026-08-13
Updated: 2026-08-13

## Goal

- Make the hosted Web single-file test entrypoint select only the owning named
  Vitest project, and make documented-command coverage the ordinary
  scenario-integrity contract.

## Success criteria

- The reported hosted Web exact-file reproduction runs only the requested file
  in `hosted-web-store-config`.
- `pnpm test:scenario-integrity` reports coverage verification without an
  extra caller flag.
- Focused regressions protect both command-construction contracts.
- Verification docs and the release fixture job describe and invoke the same
  default scenario-integrity contract.

## Scope

- In scope: hosted Web Vitest argument selection, project-spec reuse, focused
  repo-tool tests, the root scenario-integrity script, its release workflow,
  and current verification documentation.
- Out of scope: changing hosted Web test bucketing, adding executable E2E
  scenarios, product behavior, or deployment behavior.

## Constraints

- Technical constraints: preserve arbitrary Vitest arguments, infer a project
  only for an exact tracked Web test path, and keep explicit caller project
  selection authoritative.
- Product/process constraints: start at the exact activation head, use the
  sanctioned isolated worktree, keep durable artifacts free of local
  identifiers, commit locally, and do not push or open a pull request.

## Risks and mitigations

1. Risk: a broad or ambiguous Vitest filter could be mistaken for an exact
   file and hide intended tests.
   Mitigation: resolve the argument against the already-discovered exact file
   ownership in `hostedWebVitestProjectSpecs`; otherwise preserve the ordinary
   workspace fanout.
2. Risk: local and CI scenario verification could drift again.
   Mitigation: route both through `pnpm test:scenario-integrity` and add a
   focused source contract regression.

## Tasks

1. Add and unit-test exact Web test-file project inference.
2. Make scenario-integrity coverage the root default and align workflow/docs.
3. Run focused tests, direct reproductions, typecheck/docs checks, diff review,
   and privacy scan.
4. Archive the plan and create one scoped local commit.

## Decisions

- Keep project ownership in the existing workspace project specs; the wrapper
  only derives a CLI `--project` selection from that source of truth.
- Extract those specs to an app-owned `.mts` module so the workspace config,
  executable wrapper, and app-owned regression share one ESM-compatible source
  without pulling app files into the root tooling compiler boundary.
- Keep the verifier's non-coverage mode available to internal callers while
  making the named root command coverage-bearing.

## Verification

- Focused regressions passed: the scenario entrypoint suite ran 2 tests and the
  Web wrapper suite ran 6 tests through the package wrapper.
- The host-support workflow guard ran 6 tests, and the release-script coverage
  audit ran 43 tests with its existing 1 skip; both now protect the named
  entrypoints and their underlying coverage/no-coverage invariants.
- The reported Web reproduction ran 1 test file and 22 tests in its owning
  `hosted-web-store-config` project.
- Ordinary `pnpm test:scenario-integrity` reported coverage verification for
  206 scenarios, 12 sample inputs, and 29 golden-output directories.
- Root tooling TypeScript and the full hosted Web typecheck passed.
- `pnpm docs:drift` and `pnpm docs:gardening` passed after the canonical-doc
  index was aligned.
- Full hosted Web lint completed with 0 errors and 46 pre-existing warnings in
  unrelated files.
- `git diff --check`, changed-file whitespace inspection, and the changed-line
  privacy/secret scan passed.
- A local commit was not created because the repository worktree-storage guard
  reported unrelated unmanaged temporary checkouts outside this task's scope.
Completed: 2026-08-13
