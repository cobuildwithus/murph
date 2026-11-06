# Weekly usage review checkpoint and build remediation

Status: completed
Created: 2026-10-02
Updated: 2026-10-02

## Goal

Persist successful silent weekly usage reports after their hosted checkpoint,
while preserving ordinary feedback delivery and failed-turn boundaries. Repair
clean-build source resolution and the runner's bounded Zod dependency surface.

## Scope and decisions

- Exact authorized weekly notification completion passes host-created scope to
  the existing candidate sink. The hosted phase retains approved audit keys and
  schedules its existing checkpoint hook even without delivery or cleanup work.
- No new queue, store, feedback callback, scheduler or Codex CLI change. Ordinary
  feedback still requires a matching sent current-turn delivery.
- Use the existing bounded Zod wrapper and explicit shared/Web source aliases;
  keep bundle guards and budgets unchanged.
- Final external review accepted a checkpoint handoff finding. The completed
  original plan stays unchanged; parent owns commits, fresh review and merge.

## Verification

- Compose notification commit authority and hosted phase/checkpoint tests with
  synthetic feedback; cover no premature callback, successful quiet completion,
  cancellation/failure, callback rejection, and ordinary failed delivery.
- Run engine/runtime owner tests and types, planner characterization, workspace
  boundary/source resolution checks, Web prepared typecheck, full runner bundle,
  complexity, docs drift and privacy/diff checks.

## Risks

The report remains best effort after checkpoint; transport failure does not undo
an already committed occurrence. No persistence is attempted before checkpoint.

## Results

- Exact private weekly authorization is created after engine notification commit
  and passed through the existing sink. Candidate overwrites clear previous
  authorization before revalidation. Only approved audit keys bypass delivery.
- Runtime delivery/scheduling owner tests: 145 passed, including 12 new silent
  checkpoint regressions. These compose the real hosted phase with the automation
  lane mocked at its trusted sink boundary; the separate real cron/notification
  integration proves authority and successful commit provenance. No single live
  hosted-provider/checkpoint journey is claimed.
- Engine notification/audience/cron tests: 123 passed. Planner plus real cron:
  124 passed; weekly optimizer plus cron: 19 passed (overlapping suite counts).
- Engine, Runtime, hosted-execution and Web prepared typechecks passed. Initial
  runtime typecheck caught two mechanical variable-scope edits; corrected before
  the final successful runs.
- Source-only resolution: ten tests passed, including a fixture without package
  dist. Explicit Web and shared aliases prevent generated local declarations from
  masking missing source resolution. Web config/diagnostics: 62 passed; shared
  diagnostics contracts: three passed. Workspace boundary guard passed.
- Full `pnpm --dir apps/cloudflare runner:bundle` passed without budget or guard
  changes: static closure 2,117,635 bytes against 2,143,343, with 23 of 24 chunks.
  This was run after the initial checkpoint implementation and bounded Zod fix;
  the final recorder consolidation changed no imported module or dependency.
- Final complexity passed: workspace-phase debt 281 to 279, maximum unchanged
  at 116. Feedback metric normalization moved into its existing recorder to avoid
  duplicate optional checks at callers. Docs drift and diff/privacy scans passed.
- Read-only merge-tree against origin/main 82fa1d78bfc8 reports one conflict in
  dynamic-tools.ts family-plan dispatch. Parent owns committing this remediation
  and then reconciling main before the next external review; no merge performed.
Completed: 2026-10-02
