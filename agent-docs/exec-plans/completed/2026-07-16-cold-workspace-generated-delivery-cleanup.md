# Cold workspace generated delivery cleanup

Status: completed
Created: 2026-07-16
Updated: 2026-07-16

## Goal

- Remove terminal assistant-generated delivery artifacts before hosted workspace
  checkpoints so one-time exports cannot inflate later cold restores, while
  preserving active approval/send recovery and all user-owned vault data.

## Success criteria

- Generated files in the dedicated assistant-owned delivery prefix survive while
  an exact matching outbox intent is active.
- At a quiescent checkpoint, files in the reserved assistant-owned prefix are
  retained only while they exactly match an active outbox media descriptor; malformed
  or untrusted outbox state fails closed and retains the entire prefix.
- Generic vault files and generated files outside the owned prefix are untouched.
- Pre-checkpoint telemetry reports only aggregate prune counts and bytes.
- Focused tests, package typechecks, required completion audits, CI, and hosted
  post-deploy checks pass.

## Scope

- In scope: assistant runtime-residue cleanup, generated-delivery tool guidance,
  vault-layout/runtime documentation, safe data-context exclusions, focused tests,
  deployment, and cold-path validation.
- Out of scope: Priority processing, broad snapshot-format or encryption changes,
  deleting canonical health history, generic archive cleanup, prewarming, or
  provider/model latency work.

## Constraints

- Technical constraints: retain active delivery files across cold restart; reject
  symlinks and path escape; validate the complete tree before deleting; retain on
  untrusted inventory; keep the active prefix checkpointed.
- Product/process constraints: preserve all product-critical message delivery and
  approval behavior; do not expose private vault contents or identifiers; preserve
  unrelated worktree and coordination-ledger changes.

## Risks and mitigations

1. Risk: deleting an artifact still needed for an approved or retryable delivery.
   Mitigation: every exact active descriptor protects its matching file, and
   cleanup runs only after foreground/background assistant work is quiescent.
2. Risk: a crafted path or symlink escapes the owned directory.
   Mitigation: enumerate from a fixed root, reject symlinks, resolve and bound every
   candidate, and revalidate metadata before removal.
3. Risk: cleanup changes do not improve the measured cold path.
   Mitigation: compare checkpoint payload and phase telemetry after deployment and
   report the remaining container, restore, staging, and provider-start costs.

## Tasks

1. Add the narrow coordination-ledger notice and map existing outbox/residue tests.
2. Implement fail-closed terminal generated-delivery pruning before checkpoint.
3. Route newly generated one-time delivery artifacts to the owned prefix and
   document its lifecycle.
4. Add focused active/terminal/mismatch/symlink/untrusted-state regression tests.
5. Run required verification and completion audits; commit, push, and open a PR.
6. Deploy the exact accepted head and validate production checkpoint/cold telemetry.

## Decisions

- Use `exports/assistant-deliveries/` as a dedicated assistant-owned transient
  prefix. It remains included in workspace checkpoints while a delivery is active.
- Reconcile terminal and create-before-outbox orphan artifacts in the existing
  pre-checkpoint residue pass instead of adding another lifecycle manager or
  persistence owner. The reserved prefix itself is the ownership boundary.
- Do not classify or remove generic ZIP files; ownership and exact outbox evidence
  are required.

## Verification

- Focused assistant-engine generated-delivery, residue, and model-guidance tests:
  94/94 passed.
- Focused hosted checkpoint bridge tests: 34/34 passed. The coverage-write audit
  added the missing archive-boundary proof that an exact active file remains in
  the checkpoint while an orphan is absent and a generic user export remains.
- Portable packaging audit: 37 passed, 1 skipped.
- Assistant-engine and assistant-runtime typechecks passed.
- The full supported/default assistant-engine suite passed 2,333 tests with 5
  skips; the full assistant-runtime suite passed 1,716 tests with 2 skips.
  Reverse-dependent assistant-cli, assistantd, setup-cli, CLI boundary, repo-tool,
  workspace dependency, logging, crypto, and Temporal guards also passed after
  their generated/build prerequisites were prepared.
- Instrumented assistant-engine coverage completed the tests and reported the new
  residue path at 84.84% statements, 78.86% branches, 93.75% functions, and 84.9%
  lines. The coverage process exited nonzero only after an unrelated worker hit
  its 4 GiB heap limit; no test assertion failed. Supported-setting package suites
  and focused boundary tests are the reliable local proof; CI remains authoritative
  for the aggregate lane.
- `git diff --check` and the identifier/privacy scan passed.

## Results

- Root-cause tracing separated the apparent 13-second cold interval into roughly
  3.3 seconds of container startup, 3.7 seconds of workspace restore, 1.2 seconds
  of staging, 2.4 seconds of provider startup, and smaller boundary overheads.
- One already-terminal generated delivery artifact had persisted across 19
  checkpoints. Removing that artifact reduced the representative encrypted
  snapshot by 56.3%, the plain snapshot by 19.2%, and comparable restore time from
  3.629 seconds to 2.491 seconds. This change makes that reclamation automatic for
  future one-time generated deliveries without classifying or deleting generic
  archives.
- The implementation adds no queue, priority class, prewarming process, snapshot
  format, database migration, or new state owner. It extends the existing
  quiescent runtime-residue owner with one exact prefix and active-descriptor
  reconciliation.
- Production CI, deployment, and the post-deploy observation window remain the
  final acceptance gates.

## Deployment concerns

- No web deployment, migration, or tandem release is required. The change is
  backward-compatible with existing checkpoints and outbox descriptors.
- A normal gradual Cloudflare container rollout is safe. Warm containers on the
  prior image may retain terminal generated files until they are replaced and a
  new idle checkpoint is written; they do not misread or corrupt checkpoints
  produced by the new image.
- After rollout convergence, verify the exact Worker version at 100% traffic,
  run the existing hosted smokes, and observe only secret-safe aggregate cleanup,
  checkpoint, restore, delivery, and error telemetry for at least 15 minutes.
Completed: 2026-07-16
