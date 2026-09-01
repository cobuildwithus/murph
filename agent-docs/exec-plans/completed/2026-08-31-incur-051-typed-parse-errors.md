# Upgrade Incur 0.5.1 and type parse failures

Status: completed
Created: 2026-08-31
Updated: 2026-08-31

## Goal

- Upgrade Murph's three direct Incur consumers to reviewed `incur@0.5.1` while
  preserving the older patched version still owned by ReviewGPT.
- Make native Incur parse and validation failures reach humans and agents as a
  bounded, privacy-safe `VALIDATION_ERROR` with one useful recovery step instead
  of an untyped `UNKNOWN` failure.
- Keep unexpected failures generic, valid command behavior unchanged, generated
  discovery artifacts truthful, and the hosted runner's patch set exact to its
  resolved production graph.

## Product UX Patch

- Outcome: Invalid command arguments produce safe, actionable correction
  guidance without echoing submitted values; successful commands are unchanged.
- Reaches: Direct CLI operators, Codex-driven Murph CLI calls, setup/assistant
  CLI consumers, and the hosted runner that bundles the shared CLI.
- Proof: Source and built malformed-command regressions, exact runner-bundle
  dependency proof, regenerated discovery artifacts, and one focused synthetic
  real-Codex recovery journey with exactly one successful canonical write.

## Success criteria

- `packages/cli`, `packages/setup-cli`, and `packages/assistant-cli` resolve
  exact patched `incur@0.5.1`; ReviewGPT remains on patched `0.4.5` and Frog on
  `0.4.25`.
- The bundled CLI directly declares the new Incur runtime/type dependencies,
  package-shape verification passes, and the lockfile has no unrelated churn or
  release-age bypass for Incur 0.5.1.
- Native parse and outer validation failures return exit 1, `VALIDATION_ERROR`,
  fixed non-retryable validation guidance, and no submitted values, raw causes,
  nested paths, or provider details. Parse failures use `arguments`; opted-in
  public schemas may expose only an owned top-level field name; fixed config
  classifications expose only `config` plus missing-or-invalid state; private
  or unknown validation falls back to `input`.
- Unexpected exceptions still return `UNKNOWN`; a nearby valid command produces
  the same successful result and malformed input performs no vault write.
- Config/type/skill artifacts regenerate idempotently through Incur's declared
  executable, and the canonical skill hash remains derived from the complete
  registered CLI tree.
- The standalone runner bundle stages only the exact patched Incur version in
  its resolved production lock graph.
- A focused real-Codex journey corrects the typed argument error once, performs
  exactly one durable synthetic write, and returns concise truthful prose with
  no internal error language or private marker.
- Focused builds, typechecks, dependency guards, tests, docs checks, package
  proof, and required completion review report no unresolved actionable finding.

## Scope

- In scope:
  - Direct Incur manifests, lockfile, reviewed 0.5.1 patch registration/artifact,
    bundled runtime dependencies, generator executable resolution, and package
    shape assertions.
  - Privacy-safe error projection inside the patched dependency across CLI,
    HTTP/fetch, streaming, and internal command execution.
  - Existing Murph source/built CLI regressions, runner exact-version staging,
    generated artifacts, architecture/testing documentation, public changelog,
    and one focused real-Codex journey.
- Out of scope:
  - Removing or rewriting ReviewGPT's `incur@0.4.5` patch.
  - Upgrading Frog's transitive `incur@0.4.25` dependency.
  - Re-porting lazy YAML/MCP behavior already upstream in Incur 0.5.1.
  - Publishing a Murph CLI package release, editing package release history,
    deploying, changing persisted state, or changing Murph command topology.

## Constraints

- Technical constraints:
  - Apply the prepared privacy/error patch before the prepared skill-hash patch
    and verify both supplied SHA-256 digests before use.
  - Resolve Incur's executable from its installed package manifest with bounded
    package-relative validation; do not depend on another unvalidated internal
    path.
  - Stage runner patches by exact resolved lockfile package spec, not package
    name, while preserving deliberate minimum-release-age test fixtures.
  - Keep sibling workspace imports on declared package entrypoints and avoid
    new dependencies or abstractions beyond the demonstrated publish/runtime
    needs.
- Product/process constraints:
  - Preserve the pre-train base; the parent owns one later refresh after earlier
    CLI PRs land.
  - Work only in the sanctioned task worktree. Do not push, open/update a PR,
    merge, or create the final task commit without parent direction.
  - Use synthetic, private-free test values and never persist live transcripts,
    credentials, local identifiers, or production evidence.
  - Keep the active plan current, rerun Frog after the frozen install, and include
    any qualifying friction entry in the eventual scoped task commit.

