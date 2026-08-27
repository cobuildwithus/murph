# Vault CLI knowledge recovery final remediation

Status: completed
Created: 2026-08-24
Updated: 2026-08-24

## Goal

- Preserve tolerant vault readers while keeping query/exact-family validation strict, and
  make generated Health Commons artifact failures typed and actionable across their
  owning runtime, CLI, and experiment lifecycle boundaries.

## Success criteria

- Markdown parse mode is explicit at every reader call site; strict failures retain safe
  relative-path/line diagnostics and tolerant readers retain existing fallback behavior.
- Generated Health Commons protocol artifacts expose one privacy-safe unavailable/invalid
  category from the runtime loader through CLI and vault-usecase errors without echoing
  paths, contents, or raw causes.
- Unsupported vault format errors have a distinct safe query issue and the five stale
  query assertions reflect the current privacy-preserving contract.
- Focused tests prove strict/tolerant parsing, hosted device-activity scheduling,
  export/rebuild tolerance, Commons list/show/explore, and fail-closed experiment flows.
- Package tests, typechecks, runner bundle parity/boundary, privacy scan, and final diff
  inspection pass.

## Scope

- In scope: query Markdown parsing and source errors; Health Commons generated artifact
  loading; CLI Commons and experiment error mapping; vault-usecase experiment lifecycle
  recovery; focused tests and bundle budget updates caused by the implementation.
- Out of scope: changing generated artifact formats, adding repair state, making optional
  Commons knowledge search fail closed, or changing user-visible experiment semantics.

## Constraints

- Technical constraints: keep ownership in existing packages, preserve one-way public
  package imports, avoid raw Node error/path leakage, and do not weaken strict query reads.
- Product/process constraints: Product UX Patch; preserve no-write behavior on artifact
  failures; use Frog/worktree/commit workflow; no push, PR metadata changes, or ReviewGPT.

## Risks and mitigations

1. Risk: making the parser tolerant globally could admit malformed canonical query data.
   Mitigation: require explicit parse mode and keep all query/exact-family call sites strict.
2. Risk: boundary remapping could lose the unavailable-versus-invalid recovery signal or
   leak a raw filesystem error.
   Mitigation: define one typed category in the Health Commons loader and assert fixed,
   privacy-safe error details and no-write behavior at both downstream boundaries.
3. Risk: production-source changes could exceed or desynchronize the Cloudflare runner
   bundle ratchets.
   Mitigation: measure the assembled runner, ratchet only measured deltas, and run parity,
   boundary, and Cloudflare typecheck proof.

## Tasks

1. Make Markdown parse mode explicit and add strict/tolerant consumer proofs.
2. Move generated protocol artifact classification to Health Commons and preserve the
   typed category through CLI and vault-usecase boundaries with fail-closed tests.
3. Add the safe unsupported-format query issue and update stale assertions.
4. Run focused tests, typechecks, runner bundle proof, privacy scan, and inspect the diff.
5. Archive this plan and create one scoped local commit.

## Decisions

- Product UX effort is Patch: restore accurate, recoverable failures without changing the
  workflows themselves. Affected people are hosted assistants scheduling from tolerant
  device activity, export/rebuild callers reading legacy Markdown, Commons CLI callers,
  and members starting or editing experiments. Optional Commons search remains excluded.
- The existing tolerant/strict source readers own Markdown mode and pass it explicitly;
  exact-family reads stay strict. The shared parser has no path-presence heuristic.
- Generated protocol loaders classify only `unavailable` versus `invalid` and retain a
  safe artifact-stage token. CLI projection and the dynamic vault-usecase boundary map
  that typed result to the existing model-facing recovery codes without a raw cause.
- Unsupported format remains under the fixed `QUERY_SOURCE_INVALID` envelope with the
  new `unsupported_format` issue; current or submitted version numbers are not exposed.
- The measured runner total changed from 9,482,492 B to 9,485,094 B (+2,602 B). Entry
  (805 B) and static startup closure (27,716 B) were unchanged and remain below their
  existing limits.
- Frog entry `20260824054820-package-typecheck-accepts` records that a sibling type-only
  import passed package typecheck but failed the package build rootDir boundary. The
  implementation uses the existing dynamic runtime predicate and a structural local type.

## Verification

- Commands to run: focused Vitest targets in query, health-commons, CLI,
  vault-usecases, and hosted execution/Cloudflare as selected by inspected call paths;
  affected package typechecks; `pnpm --dir apps/cloudflare runner:bundle`; runner bundle
  tests; privacy scan; `git diff --check` and final scoped diff inspection.
- Expected outcomes: all focused behavior and type checks pass, runner bundle thresholds
  exactly match measured output, failures remain fixed and privacy-safe, and no unrelated
  files or identifiers enter the patch.
- Passed: query focused suites (106 tests), Health Commons runtime (29), CLI recovery and
  export suites (29), hosted device-activity suite (29), vault-usecase lineage suite (36),
  and runner bundle boundary suite (14).
- Passed: query, Health Commons, CLI, vault-usecases, assistant-engine, and Cloudflare
  typechecks; vault-usecases package build; runner assembly and parity probes.
- Passed: runner measurement at total 9,485,094 B, entry 805 B, and static closure
  27,716 B; `git diff --check`; direct-local-path/credential pattern scan over tracked and
  new task files.
Completed: 2026-08-24
