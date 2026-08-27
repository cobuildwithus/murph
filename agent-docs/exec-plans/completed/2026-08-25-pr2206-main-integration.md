# PR 2206 current-main integration

Status: completed
Created: 2026-08-25
Updated: 2026-08-27

## Goal

Ship the sample JSON/CSV recovery slice on current `main` while preserving one
shared error projector and no partial writes or submitted-value echo.

## Evidence

- PR 2206 round one found that CSV inference serialized unvalidated row-zero
  cells into model-facing repair output.
- Round two proved removal of raw header/cell serialization, atomic invalid
  imports, and batch list-to-show compatibility, then returned
  `ROUND_OUTCOME: PASS`.
- The later foundation integration has local proof but has not received a
  post-`main` exact-head ReviewGPT round.
- Current `main` through `8ee6b16f34` was merged at `72849c7692`. Its newer
  exact-base lazy-bundle comparison supersedes this PR's absolute-cap ratchet,
  so the conflict resolution deletes the obsolete PR delta instead of composing
  two bundle-growth owners.
- Focused verification passes: 268 sample and shared-boundary tests, 14 runner
  bundle tests, all six affected package typechecks, prepared runtime, CLI
  package shape, and both docs gates.
- Canonical runner assembly passes all eight parity probes. The Vault CLI is
  9,502,535 bytes against a 9,508,867-byte budget; the runner is 11,335,561
  bytes against an 11,393,617-byte budget.
- Round three found that the current-main integration preserved only primitive
  types for correctly typed semantic failures. The finding is accepted: the
  existing finite sample mapper will retain fixed value-free constraints while
  the shared projector remains unchanged.
- The round-three remediation covers negative and fractional heart rate,
  invalid timestamps, zero and fractional sleep duration, invalid sleep stage,
  and incompatible units. Focused use-case and command tests prove value-free
  repair hints, zero sample or batch writes, and an unchanged audit-record
  count; affected typechecks and the 14-test runner bundle suite pass.
- A post-remediation assembly exceeded the existing 60-second probe ceiling
  under transient host contention, but the same command completed in 57.43
  seconds on a warm repeat. The temporary 120-second ceiling and expanded
  process diagnostic were unrelated to sample recovery and were removed during
  the round-five retrospective; the existing runner-harness behavior remains.
- Round four found that semantic CSV failures crossed Core without retaining the
  existing finite, value-free sample constraint. The accepted correction keeps
  the importer as the single CSV failure owner: it carries only the safe import
  index, canonical stream, and finite sample field, then reuses the existing
  Vault-usecase sample mapper rather than adding a second constraint table.
- Both mutating CSV command leaves now return `invalid_payload`, validation
  stage, `imports.<index>.samples`, and the fixed owner hint for negative or
  fractional heart rate and incompatible units. Focused proof covers a later
  import index, non-echo, zero samples/batches/audits, and the unchanged success
  path; importer, Vault-usecase, and CLI tests and typechecks pass.
- Exact corrected-head production assembly passes all eight parity probes. The
  Vault CLI is 9,503,331 / 9,508,867 bytes with an 805-byte entry and
  25,155-byte static closure; runner total is 11,336,664 / 11,393,617 bytes.

## Design

- Current `main` owns shared projection, CLI guidance, and generic diagnostics.
- Sample/importer owners retain only their finite public-field mappings and
  pre-write validation.
- Runner assembly retains its existing probe boundary unchanged. Current
  `main` owns lazy-bundle growth through one exact-base comparison while the
  existing entry/static budgets remain local guards.
- Regenerate CLI artifacts without adding a second bundle-growth policy,
  registry, repair channel, retry manager, state owner, or compatibility layer.

## Round-five anomaly retrospective

- Trigger: final ReviewGPT round five at
  `2de37f17a9b4636b2b64fea60e6bbd1d2e5cc9cc` returned
  `RETROSPECTIVE_REQUIRED`. Authored-source churn remains below the 2,000-line
  threshold, but a fifth substantive round independently requires the
  retrospective before another tactical correction.
- Original requirement: when JSON or CSV sample validation rejects a command,
  return one bounded, value-free public field, validation stage, and fixed
  constraint that lets the assistant correct and retry the same command. The
  rejected operation must create no sample, batch, or audit write. Runner
  timeout policy and process diagnostics are explicitly outside this outcome.
- Shape comparison: the first-reviewed head
  `54665cf653a11f010a70100ee3f5a976b68fd39c` grew to 730 additions and 80
  deletions of authored source at the round-five head. Across the current PR's
  touched-file set, that head-to-head delta is 333/181 authored source, 745/50
  tests, 296/0 docs, 26/10 runner tooling, and 1/1 generated output. The full
  current PR is 2,174 additions and 97 deletions; most review-driven growth is
  proof and plan history rather than production machinery.
- Growth attribution: round one removed raw CSV row-zero serialization; round
  two repaired batch list-to-show compatibility and expanded non-echo/atomicity
  proof; current-main integration composed the shared projector and generated
  artifacts; round three restored fixed constraints for correctly typed sample
  failures; round four carried only `importIndex`, canonical `stream`, and
  finite `sampleField` across CSV planning/import before reusing the same sample
  mapper. The temporary parity-probe timeout and diagnostic expansion was an
  unrelated verification-harness accommodation.
