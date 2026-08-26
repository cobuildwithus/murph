# Split oversized test modules by behavior

Status: active
Created: 2026-08-25
Updated: 2026-08-25

## Goal

- Reduce the remaining clearest test-module monoliths into behavior-owned files
  with adjacent shared harnesses, preserving every assertion and test-discovery
  contract while making runner memory and future edits easier to reason about.
- Add one compact durable testing guideline that favors cohesive behavior seams
  over a mechanical line-count gate.

## Success criteria

- The largest hand-authored test modules are inventoried and explicitly
  classified as split-now or keep-together.
- Each selected module is replaced by cohesive test files plus only the minimum
  shared harness needed to avoid duplicated setup.
- Test declarations and bodies are preserved unless a verified ReviewGPT patch
  adds or corrects isolated proof.
- Focused tests, affected package typechecks, docs drift, and exact-head CI pass.
- Preliminary specialist ReviewGPT and the routed final ReviewGPT gate have no
  unresolved accepted findings; any returned test-only patch is parent-inspected
  and verified before application.

## Scope

- In scope: hand-authored `*.test.*` and `*.spec.*` outliers whose size reflects
  multiple behavior families or repeated heavyweight setup; adjacent harnesses;
  test-discovery/config proof; one small agent-docs note.
- Out of scope: production behavior, generated fixtures, snapshots, vendored
  content, line-count-only churn, and cohesive single-state-machine tests whose
  split would obscure an invariant.

## Constraints

- Technical constraints: preserve test order and semantics, keep imports narrow,
  avoid barrels or new framework abstractions, and retain ordinary package test
  discovery without special heap or CI branches.
- Product/process constraints: internal-only; Product UX and changelog are not
  applicable. Use the isolated worktree/PR lane, run focused local proof, and let
  exact-head CI own the broad suite.

## Risks and mitigations

1. Risk: mechanical moves silently drop or duplicate tests.
   Mitigation: compare normalized test declarations and test-body hashes before
   and after each split, then run every new file together.
2. Risk: shared setup becomes a broad utility layer.
   Mitigation: keep one adjacent owner-specific harness with explicit exports and
   extract only setup reused by more than one behavior file.
3. Risk: a repo-wide cleanup becomes unreviewable.
   Mitigation: select only the strongest outliers after structural inspection and
   record keep-together dispositions for the rest.

## Tasks

1. Inventory the largest test modules and inspect their responsibility/test
   boundaries, setup cost, and runner configuration.
2. Select the smallest defensible split set and record split/keep reasons.
3. Move selected tests into behavior-owned files and adjacent harnesses.
4. Add the compact durable test-module guidance and focused guard/doc proof.
5. Run focused verification, inspect the full diff, commit, push, and open a
   draft PR.
6. Run the preliminary specialist and final ReviewGPT passes concurrently with
   CI; inspect and apply only accepted test/fixture/direct-proof patch artifacts.
7. Resolve findings, close this plan through `scripts/finish-task`, and complete
   merge-readiness checks.

## Decisions

- A numeric size alone is not an automatic split gate. Responsibility mix,
  repeated heavyweight setup, and loss of runner isolation decide selection.
- Keep the current Vitest/CI ownership model; this task does not add jobs or heap
  exceptions.
- Split the four remaining hand-authored modules above 20,000 lines because
  each had multiple contiguous behavior families and a separable setup graph:
  workspace entrypoint (startup, mailbox, checkpoint, restore, shutdown), Codex
  runtime (configuration, process, turns, recovery, tools, events, steering),
  Junction provider (backfill, client, history, webhooks, resources, workout
  streams), and workspace assistant phase (scheduling, managed automation,
  device sync, delivery, foreground, logs).
- Keep the next large modules together in this batch when their current file is
  still one auditable owner: hosted runtime callbacks is one delivery callback
  transaction boundary, hosted onboarding Linq dispatch is one dispatch state
  machine, and importer Junction coverage is one normalization/import pipeline.
  Assistant automation runtime remains a future split candidate because it has
  multiple suites, but adding that lower-ranked seam would make this already
  broad structural PR harder to review without strengthening the current proof.
- Test modules import production and Vitest symbols directly. Adjacent harnesses
  export only owner-local mocks, hooks, and shared helpers; they are not test
  barrels or public package surfaces.

## Verification

- Commands to run: focused Vitest invocations for every selected old/new owner,
  affected package typechecks, test-discovery/order/body comparison, docs drift,
  `git diff --check`, exact-head required CI, and ReviewGPT.
- Expected outcomes: all original tests remain selected exactly once and pass on
  ordinary package settings; documentation remains internally consistent; no
  unresolved accepted review findings remain.
- Direct preservation proof: 298 entrypoint suite statements, 236 Codex runtime
  statements, 314 Junction statements, and 294 assistant-phase statements match
  their original source hashes exactly once across the new behavior modules.
- Local results: affected package typechecks pass; focused Vitest passes 275
  Codex runtime tests across 7 files, 474 Junction provider tests across 8 files,
  and 657 assistant-runtime tests across 22 files.
