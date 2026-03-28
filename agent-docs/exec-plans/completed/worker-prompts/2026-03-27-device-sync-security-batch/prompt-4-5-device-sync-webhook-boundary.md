Murph webhook lane: fix webhook replay/idempotency so retries are not burned before durable side effects, and minimize hosted signal payloads to sparse wake hints only.

Ownership:
- Own `packages/device-syncd/src/{public-ingress.ts,types.ts,providers/{oura.ts,whoop.ts}}`.
- Own hosted control-plane pieces in `apps/web/{README.md,app/api/device-sync/agent/signals/route.ts,src/lib/device-sync/{control-plane.ts,prisma-store.ts}}` only as needed for this webhook/signal boundary fix.
- Own direct coverage in `packages/device-syncd/test/public-ingress.test.ts` and `apps/web/test/device-sync-hosted-wake-dispatch.test.ts`.
- Add or adjust a focused hosted agent-signals route/store test if needed to prove the returned payload shape; keep it narrow.
- This lane overlaps active hosted device-sync control-plane work and there is already untracked route work under `apps/web/app/api/device-sync/agent/session/`. Read the live file state first, preserve unrelated edits, and do not revert anything you did not author.
- Do not edit outside that scope unless a direct, minimal dependency is unavoidable. If scope changes, update your ledger row first.
- Work in the shared current worktree.
- Do not create commits.

Required repo workflow for this lane:
- Read `AGENTS.md`, `agent-docs/operations/completion-workflow.md`, and `agent-docs/exec-plans/active/COORDINATION_LEDGER.md` before editing.
- Implement the fix, add or adjust direct coverage, run the narrowest truthful verification for your owned surface, and report any remaining gaps.
- The parent lane will run the final repo-level audit passes and commit after collecting worker results.

Issues:
- `packages/device-syncd/src/public-ingress.ts` `handleWebhook()` currently records the webhook trace before it:
  - resolves the webhook to a known account
  - confirms the account is active
  - durably records side effects/jobs
- That permanently burns the trace even when:
  - the account does not exist yet
  - the account exists but is inactive/disconnected/reauthorization_required
  - `onWebhookAccepted()` throws before jobs/side effects land
- Separately, hosted control-plane `onWebhookAccepted` currently stores and re-exposes too much data in device-sync signals:
  - `jobs: webhook.jobs`
  - `payload: webhook.payload ?? {}`
- Provider parsers currently pass through raw webhook payloads:
  - Oura returns `payload: { ...payload, eventType, dataType, objectId }`
  - WHOOP returns `payload`
- That expands the hosted trust boundary beyond sparse wake hints and leaks provider-origin metadata plus local scheduling intent into Postgres/API state.

Best concrete fix:
- Treat duplicate suppression as applying only after the webhook is associated with an active account and its durable side effects succeed.
- A simple acceptable design is:
  - look up account and active status first
  - run durable `onWebhookAccepted()` side effects
  - only then record the trace as consumed for duplicate suppression
- If you need to keep audit visibility for unmatched/inactive webhooks, keep that separate from the duplicate-suppression key/state.
- Make sure transient `onWebhookAccepted()` failures do not permanently consume the trace.
- Minimize hosted signals to sparse hints only. The hosted signal should contain only the minimum needed wake metadata, such as:
  - `provider`
  - `connectionId`
  - `kind`
  - `eventType`
  - `traceId`
  - `occurredAt`
  - maybe a coarse resource category if truly needed
- Do not persist or return:
  - raw `webhook.payload`
  - `webhook.jobs`
  - other provider-specific payload blobs
- Update docs so the hosted boundary stays truthful.

Tests to anchor:
- `packages/device-syncd/test/public-ingress.test.ts`
- `apps/web/test/device-sync-hosted-wake-dispatch.test.ts`
- add a narrow hosted route/store proof if needed for `/api/device-sync/agent/signals`

Specific regression proof requested:
- unknown-account webhook first, then account creation, then same trace retry => should process exactly once
- inactive-account webhook first, then account reactivation, then same trace retry => should process exactly once
- `onWebhookAccepted()` throws after verification => same trace retry should still be processable
- update hosted wake-dispatch tests so `webhook_hint` signals exclude raw payloads and job arrays
- add a regression test with a fake webhook payload containing sensitive-looking fields and assert they are not stored in `deviceSyncSignal.payloadJson` and not returned by `/api/device-sync/agent/signals`

Report back with:
- files changed
- behavior-level summary
- exact verification commands and results
- any direct scenario proof or remaining gap