- Concept inventory: Core remains the pre-write semantic validator. The
  importer remains the CSV planning/write owner and carries only safe location
  metadata. `sampleImportIssue` remains the one finite constraint mapper in the
  Vault-usecase owner. The CLI has one `invalid_sample` conversion branch, then
  delegates to the unchanged shared projector. No registry, protocol, repair
  service, second mapper, state owner, retry path, or compatibility layer was
  added. The temporary runner timeout constant and expanded diagnostic are
  removed; the measured total-byte cap and its boundary test remain because the
  shipped CLI graph grew.
- Decision: continue with the current Core -> importer -> finite
  `sampleImportIssue` -> shared projector chain and shrink the unrelated runner
  tooling. Combining the finite mapper with Core would make Core own
  model-facing paths; moving it into the importer would duplicate JSON and CSV
  constraints; deriving constraints from primitive error prose cannot preserve
  the fixed privacy-safe semantic rules. The existing chain is therefore the
  smallest design that preserves atomicity, non-echo, accurate public paths,
  and actionable constraints.
- Scope-shrink proof: restore both parity probes to the existing 60-second
  ceiling and restore their existing `spawn_error`/signal/missing-status
  diagnostic. Retain only the 8,212-byte measured lazy-graph cap ratchet and its
  exact boundary test; no sample behavior or test is removed.
- Focused verification after the shrink passes the 14-test runner-bundle suite,
  the Cloudflare package typecheck, agent-doc drift and gardening gates,
  `git diff --check`, and the identifier/privacy scan. The runner source blob
  now exactly matches its pre-timeout parent while the separate bundle boundary
  test remains unchanged at the measured sample-recovery budget.
- Current `main` through `7f7805be95` is integrated. Conflict resolution keeps
  the current-main runner behavior and comments, composes only the reviewed
  8,212-byte sample allowance for a 9,588,702-byte total boundary, selects the
  current-main sample-test import superset, and regenerates the CLI schema,
  command metadata, and skill hash from their authored sources.
- Post-integration proof passes the 14 bundle-boundary cases, all 23 composed
  provider/event/sample cases, CLI and Cloudflare typechecks, prepared runtime,
  package shape, and canonical runner assembly. The Vault CLI is 9,543,029 /
  9,588,702 bytes with an 805-byte entry and 25,155-byte static closure; all
  eight parity probes pass and the runner is 11,385,495 / 11,393,617 bytes.
- Round six found that `no_importable_rows` serialized per-stream skip counts
  into importer-owned English and the CLI parsed and summed that prose as
  physical-row counts. One invalid physical row recognized as two sample
  streams therefore became two skipped rows in user guidance. The finding is
  accepted because the code path proves both the duplicate prose ownership and
  the count inflation.
- The correction deletes the generic repair-field protocol, skip-reason prose
  formatter/parser, and CLI count aggregation. The importer now carries only a
  finite failure code, safe import indexes for an empty plan, or the existing
  import index/canonical stream/finite sample field tuple for semantic errors.
  One exhaustive CLI switch owns the fixed messages and field issues.
- Focused proof passes all 29 importer owner tests, all 10 sample/audit CLI
  journeys, both affected package typechecks, prepared-runtime generation, CLI
  package-shape verification, and all 14 runner-bundle boundary tests. The CLI
  journey uses one physical row recognized as heart rate and steps, verifies
  both safe import paths, and proves the resulting guidance contains no row
  count or raw cell value.
- The post-remediation canonical runner assembly passes all eight parity probes.
  The Vault CLI is 9,541,592 / 9,588,702 bytes with an 805-byte entry and
  25,155-byte static closure; runner total is 11,383,774 / 11,393,617 bytes.
- Round seven found that the shared JSON-import recovery path also projected
  typed `samples add` failures as `samples.<index>.<field>`, even though that
  command accepts the sample fields directly. The finding is accepted: a
  negative typed heart-rate value reported `samples.0.value`, which the caller
  could not supply on retry.
- The correction keeps Core attribution and `sampleImportIssue` single-owned.
  The two existing callers now provide one required `direct` or `indexed` path
  shape to the existing projector. Typed add reports `value`; JSON import keeps
  `samples.<index>.value`; top-level `stream` and `unit` behavior is unchanged.
  No validator, mapper, constraint table, service, state, or compatibility path
  was added.
- Focused proof passes the two Vault-usecase boundary cases and the three exact
  CLI journeys: successful typed add, negative typed recovery at
  `value`, and indexed JSON-import recovery at `samples.0.value`. Both failure
  paths retain the fixed constraint, echo no rejected value, and create no
  sample, batch, or audit write. Vault Usecases and CLI typechecks pass.
- A broader 34-test CLI invocation passed all 33 sample/provider journeys and
  timed out only in the unrelated top-level audit-registration test at its fixed
  60-second ceiling. The exact three-journey rerun passed without that unrelated
  registration path.
