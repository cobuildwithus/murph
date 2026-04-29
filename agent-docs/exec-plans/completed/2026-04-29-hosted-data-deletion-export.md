# Hosted Data Deletion Export

Status: completed
Created: 2026-04-29
Updated: 2026-04-30

## Goal

- Land the supplied hosted account data export/deletion MVP patch, then land the supplied final-fixes patch after Pro export could not return a usable artifact and the user explicitly directed landing.

## Success criteria

- `/settings` exposes a data/privacy export and destructive delete flow with exact-phrase plus second-confirmation gating.
- Hosted web has authenticated export/delete API routes backed by an account data service that covers the high-value hosted stores described in the patch.
- Hosted web can request best-effort hosted runner cleanup through the shared control client.
- Cloudflare hosted control exposes a narrow signed internal per-user delete route that clears per-user Durable Object state/alarms and user-scoped opaque R2 objects.
- Tests cover phrase parsing, acknowledgement rejection, store matrix coverage, and safety modes.
- Repo-required security/privacy, frontend, coverage, and final-review passes run or blockers are documented.
- Final security/privacy, frontend, coverage, and task-finish review findings are resolved or documented.

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
5. Done: Sent landed diff to Pro; wake polling repeatedly failed to export the thread while the thread showed a partial in-progress response and no returned patch attachment.
6. Done: Applied the supplied final-fixes patch after explicit user direction to land.
7. Done: Fixed the follow-up security/privacy finding by preserving the hosted root-key envelope when user-scoped R2 prefix cleanup is unsupported or unavailable.
8. Done: Added focused route, export/delete service, delete UI, and hosted runner cleanup coverage.
9. Next: Close the plan and create a scoped commit for the hosted export/delete files only.

## Decisions

- Use a plan-bearing high-risk workflow because the patch spans hosted web, Cloudflare, privacy, deletion, docs, and tests.
- Skip the optional simplify audit because this is an external bounded patch landing, even though the diff is large.
- Preserve the root-key envelope unless user crypto exists and user-scoped R2 cleanup support has been confirmed.

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
- Final-fixes passing commands:
  - `pnpm exec vitest run apps/web/test/hosted-account-data-service.test.ts apps/web/test/settings-data-export-route.test.ts apps/web/test/settings-privacy-delete-route.test.ts apps/web/test/hosted-data-privacy-settings.test.ts --config apps/web/vitest.config.ts --no-coverage`
  - `pnpm --dir apps/cloudflare exec vitest run --config vitest.node.workspace.ts test/user-runner-alarm.test.ts -t "hosted user deletion|root-key envelope|best-effort R2 deletion|prefix listing|fully supported" --no-coverage`
  - `pnpm --dir apps/web typecheck`
  - `pnpm --dir apps/cloudflare typecheck`
  - `pnpm --dir apps/web exec eslint app/api/settings/data-export/route.ts app/api/settings/privacy/delete/route.ts src/lib/hosted-privacy/account-data-service.ts src/components/settings/hosted-data-privacy-settings.tsx test/hosted-account-data-service.test.ts test/settings-data-export-route.test.ts test/settings-privacy-delete-route.test.ts test/hosted-data-privacy-settings.test.ts`
  - `pnpm --dir apps/cloudflare verify`
  - `git diff --check -- <owned paths>`
- Final-fixes blocked command:
  - `bash scripts/workspace-verify.sh test:diff <owned paths>` passed repo guards and `apps/cloudflare verify`, then failed during `apps/web verify` in unrelated dirty Health Commons experiment-detail/projection tests.
- Pro:
  - `pnpm review:gpt --send --chat-url <thread> --preset security --preset privacy --preset simplify --prompt <scoped hosted deletion/export review request>` succeeded with attachments confirmed.
  - `pnpm exec cobuild-review-gpt thread wake ...` failed twice after three consecutive thread-export timeouts.
  - `pnpm review:gpt thread diagnose --chat-url <thread>` succeeded and showed the latest Pro response is partial/in-progress with no new patch attachment.
Completed: 2026-04-30
