# Scope Junction disconnects to the selected source

Status: active
Created: 2026-08-03
Updated: 2026-08-03

## Goal

- Disconnecting one wearable on the Connect page removes only that selected source from a shared Junction account. Explicit historical-reset actions remain connection-wide and continue to warn about their broader scope.

## Success criteria

- A member with Oura, WHOOP, and Apple Health on one Junction connection can disconnect Oura while WHOOP, Apple Health, and the parent connection remain active.
- The provider call deregisters only the selected Junction provider slug; source identity and member ownership are checked at the Web control-plane boundary.
- A late callback or hosted-runtime projection from the disconnected source cannot reconnect it. Starting a fresh connect for that source explicitly clears the source fence.
- Source-attributed native companion payloads and queued runtime jobs honor the same fence; explicit Apple Health SDK reconnect opens a pending epoch that only newer provider evidence can commit.
- An obsolete Link that completes after Disconnect has its exact provider registration removed without crossing a newer source epoch.
- The normal confirmation dialog names the selected source; the historical-reset dialog still describes a whole-account disconnect.
- Focused service, route, projection, and UI tests pass; Web typecheck passes; desktop and mobile design proof is captured.
- The exact pushed PR head passes the applicable preliminary specialist review, final ReviewGPT loop, and required GitHub Actions checks.

## Scope

- In scope:
  - Add a source-scoped authenticated disconnect endpoint and control-plane operation for Junction-backed sources.
  - Reuse Junction's existing `revokeSourceAccess` authority and the existing connection-source row as the single durable lifecycle owner.
  - Fence stale source callbacks/runtime writes during and after explicit disconnect, and clear that fence only when a fresh connect begins.
  - Route native companion admission, explicit Apple Health reconnect, and rejected stale-Link cleanup through that same source owner.
  - Project source-specific disconnect targets into the Connect page and update its optimistic state, confirmation copy, tests, and design study.
  - Preserve the existing connection-wide endpoint for direct providers and explicit historical resets.
- Out of scope:
  - Migrating provider accounts, changing historical data, or mutating production data.
  - Redesigning the Connect page or introducing a second disconnect state store.
  - Changing provider ingestion semantics unrelated to source lifecycle admission.

## Constraints

- Technical constraints:
  - Parent connection, stored provider account, source row, and member ownership must be revalidated under the existing connection mutation lock.
  - Source identity must be normalized and matched to an existing row before any provider mutation.
  - Provider revoke happens outside the database transaction; a source-row lifecycle fence must make the two-phase operation race-safe.
  - Sibling source rows, parent credentials, parent status, and prior health history must remain unchanged.
- Product/process constraints:
  - Keep the current dialog and card components; add only the source-specific semantic behavior and copy.
  - Use the task worktree/PR lane, preserve unrelated changes, and commit only scoped files.
  - Complete focused verification, design proof, preliminary specialist review, final ReviewGPT, and exact-head CI before handoff.

## Risks and mitigations

1. Risk: A callback or runtime apply captured before disconnect could restore the selected source.
   Mitigation: Persist a source-row disconnect fence, reject stale callback/runtime source writes while it is present, and clear it in the existing explicit connect preparation path.
2. Risk: A failed provider revoke could leave local state disconnected while the provider remains registered.
   Mitigation: Restore the captured source lifecycle fields under the same epoch checks and return a retryable, sanitized error.
3. Risk: Source-specific UI state could still hide every card sharing the parent connection.
   Mitigation: Track optimistic source and connection disconnects separately and cover the three-source case with a focused helper/component test.
4. Risk: The historical reset flow could accidentally become source-scoped even though Junction requires a full reset.
   Mitigation: Keep recovery-kind projections on the existing connection-wide endpoint and retain the explicit account-scope dialog copy and tests.
5. Risk: Native companion or already-staged work could bypass a browser-only source fence.
   Mitigation: Recheck exact-source admission under the Web health-data lock and before device-syncd import; only an explicit Apple Health connect plus newer provider evidence can reopen that source.
6. Risk: A Link issued before Disconnect could recreate remote authorization after local admission rejects it.
   Mitigation: Let the rejected callback claim the exact source epoch, perform target-only cleanup, and block a newer Link while provider cleanup is in progress.

## Tasks

1. Prove the current production/data/code path and classify whether the failure is provider-specific or shared-account scoped.
2. Add the source lifecycle fence and a two-phase source-scoped Junction disconnect operation using existing store/provider owners.
3. Add the authenticated source route and project source slugs through the Connect page without changing historical-reset scope.
4. Update optimistic state, confirmation copy, design study, and focused tests.
5. Run focused tests, Web typecheck, UI double-check, design screenshots, and inspect the candidate diff for privacy and scope.
6. Commit and push the exact candidate, open the PR, run preliminary specialists and final ReviewGPT concurrently with CI, resolve findings, and repeat exact-head gates as required.
7. Resolve the preliminary/final review findings covering native companion authority and stale-Link provider reauthorization, then run a correction ReviewGPT round on the exact pushed head.

## Decisions

- This is a Junction shared-account bug affecting any sibling sources, not an Oura-only bug.
- Keep connection-wide disconnect as the explicit parent authority; add a child-source route instead of overloading the existing route with an optional body field.
- Use the existing connection-source row's internal error-code field as the disconnect fence; do not add a table, queue, or schema migration.
- Provider revoke failure leaves the selected source connected and retryable. Successful revoke changes only the target row and records a source-scoped audit signal.
- A completed source disconnect remains remotely self-healing: repeated Disconnect performs provider I/O, and a stale callback owns exact-target cleanup instead of account-wide revoke.
- The companion SDK's explicit `connect` intent is the closed Apple Health source-start operation; resume, omitted intent, BLE enrollment, and data ingress do not clear source lifecycle state.
- Review remediation crossed the anomaly-retrospective threshold: the first-reviewed patch had 509 added / 64 deleted source lines, while the corrected patch has 1,215 added / 141 deleted source lines; remediation itself accounts for 729 added / 100 deleted source lines before its final commit.
- Continue in this PR because both added paths close demonstrated privacy/revocation failures in the same operation and owner boundary. The growth is source-claim, stale-callback cleanup, native admission, and their direct hooks—not a second owner. Retain the existing connection-source row and target-only provider revoke as the whole architecture; reject a queue, reconciler, schema change, secondary lifecycle service, or compatibility state.

## Verification

- Commands to run:
  - Focused Vitest files for hosted wake/control-plane behavior, settings routes, Connect page projections/helpers, and runtime authority fencing.
  - Device-syncd public-ingress and Junction-provider tests for rejected-callback cleanup handoff, native provider-event admission, and companion runtime import fencing.
  - `pnpm --filter @murphai/hosted-web typecheck:prepared`
  - `pnpm --filter @murphai/device-syncd typecheck`
  - Applicable frontend design proof and UI double-check commands from the completion workflow.
  - Exact-head GitHub Actions checks, preliminary `completion-specialists` ReviewGPT, and the final ReviewGPT loop.
- Expected outcomes:
  - Only the selected provider slug is deregistered and marked disconnected; siblings and parent connection remain active.
  - Stale same-source callbacks/runtime applies are rejected while a fresh explicit connect can admit the source again.
  - Source-specific and connection-wide confirmation states are visually correct on desktop and mobile.
  - All required exact-head review and CI gates pass with no unresolved findings.