- Final prepared-runtime generation, CLI config-schema generation, and CLI
  package-shape verification pass. The commit hook's earlier schema-generation
  warning was reproduced as the CLI seeing the pre-change Vault Usecases build;
  the canonical prepared-runtime build refreshed that dependency, after which
  the same generator passed without a source change or compatibility shim.
- After current-main integration, the dedicated runner-bundle suite still
  passes 14/14, and affected typechecks, prepared-runtime generation,
  config-schema generation, and package-shape verification pass. Two local
  production assemblies reached the unchanged 60-second CLI manifest timeout
  at `--llms-full --format json` under shared-host contention, so no timeout or
  diagnostic machinery was reintroduced.
- One bounded canonical Testbox acceptance run exercised immutable tree
  `4748adaa76c49e55ab71ea21398732cd76b257b2` with the default 16-CPU profile.
  It passed the repository typecheck, docs/prepared-runtime/package-shape work,
  Web build, the Vault-usecase coverage containing the round-seven fix, and the
  14 runner-bundle cases, then exited one after package coverage reported four
  package failures. The Testbox stopped automatically.
- Only Importers among those four packages is changed by this PR. Its full
  coverage run exposed one stale coverage-only assertion that still matched the
  deleted `no_importable_rows` prose. The assertion now checks the existing
  typed `CsvSampleImportError.failure` contract, matching the primary importer
  test without changing runtime code; the focused file passes 24/24 and full
  Importers coverage passes 573/573 across 19 files.
- Inbox Services, another remotely reported package with no PR diff, passes
  locally at 67/67. Assistant Engine also has no PR diff; its local coverage
  process was explicitly stopped after more than ten minutes of CPU-bound,
  output-free shared-host contention. Hosted Local Harness likewise has no PR
  diff and was not rerun locally. Required exact-head GitHub checks own the
  remaining broad-suite proof.
- Current-main conflict resolution is deletion-first: the old absolute Vault
  CLI total allowance and its boundary delta are absent. Current `main` remains
  the sole lazy-growth owner through exact-base comparison; this PR retains no
  second cap, timeout, or compatibility mechanism.
- Round eight found that CSV semantic validation still happened inside each
  canonical stream write. A valid first stream could therefore commit before a
  later stream failed, even though the CLI returned only the later validation
  error. The pre-fix CLI regression reproduced one committed batch from a file
  containing valid SpO2 followed by invalid heart rate.
- The accepted correction extracts Core's existing sample preparation into one
  private function and exposes a non-writing validation call that reuses it.
  The CSV importer validates every nonempty planned stream before entering its
  unchanged write loop. No semantic rule, constraint mapper, rollback path,
  transaction coordinator, state owner, queue, or reconciliation mechanism is
  duplicated or added.
- Focused proof passes Core's non-writing validation test, three importer port
  and ordering tests, and three real CLI journeys. Both mutating CSV command
  spellings and both stream orders reject the later invalid stream with zero
  sample records, batch/raw files, or audit writes; after editing the same file
  in place, both streams import exactly once. Core, Importers, and CLI
  typechecks pass. The CLI cases retain the existing per-test 60-second limit;
  no timeout or worker policy changed for shared-host contention.
- Product UX remains a Patch. The affected person is a member or assistant
  importing one CSV with multiple recognized sample streams. The walkthrough
  proves the rejected file can be corrected in place without hidden partial
  state, value echo, or a duplicate first-stream retry.
- ReviewGPT round nine returned a valid full-snapshot `ROUND_OUTCOME: PASS` at
  `d7fc7c16bb017c5b348d919ec7223948c8383702`. It verified the round-eight
  correction, every prior finding, same-file recovery, and the absence of a
  duplicate validator, rollback owner, retry lifecycle, or other qualifying
  correctness or complexity issue.
- Trust evidence is complete despite the response text reporting
  `MODEL_CONFIRMATION: UNKNOWN`: the exact committed turn, guarded ZIP, pushed
  head, completion marker, and substantive full-snapshot response are captured;
  persisted browser metadata identifies the compatible `gpt-5-6-pro` model;
  and the response elapsed well beyond the 7.5-minute final-gate trust floor.
- Every required GitHub check passes on the reviewed head. A current-base
  `git merge-tree --write-tree` succeeds with tree
  `d26fd091a43d46b4c15758889b0c4fd577f9f57e`, and the task worktree is clean.

## Tasks

1. [done] Merge current `main`, resolving duplicate foundation history by ownership.
2. [done] Prove the resulting tree is current `main` plus only the samples slice.
3. [done] Run focused tests, affected typechecks, prepared/package-shape checks,
   docs gates, runner-bundle proof, and the in-scope full Importers coverage
   suite; record the shared-host production-assembly timeout honestly.
4. Push the exact candidate, update the PR contract, and run the sensitive
   post-integration ReviewGPT round with the prior finding ledger. [done through
   the round-four finding and local correction]
5. [done] Record the round-five retrospective and remove the unrelated parity
   timeout/diagnostic expansion while retaining the sample behavior and measured
   bundle ratchet.
6. [done] Resolve later accepted findings, close the plan, admit the PR to CI,
   and prove the reviewed head is merge-ready.
Completed: 2026-08-27