## Risks and mitigations

1. Risk: Both Incur patch registrations cause the hosted bundle to copy a
   dev-only version or split Incur's module-level command registry.
   Mitigation: Match exact resolved package specs and prove a two-registration,
   one-resolution fixture plus the production bundle path.
2. Risk: Bundling Incur strips its dependency metadata and omits new runtime or
   declaration dependencies from the published CLI.
   Mitigation: Mirror reviewed Scalar and MCP specs directly and verify the
   packed package shape and installed consumer smoke path.
3. Risk: Error projection leaks a malformed argument, credential-shaped value,
   absolute path, or nested cause.
   Mitigation: Use fixed parse/outer-validation messages and field metadata,
   preserve only bounded `shortMessage`, and assert absence across source and
   built stdout/stderr.
4. Risk: Regeneration silently changes commands, provider-visible guidance, or
   skill identity.
   Mitigation: Generate only after the final patched install, inspect all three
   owned artifacts, rerun for idempotence, and stop on unintended topology or
   provider-input drift.
5. Risk: A dependency upgrade passes source tests but fails the emitted/bundled
   package boundary.
   Mitigation: Build all three CLI packages, exercise final `dist/bin.js`, run
   package-shape and standalone runner proof, and let exact-head CI own broad
   verification after the parent's refresh.
6. Risk: Model recovery loops or duplicates a write.
   Mitigation: Deterministic envelope/write proof precedes a focused live journey
   with exact malformed-attempt, corrected-write, durable-effect, and no-third-
   attempt assertions.
7. Risk: Lockfile deduplication resolves ReviewGPT's patched Incur 0.4.5 against
   an MCP server release whose stdio transport moved to a subpath.
   Mitigation: Pin only the 0.4.5 transitive edge to its compatible alpha.2
   server and exercise that exact installed edge through an in-memory MCP
   initialize, tool discovery, and tool call regression.

## Tasks

1. Verify worktree ownership/base, inspect the prepared artifacts and existing
   patch/dependency graph, populate this plan, and complete Frog preflight.
2. Update the three manifests, bundled dependency assertions, workspace policy,
   generator executable resolver, and runner exact-version staging with focused
   tests.
3. Install the reviewed 0.5.1 graph intentionally, extract it through `pnpm
   patch`, apply the two verified prepared patches in order, syntax-check changed
   distribution files, and commit the new patch artifact into workspace policy.
4. Refresh the lockfile and prove exact direct/transitive Incur ownership plus
   frozen install and dependency supply-chain invariants.
5. Add source/built privacy-safe parse regressions, bridge/package regressions,
   generator/bin resolution proof, and runner bundle exact-version proof.
6. Regenerate and inspect config schema, Incur types, and canonical skill hash;
   rerun generation for idempotence.
7. Update live architecture/testing documentation and add a plain-language
   public changelog item after an actual PR number is available; do not invent a
   source PR.
8. Add and run one focused synthetic real-Codex recovery journey after the
   deterministic boundary is green; inspect its actual reply and record
   `Ready` or `Hold`.
9. Run focused builds, typechecks, tests, package/bundle proof, dependency and
   docs guards; update this plan with exact outcomes.
10. Run the required completion audits when the candidate is stable, disposition
    evidence-backed findings, rerun invalidated checks, and hand the parent the
    exact diff/check status without pushing, merging, or final-committing.

## Decisions

- Product UX effort is `Patch`: this restores existing CLI correction behavior
  without adding a user surface, audience, data source, authority, or persisted
  state.
- Keep both `incur@0.4.5` and `incur@0.5.1` patch registrations because they have
  distinct live consumers; removal is not an upgrade prerequisite.
- Keep ReviewGPT's Incur 0.4.5 on MCP server alpha.2 with a version-scoped
  override. Incur 0.4.25 and 0.5.1 remain on alpha.4 because both contain the
  newer stdio-subpath compatibility path.
- Keep upstream 0.5.1 lazy YAML/MCP and native ValidationError work instead of
  copying obsolete local hunks.
- Add no Incur release-age exception; 0.5.1 is already older than the workspace
  admission window.
- Treat the public changelog as member-visible recovery proof, but wait for the
  real PR number before authoring its `sourcePullRequests` field.

## Verification

