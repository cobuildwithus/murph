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
- The normal confirmation dialog names the selected source; the historical-reset dialog still describes a whole-account disconnect.
- Focused service, route, projection, and UI tests pass; Web typecheck passes; desktop and mobile design proof is captured.
- The exact pushed PR head passes the applicable preliminary specialist review, final ReviewGPT loop, and required GitHub Actions checks.

## Scope

- In scope:
  - Add a source-scoped authenticated disconnect endpoint and control-plane operation for Junction-backed sources.
  - Reuse Junction's existing `revokeSourceAccess` authority and the existing connection-source row as the single durable lifecycle owner.
  - Fence stale source callbacks/runtime writes during and after explicit disconnect, and clear that fence only when a fresh connect begins.
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

## Tasks

1. Prove the current production/data/code path and classify whether the failure is provider-specific or shared-account scoped.
2. Add the source lifecycle fence and a two-phase source-scoped Junction disconnect operation using existing store/provider owners.
3. Add the authenticated source route and project source slugs through the Connect page without changing historical-reset scope.
4. Update optimistic state, confirmation copy, design study, and focused tests.
5. Run focused tests, Web typecheck, UI double-check, design screenshots, and inspect the candidate diff for privacy and scope.
6. Commit and push the exact candidate, open the PR, run preliminary specialists and final ReviewGPT concurrently with CI, resolve findings, and repeat exact-head gates as required.

## Decisions

- This is a Junction shared-account bug affecting any sibling sources, not an Oura-only bug.
- Keep connection-wide disconnect as the explicit parent authority; add a child-source route instead of overloading the existing route with an optional body field.
- Use the existing connection-source row's internal error-code field as the disconnect fence; do not add a table, queue, or schema migration.
- Provider revoke failure leaves the selected source connected and retryable. Successful revoke changes only the target row and records a source-scoped audit signal.

## Verification

- Commands to run:
  - Focused Vitest files for hosted wake/control-plane behavior, settings routes, Connect page projections/helpers, and runtime authority fencing.
  - `pnpm --filter @murphai/hosted-web typecheck:prepared`
  - `pnpm --filter @murphai/device-syncd typecheck`
  - Applicable frontend design proof and UI double-check commands from the completion workflow.
  - Exact-head GitHub Actions checks, preliminary `completion-specialists` ReviewGPT, and the final ReviewGPT loop.
- Expected outcomes:
  - Only the selected provider slug is deregistered and marked disconnected; siblings and parent connection remain active.
  - Stale same-source callbacks/runtime applies are rejected while a fresh explicit connect can admit the source again.
  - Source-specific and connection-wide confirmation states are visually correct on desktop and mobile.
  - All required exact-head review and CI gates pass with no unresolved findings.
