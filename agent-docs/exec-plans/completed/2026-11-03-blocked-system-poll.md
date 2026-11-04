# Quiesce usage-blocked system mailbox polling

Status: completed
Created: 2026-11-03
Updated: 2026-11-03

## Outcome and ownership

Usage-blocked members wait for real model-free work, usage restoration, or the
allowance boundary. Device imports remain prompt and retained assistant work
resumes when allowed. Web owns runnable reconciliation facts; runtime owns
imported retries and checkpoint wake projections; Temporal owns timers/signals.

## Cause and smallest correction

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

## Deployment and recovery

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