- Planned commands:
  - `pnpm install --frozen-lockfile`, `pnpm why incur -r --depth 1`, `pnpm
    deps:guard`, `pnpm deps:audit`, and `pnpm deps:ignored-builds`.
  - `pnpm --dir packages/cli gen:config-schema` twice plus package-shape and
    focused config/skill/error/release tests.
  - Builds and typechecks for CLI, setup CLI, assistant CLI, and Cloudflare when
    its runner staging changes.
  - Focused setup/assistant bridge tests, Cloudflare runner-bundle dependency
    install test, `pnpm verify:cli`, docs drift/gardening, and changelog tests.
  - `pnpm test:assistant:live -- --test "repairs a typed CLI argument error once
    without duplicating the write"` after deterministic proof.
- Expected outcomes:
  - Frozen install and generated-artifact reruns are clean.
  - Exact version/patch ownership matches the success criteria with no unrelated
    lock or package churn.
  - Source, emitted CLI, packed consumer, and hosted bundle paths all preserve
    valid behavior and emit only the bounded validation envelope for malformed
    arguments.
  - Live journey has one malformed attempt, one corrected write, one durable
    effect, no duplicate/bad call, and a manually reviewed `Ready` reply.

## Progress

- 2026-08-31: Dedicated sanctioned worktree confirmed at the requested
  pre-train base; only this parent-created plan is untracked.
- 2026-08-31: Required Incur, assistant-verification, completion-audit,
  changelog, and Frog skill instructions reviewed. Initial Frog list is blocked
  by the intentionally not-yet-installed fresh worktree and will be retried
  immediately after install.
- 2026-08-31: Upgraded the three direct consumers to exact patched
  `incur@0.5.1`, retained ReviewGPT on patched `0.4.5` and Frog on `0.4.25`,
  declared the new bundled runtime/type dependencies, and kept Incur 0.5.1 out
  of the release-age exception list. `pnpm why incur -r --depth 1` confirms
  exactly those three versions and owners.
- 2026-08-31: Canonical patch SHA-256 is
  `ea430fcb868b6c81cbb521247c7300e6a189f527249c650e4d045b4b96cb3fcf`.
  Source and emitted runtime now project native parse/outer validation failures
  to fixed non-echoing `VALIDATION_ERROR` envelopes across CLI, fetch, HTTP,
  MCP streaming, and internal execution. Early built-in/global failures share
  one safe renderer that honors explicit machine formats and retains the fixed
  recovery hint in TTY output. Public schema detail is opt-in and limited to an
  owned top-level field; missing, invalid, and unreadable config files use fixed
  privacy-safe classes. Unexpected exceptions deliberately remain `UNKNOWN`;
  generic unexpected messages and the pre-existing update, skills, MCP-add, and
  doctor diagnostic paths remain outside this production parse/validation fix.
- 2026-08-31: The generator resolves Incur's declared package-relative
  `bin.incur` target. Two final post-install generation passes were byte-stable:
  config schema `40e69691a36bcdd408f35e5de28a60672a6d916d491076aaabc0dbc5c2721cc5`,
  generated types `face5be567a855f3d5f7d902d0c1a984571133157d3de2b2190e9981e66334ef`,
  and canonical skill hash module
  `f4652f05c8c6ba2e8c0174d7818cb272b8e9b2518c79f6ebe0f970c5f5157cab`.
- 2026-08-31: Final dependency proof: the frozen install passed with the exact
  lockfile; dependency policy and ignored-build checks passed. The workspace
  advisory command remains red with 80 current advisories (1 critical, 34
  high, 39 moderate, 6 low); machine-readable inspection found zero advisory
  paths referencing Incur, the new MCP server, or Scalar dependency. The only
  matching CLI-consumer path is unchanged `sharp`.
- 2026-08-31: Final deterministic proof passed: focused final remediation
  10/10; complete `pnpm verify:cli` 431/431 across 21 files; runner bundle
  17/17; changelog registry/archive 55/55; focused release guards 2/2; CLI
  package shape; CLI, setup CLI, assistant CLI, assistant engine, and Cloudflare
  typechecks; CLI, setup CLI, assistant CLI, and Cloudflare builds; docs drift
  and gardening; complexity with zero debt; and `git diff --check`.
- 2026-08-31: The opt-in real release-tarball test passed and proves bundled
  Incur 0.5.1, `./dist/cli/index.js`, retained runtime/source entrypoints, and
  omission of non-runtime docs and test/type-test sources. The initial tarball
  scan identified only upstream `docs/binaries.md` and `*.test-d.ts` examples;
  narrowing the existing non-runtime filter removed those files without
  changing runtime, declarations, binaries, or source-map targets.
- 2026-08-31: The focused real-Codex journey is `Ready`: one malformed import,
  one repaired import, one persisted meal, no help loop or third attempt, and
  a concise truthful confirmation. The expected first nonzero tool action is
  recorded as one bounded runtime warning; no private marker or CLI mechanics
  reached the reply.
