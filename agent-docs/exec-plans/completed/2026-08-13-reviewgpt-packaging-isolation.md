# Isolate concurrent ReviewGPT packaging

Status: completed
Created: 2026-08-13
Updated: 2026-08-13

## Goal

- Let the repository-required preliminary and final ReviewGPT passes package
  one exact PR head concurrently without sharing cleanup state, overwriting an
  intermediate ZIP, or exposing the package-manager checkout banner through
  the canonical documented invocation.

## Success criteria

- Every PR-bound packager invocation owns and removes only its private context
  staging directory.
- Default ReviewGPT audit ZIP prefixes are collision-resistant while callers
  with an explicit output directory retain their deterministic naming contract.
- The guarded ZIP retains the canonical `review-gpt-pr-context/**` paths and
  the existing full-snapshot versus correction-packet contents.
- PR-bound packaging rejects default, `--both`, and `--txt` output before
  producing an incomplete artifact, and repo-visible candidates cannot shadow
  the canonical context namespace.
- The documented preliminary and final commands use the silent package-manager
  form, and later-round anchor examples distinguish derived full snapshots from
  same-thread deltas.
- Focused hermetic concurrency coverage, shell syntax, relevant tooling tests,
  typecheck, and doc drift checks pass.

## Scope

- In scope: ReviewGPT PR-context staging, its intermediate audit ZIP naming,
  the canonical completion-loop commands and anchor explanation, and focused
  packaging regression coverage.
- Out of scope: browser-lane scheduling, review policy, PR-head authority,
  lock lifecycles, product/runtime code, and changes to the upstream repo-tools
  package.

## Constraints

- Technical constraints: preserve the activation head's expected-PR-body
  digest checks; keep stable paths inside `codebase.zip`; use only
  invocation-owned temporary state and existing `zip` tooling; do not add a
  shared lock or lifecycle owner.
- Product/process constraints: base the work on activation PR #1785's exact
  head, keep the change internal to repository tooling, and leave push/PR work
  to the parent after activation merges.

## Risks and mitigations

1. Risk: private physical paths leak into the ZIP or evidence manifests.
   Mitigation: separate the physical staging directory from the fixed archive
   prefix and inspect every generated ZIP entry in hermetic coverage.
2. Risk: narrowing correction packets regresses when the staged directory is
   appended after base packaging.
   Mitigation: prune full-only context files before appending the stable context
   tree and retain the existing round-mode integration suite.
3. Risk: unique naming breaks Frog's deterministic parent archive path.
   Mitigation: add entropy only to the default shared output path; preserve
   explicit `--out-dir` naming.
4. Risk: a PR-bound TXT is reported without its staged context, or a repository
   candidate shadows a canonical context entry.
   Mitigation: accept only explicit `--zip` for PR-bound packaging and reject
   any repo-visible canonical-namespace candidate before artifact creation.

## Tasks

1. Isolate PR context and default ZIP prefixes per invocation without a lock.
2. Add a hermetic two-process packaging regression and retain existing packet
   coverage.
3. Correct silent ReviewGPT commands and conditional later-round anchor
   guidance.
4. Run focused and scoped verification, inspect/privacy-scan the diff, close
   this plan, and create one local commit.

## Decisions

- Keep `review-gpt-pr-context` as the archive contract while moving its physical
  construction beneath a private `mktemp` directory.
- Append the selected context files to the completed ZIP instead of teaching
  prompts about random physical paths.
- Preserve explicit output-directory naming because those callers already own
  their destination; randomize only the shared default-output prefix.
- Keep PR-bound output ZIP-only until every format has a truthful staging
  mechanism; fail closed before invoking the underlying packager for default,
  `--both`, or `--txt` requests.
- The stable context tree is appended after the repo-tools snapshot completes.
  This keeps private physical paths out of its manifest and preserves the
  existing prompt/archive contract without adding source-to-archive mapping to
  the shared package.

## Verification

- Passed: focused format-contract and two-process concurrency Vitest, including
  canonical-path exclusivity; existing ReviewGPT round-mode integration
  coverage; ReviewGPT workflow-document assertions; CLI typecheck;
  `bash -n scripts/package-audit-context-full.sh`; `git diff --check`; and
  `pnpm docs:drift`.
- `pnpm test:diff` reached 588 passing repo-tool tests but was blocked by two
  unrelated Frog test timeouts and one unrelated Frog process-disappearance
  timing assertion on the loaded host. Its earlier workspace-boundary guard
  also reported two pre-existing violations in untouched hosted-web tests.
- After the deep-review compatibility correction, `pnpm test:diff` again passed
  the global syntax, architecture, request-boundary, TypeScript-tool, and
  dependency checks and reproduced those two untouched workspace-boundary
  violations. The repo-tools lane then reached 585 passing tests but could not
  load one unrelated wearable-fixture suite because the host supplied Node 20
  while this checkout requires Node 24.14.1 or newer.
- Expected outcomes: both simultaneous packagers succeed with different ZIPs,
  stable and isolated context contents, no leaked staging paths, and all
  relevant repository checks pass.
Completed: 2026-08-13
