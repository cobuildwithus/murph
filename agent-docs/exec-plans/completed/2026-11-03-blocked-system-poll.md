# Quiesce usage-blocked system mailbox polling

Status: completed
Created: 2026-11-03
Updated: 2026-11-03

## Outcome and ownership

Usage-blocked members wait for real model-free work, usage restoration, or the
allowance boundary. Device imports remain prompt and retained assistant work
resumes when allowed. Web owns runnable reconciliation facts; runtime owns
imported retries and checkpoint wake projections; Temporal owns timers/signals.

## Original cause and correction (superseded below)

The handled prefix can remain behind a default-owned item after later device
rows complete independently. Web currently classifies those historical rows as
model-free readiness. A stable Temporal progress fingerprint only increases its
retry delay. Restrict the independent row lookup to the existing imported
watermark and admit retained work through its canonical model-free wake.
Keep handled progress and assistant deadlines unchanged. Add no durable state,
wire field, queue, or workflow behavior patch.

## Scope and constraints

- Inspect both isolated worktrees; commit locally only. No push, PR or deployment.
- Read-only production evidence stays outside repository artifacts.
- Focused Web and workflow tests plus touched-package typechecks; no heavy suite
  or simulator. Full CI and protected deployment replay remain release gates.
- Preserve legacy imported-watermark fallback and current independent kinds.

## Proof and journeys

1. Reproduce false readiness using a synthetic retained default head and a later
   completed/imported device row. Prove failure before the correction.
2. Repeated reconciliations stay quiet, new model-free rows still admit, future
   model-free retries wait until due, and usage restoration admits default work.
3. Exercise the private workflow with matching synthetic facts and carried
   progress backoff, including usage-restoring signals and period-boundary wake.
4. Trace Ops reset, credit fulfillment, allowance rollover and plan change.
5. Review privacy, deploy skew, code complexity and exact local diffs; commit.

## Original deployment assessment (superseded below)

Candidate is a Web facts correction with no workflow command change or runner
wire change. Existing workflows observe corrected facts on their next read.
The current runtime must already publish independent imported progress and
model-free retry deadlines. Reverting Web restores the old polling behavior
without losing work. Verify legacy and current reader behavior in focused tests.

## Verification and review

- Before the source change, the focused Web facts suite had 4 failures and 52
  passes. The two completed-device cases returned `model_free` instead of
  `default_owned`; the two future-retry cases lost their earlier retry deadline.
- After the change, the three facts/classifier suites pass all 63 tests.
- The focused Web facts, mailbox-store, Ops reset, allowance, Stripe billing,
  Stripe receipt and credit reconciliation suites pass all 547 tests (9 files).
- The private workflow suite passes 448 tests, including 8 new cases. A constant
  historical frontier reproduces dispatches at 0, 30, 150 and 750 seconds. The
  corrected facts wait, admit new/due model-free work, and resume default work
  on each supported restoration signal or the period-boundary timer.
- `pnpm --dir apps/web typecheck` found a nullable test fixture mutation;
  corrected it and `pnpm --dir apps/web typecheck:prepared` passes.
- Private `pnpm typecheck` passes. `pnpm complexity:diff` passes with unchanged
  maximum complexity and debt. `pnpm docs:drift` and the task-added content
  privacy scan pass. `git diff --check` passes in both worktrees.
- Parent review: Web is still the facts owner; no payload scan, extra transaction,
  schema, lifecycle or scheduling owner. Imported progress never acknowledges
  handled work. Existing classifiers and generic retry deadlines preserve
  independent kinds. Public producer and private consumer tests use synthetic
  fixtures; neither repository imports the other's implementation.
- Product UX: Ready for the scoped change. Paused work stays retained; device
  arrivals and due retries remain admitted; usage restoration retains default
  processing. Existing progress backoff still bounds unsuccessful system retries.
- Changelog: not applicable. This removes internal empty runner invocations;
  member allowance, messages, import behavior and restoration policy are preserved.
- Full/heavy CI, native replay and external ReviewGPT were not run: this task
  explicitly requires focused local verification and forbids push/PR creation.
  No production mutation or deployment was performed.

## Evidence limits

Runtime logs do not record the assistant-blocked flag or Temporal dispatch cause.
Production counts therefore distinguish the observable unchanged-head proxy from
verified usage-block state; exact timer attribution needs workflow history.
No local Temporal credentials were available in either task environment. Private
incident rows, identifiers and aggregate query outputs are not stored here.
Completed: 2026-11-03


