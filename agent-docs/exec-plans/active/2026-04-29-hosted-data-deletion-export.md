# Hosted Data Deletion Export

Status: active
Created: 2026-04-29
Updated: 2026-04-29

## Goal

- Land the supplied hosted account data export/deletion MVP patch on the current checkout and send the landed diff to Pro for a final security/cleanup/simplification review.

## Success criteria

- `/settings` exposes a data/privacy export and destructive delete flow with exact-phrase plus second-confirmation gating.
- Hosted web has authenticated export/delete API routes backed by an account data service that covers the high-value hosted stores described in the patch.
- Hosted web can request best-effort hosted runner cleanup through the shared control client.
- Cloudflare hosted control exposes a narrow signed internal per-user delete route that clears per-user Durable Object state/alarms and user-scoped opaque R2 objects.
- Tests cover phrase parsing, acknowledgement rejection, store matrix coverage, and safety modes.
- Repo-required security/privacy, frontend, coverage, and final-review passes run or blockers are documented.
- The landed diff is sent to Pro with an attachment-based review prompt and wake polling is armed.

## Scope

- In scope:
  - Patch-intended files under `apps/web`, `apps/cloudflare`, `packages/cloudflare-hosted-control`, `docs`, and `agent-docs/index.md`.
  - Narrow fixes needed to make the patch compile and fit current local APIs.
- Out of scope:
  - Broad hosted runtime hard-cut work already owned by other active rows.
  - Deleting or rewriting unrelated dirty work in overlapping Cloudflare/web docs files.

## Constraints

- Preserve unrelated dirty-tree edits and active ledger rows.
- Treat the supplied patch as behavioral intent, not overwrite authority.
- Do not expose secrets, raw personal data, or local user identifiers in files, commit messages, prompts, or handoff.
- Do not weaken auth, retention, or fail-closed hosted crypto behavior for tests.

## Risks and mitigations

1. Risk: The patch overlaps active Cloudflare and doc edits.
   Mitigation: Apply/port hunks manually, inspect overlaps before staging, and commit only exact owned paths if safe.
2. Risk: Account deletion/export can leak ciphertext, identifiers, or provider details.
   Mitigation: Run the required security/privacy review, inspect the exported shape directly, and keep external/provider retention explicit.
3. Risk: Full repo checks may be red due to the existing dirty checkout.
   Mitigation: Run required baseline where feasible; if blocked by unrelated active rows, run scoped high-signal checks and document exact blockers.

## Tasks

1. Done: Inspect patch hunks and current touched files.
2. Done: Port patch onto current checkout without overwriting unrelated work.
3. Done: Review/harden security, privacy, and UI fit.
4. Done: Run required local audit passes and focused verification.
5. Blocked/monitoring: Sent landed diff to Pro; wake polling repeatedly failed to export the thread while the thread shows a partial in-progress response and no returned patch attachment yet.
6. Next: Apply any Pro-returned patch if it arrives; otherwise decide whether to nudge/retry Pro. Close plan and commit only after Pro outcome or explicit user direction.

## Decisions

- Use a plan-bearing high-risk workflow because the patch spans hosted web, Cloudflare, privacy, deletion, docs, and tests.
- Skip the optional simplify audit because this is an external bounded patch landing, even though the diff is large.

## Verification

- Passing commands:
  - `pnpm exec vitest run apps/web/test/hosted-account-data-service.test.ts apps/web/test/hosted-execution-handoff.test.ts apps/web/test/hosted-execution-control.test.ts --config apps/web/vitest.config.ts --no-coverage`
  - `pnpm --dir apps/cloudflare exec vitest run --config vitest.node.workspace.ts test/index.test.ts test/user-runner-alarm.test.ts -t "user data|user-data|hosted user deletion|Durable Object cleanup" --no-coverage`
  - `pnpm --dir packages/cloudflare-hosted-control test`
  - `pnpm --dir apps/cloudflare typecheck`
  - `pnpm --dir apps/web typecheck`
  - `pnpm --dir packages/cloudflare-hosted-control typecheck`
  - `pnpm --dir apps/web exec eslint src/components/settings/hosted-data-privacy-settings.tsx src/lib/hosted-runner/control.ts src/lib/hosted-privacy/account-data-service.ts test/hosted-account-data-service.test.ts test/hosted-execution-handoff.test.ts`
  - `git diff --check`
- Blocked command:
  - `bash scripts/workspace-verify.sh test:diff <owned paths>` passed repo guards and `packages/cloudflare-hosted-control` typecheck/test, then failed during `apps/cloudflare verify` because unrelated active work in `packages/assistant-runtime/src/hosted-runtime/workspace-runner.ts` references undefined `checkpointHostedWorkspaceUsageExportCleanup`.
- Pro:
  - `pnpm review:gpt --send --chat-url <thread> --preset security --preset privacy --preset simplify --prompt <scoped hosted deletion/export review request>` succeeded with attachments confirmed.
  - `pnpm exec cobuild-review-gpt thread wake ...` failed twice after three consecutive thread-export timeouts.
  - `pnpm review:gpt thread diagnose --chat-url <thread>` succeeded and showed the latest Pro response is partial/in-progress with no new patch attachment.
