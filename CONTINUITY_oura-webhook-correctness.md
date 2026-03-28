Goal (incl. success criteria):
- Restore Oura webhook correctness so delete notifications become explicit deletion imports, numeric second-based timestamps verify correctly, webhook event time is preserved, webhook jobs stay resource-aware, and focused tests cover the fixed path.

Constraints/Assumptions:
- Work on top of a heavily dirty tree without reverting unrelated edits.
- Keep the change scoped to Oura provider/importer/config/tests.
- Use completion-workflow audit subagents before handoff.
- Assume Oura webhook payloads may arrive with either legacy/internal aliases or documented `event_time` / `event_type` / `data_type` / `object_id` field names.

Key decisions:
- Follow WHOOP's existing split between resource jobs and delete jobs instead of forcing more logic into generic reconcile jobs.
- Represent Oura webhook deletes as explicit `snapshot.deletions` markers so the importer can emit append-only tombstones.

State:
- Completed

Done:
- Read repo routing/process docs, coordination ledger, Oura provider/importer code, relevant tests, and WHOOP reference behavior.
- Created execution plan `agent-docs/exec-plans/active/2026-03-28-oura-webhook-correctness.md`.
- Implemented Oura provider webhook parsing/job execution fixes for numeric-second timestamps, `event_time`, resource/delete job splitting, explicit deletion snapshots, and resource-scoped collection fetches.
- Wired `OURA_WEBHOOK_TIMESTAMP_TOLERANCE_MS` from env/config.
- Added focused Oura provider/config/importer coverage, including a combined provider-plus-importer delete-webhook proof path.
- Ran focused package builds/tests and recorded unrelated repo-wrapper failures outside this lane.

Now:
- Ready for handoff/commit.

Next:
- Reopen only if review or follow-up uncovers an Oura-specific regression.

Open questions (UNCONFIRMED if needed):
- UNCONFIRMED: whether Oura exposes single-resource fetch endpoints for all webhooked data types; current plan assumes narrow collection fetches plus explicit delete markers instead of new endpoint dependencies.

Working set (files/ids/commands):
- `agent-docs/exec-plans/active/2026-03-28-oura-webhook-correctness.md`
- `agent-docs/exec-plans/active/COORDINATION_LEDGER.md`
- `CONTINUITY_oura-webhook-correctness.md`
- `packages/device-syncd/src/providers/oura.ts`
- `packages/device-syncd/src/config.ts`
- `packages/device-syncd/test/oura-provider.test.ts`
- `packages/importers/src/device-providers/oura.ts`
- `packages/importers/test/device-providers.test.ts`
- `bash scripts/open-exec-plan.sh oura-webhook-correctness "2026-03-28 Oura Webhook Correctness"`
