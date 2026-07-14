Goal (incl. success criteria):
- Resolve the accepted ReviewGPT findings from merged PR #601 without undoing its generic group-data architecture.
- Success means isolated newsletter composition receives health facts only when exact live email and health-share grants authorize them, old runner requests fail closed without a parse break during an immediate rollout, the generic weekly result makes no unsupported prior-week claim from a seven-day consent window, and workout minutes cannot collide with broad activity minutes.
- Open a follow-up PR from the latest `main`, complete required local verification/audits, and run the PR ReviewGPT loop to zero accepted findings with green CI.

Constraints/Assumptions:
- Keep `vault-cli group weekly` as the single reusable group weekly-data primitive.
- Do not add persisted state, a new route, a second projection parser, a new scheduler/retry path, or a second weekly aggregation implementation.
- Preserve the seven-day consent disclosure instead of widening health-data retention without renewed/versioned consent.
- Preserve scheduled-send authority, recipient re-resolution, idempotency, and missing-email nudges.
- Compatibility is wire-level and fail-closed: new web accepts old `read_stats` and snapshot-less `prepare` requests only to return `newsletter_runner_upgrade_required`; operators must leave no newsletter occurrence between the web-first deploy and immediate runner rollout.
- Preserve unrelated working-tree and ledger edits.

Key decisions:
- Move the projection-record-to-current-week summary adapter into the query owner and reuse it from both the generic CLI and newsletter composition.
- Enrich `prepare` inside trusted assistant code by filtering the generic weekly source against the web-owned live email/data-grant snapshot before facts enter model context; keep the web response itself free of health data and addresses.
- Retain only current-week averages in the seven-day group weekly output. Delete previous-week/delta promises rather than adding a wider consent version and retention migration to this corrective PR.
- Map `workout-days.v0` minutes to `workout-minutes`, leaving `activity-minutes` for the broad daily activity projection.
- Keep a narrow legacy request branch at the shared parser/web route boundary so old calls fail closed explicitly; do not expose `read_stats` in the current model tool schema or return participant data to it.

State:
- Local completion complete: implementation, verification, specialist audits, and parent final review are clean; commit and PR gates remain.

Done:
- Confirmed PR #601 merged while its first ReviewGPT round was still running.
- Read and triaged all four ReviewGPT findings against the merged production paths and repository invariants.
- Created an isolated follow-up worktree and branch from the latest `origin/main`.
- Moved the projection-to-current-week adapter into `packages/query` without adding a dependency from the query owner to hosted execution.
- Reused that builder from both `vault-cli group weekly` and trusted newsletter preparation.
- Filtered projection records by web-authorized verified-email member ids plus exact live projection-scope/share ids before health facts enter model context.
- Removed unsupported prior-week/delta output and separated broad `activity-minutes` from `workout-minutes`.
- Added fail-closed legacy request handling without exposing `read_stats` in the current model schema or returning participant data to old runners.
- Removed shell access from authorized newsletter cron turns while preloading the newsletter skill into trusted system context; ordinary group turns retain the generic CLI reader.
- Bound send to the same occurrence's exact prepared authorization snapshot and fail closed with a retryable occurrence when email eligibility or health grants change before delivery.
- Isolated scheduled newsletter turns from native resume and committed transcript replay, and bound both composition and send to exact current projection-scope/share-id grants so asynchronous revoke cleanup cannot expose stale facts.
- Passed focused tests and typechecks for query, CLI, assistant engine/runtime, hosted execution, and web; passed the prepared runtime build, scenario integrity, and direct hosted-local reruns. The broad diff verifier's hosted-local stage encountered an absent prebuilt runtime and two load-sensitive 60-second timeouts; after building the prerequisite, the full harness passed 390/392 and both timed-out files passed 39/39 with a 180-second timeout.
- Completed the coverage-write audit with zero material gaps and the security/privacy re-audit with zero unresolved medium-or-high findings.
- Completed the parent scope-and-shape and final diff review; removed a redundant eligibility helper and kept the query owner structurally independent from hosted execution.

Now:
- Close the execution plan and create the exact scoped commit.

Next:
- Push, open the follow-up PR, and complete ReviewGPT plus CI on the exact pushed head.

Open questions (UNCONFIRMED if needed):
- None.

Working set (files/ids/commands):
- packages/query/src/group-weekly.ts
- packages/query/src/index.ts
- packages/query/test/group-weekly.test.ts
- packages/cli/src/commands/group.ts
- packages/cli/test/group-command.test.ts
- packages/assistant-engine/src/assistant-codex/dynamic-tools.ts
- packages/assistant-engine/test/assistant-codex-group-tool.test.ts
- packages/assistant-engine/skills/group-newsletter/SKILL.md
- packages/hosted-execution/src/runtime-control.ts
- packages/hosted-execution/src/parsers/runtime-control.ts
- packages/hosted-execution/test/parsers.test.ts
- apps/web/app/api/internal/hosted-execution/groups/newsletter-tool/route.ts
- apps/web/test/hosted-group-newsletter-route.test.ts
- agent-docs/product-specs/group-health-newsletter.md
- agent-docs/exec-plans/active/COORDINATION_LEDGER.md
Status: completed
Updated: 2026-07-13
Completed: 2026-07-13