- 2026-08-31: Preliminary privacy/coverage audits found one shared medium issue:
  early validation hardcoded TOON and omitted the TTY hint. Accepted and fixed
  with the shared format-aware renderer plus JSON and TTY regressions. A final
  privacy rerun passed. The coverage rerun then found one low test-only mismatch:
  a patched upstream test requested JSON but used a TOON-only assertion helper.
  The test now parses and verifies the exact private-safe JSON envelope. Its
  post-fix frozen install, distribution syntax checks, focused 80/80 and 3/3
  tests, 17/17 runner tests, two release guards, complete 424/424 CLI gate, and
  real packed-tarball proof all pass. The final coverage, simplification,
  packaging, and task-finish audit reports `PASS` with no remaining finding.
  The earlier full release-audit file run had
  47 passing, one skipped, and one unrelated ReviewGPT wrapper timeout; its two
  task-specific release guards and the opt-in packed test pass independently.
- 2026-08-31: Frog recheck found existing coverage for fresh-worktree linking
  and removed-ledger friction. New reproducible lockfile churn from
  `pnpm patch-commit` is recorded as
  `20260831182059-pnpm-patch-commit`; unrelated peer snapshot rewrites were
  removed from the candidate lockfile before the final frozen install.
- 2026-08-31: Public changelog entry
  `murph-recovers-from-invalid-command-inputs` now references real PR #2666;
  no source PR was invented before that number existed.
- 2026-08-31: A final transitive-graph review proved that ordinary lockfile
  deduplication had moved ReviewGPT's patched Incur 0.4.5 from its compatible
  MCP server alpha.2 to alpha.4, where that older Incur build cannot construct
  the stdio transport. Accepted the finding and added one version-scoped
  override. The lock now retains alpha.2 only for Incur 0.4.5 while Incur 0.4.25
  and 0.5.1 remain on alpha.4. A real in-memory initialize, tools/list, and
  tools/call regression passes through ReviewGPT's exact installed Incur edge;
  all six focused ReviewGPT dependency/configuration tests pass under CI.
- 2026-08-31: The first post-relink CLI typecheck replayed 1,384 diagnostics
  from an ignored incremental cache poisoned by the earlier filtered ReviewGPT
  toolchain install. The identical clean checker passed with incremental state
  disabled. Removing only `packages/cli/typecheck.tsbuildinfo` and rerunning the
  ordinary package command also passed, confirming no tracked source or graph
  correction was required.
- 2026-08-31: A fresh parent review found five production error-boundary gaps:
  MCP SDK pre-validation could expose schema refinement text; malformed HTTP
  JSON could be swallowed before an optional write; vars validation occurred
  outside the typed error boundary; later TTY validation dropped its recovery
  hint; and four root built-ins without values fell through to
  `COMMAND_NOT_FOUND`. All five were accepted and fixed at their existing
  parser/transport owners. Real direct and progressive MCP sessions, malformed
  and null HTTP bodies with zero handler calls, fetch-gateway raw-body
  preservation, vars failures, TTY hints, and all four missing-value flags now
  have focused regressions.
- 2026-08-31: The patched upstream source is independently typechecked. That
  gate caught `Parser.zodParse` erasing concrete schema output types at the new
  deferred MCP boundary; its generic declaration now preserves `z.output` with
  no runtime JavaScript change. The source check, installed dist syntax checks,
  source/dist parity review, frozen reinstall, patch-hash check, lockfile churn
  check, clean CLI checker, assistant-engine and Cloudflare checkers, complexity
  guard, and `git diff --check` all pass.
- 2026-08-31: Draft PR #2666 now owns the real source reference. Added the
  public entry `2026-08-31 · murph-recovers-from-invalid-command-inputs`;
  the production changelog archive test passes 9/9 and directly renders the
  authored title, summary, details, and source link.
- 2026-08-31: Final ReviewGPT recovery finding accepted. One closed
  `ParseError.kind` discriminator now classifies arguments and the three owned
  config outcomes; `ValidationError.publicIssues` is opt-in and carries only a
  schema-owned top-level path, missing state, and allowlisted code. Raw Zod
  messages, values, nested paths, causes, and filesystem paths remain private;
  unknown or private validation uses the generic fallback. No subclass,
  dependency, service, state owner, or compatibility layer was added.
- 2026-08-31: Final packaged-patch parity, privacy, coverage, simplicity, and
  task-finish audits report `PASS`. The focused real-Codex recovery journey is
  `Ready` on the first authorized alternate subscription home after the default
  home failed before provider action: two import attempts, exactly one durable
  synthetic meal, no help loop or third attempt, and concise truthful prose.
Completed: 2026-08-31