## Round 2: accepted retry-preservation finding

The parent authorized this correction to the completed plan after accepting the
review finding. The original Web-only proposal is insufficient: the generic
wake selector can choose an earlier default-owned item and hide a pending device
retry behind it. An imported row is not evidence of completion. The new regression
retains a member action before a device row, blocks assistant execution, and
fails the device snapshot fetch once; the independent retry must survive alongside
the default wake.

Choose design A. Reuse the runtime's model-free item filter and wake selector in
its existing mailbox progress reader. Publish the earliest deadline on import,
canonical-status and idle checkpoints in both processing modes. Independent
device completion already reaches these owners. Future selections with a null
execution class remain included because filtering happens before selection.

The additive status contains the deadline plus its checkpoint version. The
version is derived from the existing CAS successor, not a new state owner. It
prevents older runners from reusing unknown fields copied from a newer runner's
checkpoint. For a usage-blocked invocation, the existing restored-progress gate
publishes the projection once when counters already match; otherwise an idle
upgraded runner would never advertise the new capability. A focused regression reproduced zero checkpoints
before that condition and requires one publication followed by no further writes.
Only otherwise idle blocked invocations force this capability-only checkpoint;
due work uses its normal completion checkpoint. Default-mode checkpoints still
publish the same derived fields through their normal owners. Web accepts the
projection only at that version; otherwise it uses the base handled-prefix lookup. Remove the generic wake-reason heuristic. Preserve
all existing usage restoration signals and the allowance-period timer.

Deployment: Web first, runner second; no worker release or workflow patch.
Pre-change Web accepts and ignores the new scalar fields. New Web keeps legacy
polling for absent/stale fields. Runner rollback changes the checkpoint version
and therefore restores that fallback. Web rollback must use pre-change main,
not the superseded Web-only candidate. There is no migration or cleanup.

Round 2 verification completed:

- Re-ran the final selected regression cases against the handed-off source head:
  10 runtime cases and 6 Web cases fail before the correction. The 2 existing
  completed-row cases still pass there. The corrected implementation passes all
  these cases, including the independent completion callback, default-mode
  handoff, future generic mailbox retry with null execution class, local
  continuation, capability publication, and absent/stale reader fallback.
- Runtime: 156 tests across five focused files pass. The entrypoint suite passes
  all 86 tests, import checkpoints pass 13, and the mailbox-state, model-free
  notification and delegated-direction suites pass 57 combined. Runs used
  `pnpm --dir packages/assistant-runtime exec vitest run --config vitest.config.ts
  --isolate=true --no-coverage` with only those files. The required compiled
  capture worker was prepared with the package build.
- Web: 110 tests across reconciliation facts, reconciliation timing, runtime
  usage decisions and workspace store pass using `pnpm exec vitest run --config
  apps/web/vitest.workspace.ts --no-coverage` with only those files.
- `pnpm --dir packages/assistant-runtime typecheck` and
  `pnpm --dir apps/web typecheck:prepared` pass. `pnpm complexity:diff` passes
  with unchanged maximum complexity and debt in every touched source file.
  `pnpm docs:drift`, `git diff --check`, and the added-content privacy scan pass.
- Parent review: the existing progress reader and publication owners cover all
  checkpoint paths. No new remote calls, transactions, tables, queues, workflow
  commands, model prompts or provider requests. Continuation admission can reuse
  one bounded local mailbox-state read; Web retains at most two ordered mailbox
  lookups. Generic and default wake semantics stay intact.
- Product UX: Ready for the scoped correction. Completed independent work stays
  quiet, new arrivals remain eligible, imported retries become ready at their
  deadline, and existing usage-restoring signals/default wakes remain preserved.
  The existing workflow progress backoff still applies to unsuccessful attempts.
- The private workflow test commit is unchanged. Its frontier and blocked-timer
  assertions remain valid; the new runtime projection is consumed only by Web.
- Changelog remains not applicable: this corrects an unshipped regression in the
  internal polling reduction and preserves existing device-sync behavior.
- No simulators, full suites, production mutations, push or PR actions. CI and
  another external review must run on the new pushed head through the parent;
  previous-head CI/review are not evidence for this commit.
