Goal (incl. success criteria):
- Preserve low-level hosted runner failure diagnostics when the child process exits before returning a structured result.
- Surface bounded, metadata-only workspace snapshot restore/process diagnostics from child output tails into parent container failure logs.
- Keep diagnostics safe: no raw stderr/stdout text, paths, archive contents, prompts, secrets, or user identifiers.

Constraints/Assumptions:
- Keep Cloudflare as a thin runner; do not introduce a new observability subsystem.
- Reuse existing structured log records and diagnostic parsers where possible.
- Preserve unrelated active-plan work and dirty files.

Key decisions:
- Parse only existing hosted structured log JSON emitted by the child process.
- Promote only allowlisted metadata fields such as restore step, process label, exit/signal, stderr byte/line counts, markers, and truncation.
- Continue dropping free-form child stdout/stderr tails from parent logs.

State:
- Implemented; scoped verification passed. Commit is blocked by overlapping unrelated dirty work in the checkout.

Done:
- Confirmed top-level child runtime errors already propagate workspace snapshot process diagnostics.
- Added child-output structured-log parsing for missing-result/crash failures.
- Added focused regression coverage for isolated child diagnostics and parent container metadata propagation.
- Verification passed: `pnpm --dir apps/cloudflare typecheck`, focused Cloudflare Vitest files, and scoped `test:diff` / `apps/cloudflare verify`.

Now:
- Handoff with the exact changed files and commit blocker.

Next:
- Commit after unrelated overlapping work is reconciled, or use a scoped commit path that excludes the unrelated dirty ledger row.

Open questions (UNCONFIRMED if needed):
- None.

Working set (files/ids/commands):
- `apps/cloudflare/src/runner-child-diagnostics.ts`
- `apps/cloudflare/src/node-runner-isolated.ts`
- `apps/cloudflare/src/runner-container.ts`
- focused Cloudflare tests
Status: completed
Updated: 2026-05-28
Completed: 2026-05-28
