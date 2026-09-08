# Device callback recovery

## Outcome and scope

Treat an unverified browser return as an incomplete callback, not evidence that
an existing device connection failed. Reuse the current proof, Connect notice,
alert sender, and runtime-log store. Add no persisted state, provider calls,
replay ledger, or new dependency.

## Product UX

- Entry: returning from device authorization, including an old browser tab.
- Promise: show current connection state with neutral guidance; do not invent
  success, failure, or a need to reconnect an established source.
- Journeys: successful fresh callback; successful connection followed by an
  expired return; missing/malformed/mismatched proof; signed-out return;
  real provider failure; unavailable diagnostics storage.
- Proof: production route and proof tests, alert classification tests, rendered
  Connect states, runtime-log parsing, relevant typechecks.
- Done: callback recovery has no destructive notice or support escalation;
  existing source status and all browser authorization checks stay authoritative.

## Implementation

- Return a finite diagnostic result from the existing proof validator.
- Record rejected callbacks through the existing dedicated runtime-log writer,
  with bounded categories and provider only; keep browser values out of logs.
- Exclude callback-proof rejection from connection-failure emails.
- Reuse a neutral Connect notice, and correct the alert's stored-error guidance.

## Validation and review

Implementation and parent review complete; no production mutation.

- Web callback, proof, alert, start, Connect page, and changelog suites pass:
  152 tests across seven focused files.
- Web typecheck and hosted-execution typecheck pass.
- Complexity and documentation-drift checks pass. The Connect grid's maximum
  complexity falls from 48 to 47; its unrelated existing callback hotspot and
  the shared runtime timing hotspot are unchanged.
- UX verdict: Ready. Rendered Connect states preserve both connected status and
  the configured Connect action for an unconnected source. Recovery uses a
  polite status region, no destructive styling, no unsupported failure claim,
  and no support escalation. Genuine provider errors and sign-in recovery keep
  their existing handling. The design catalog uses the production notice
  builder and presentation mapping.
- The successful-callback/expired-revisit regression verifies no second provider
  completion and no failure email. Deferred diagnostics use the existing parser;
  storage failure cannot block the redirect, and unknown route provider text
  is reduced to the registry-backed unknown category.
- All examples and verification data are synthetic. No new dependencies,
  persisted control state, or provider requests were introduced.
- One new Web-owned runtime-log event is additive and never sent to the runner;
  existing columns and browser callback query values are unchanged. An older
  Web reader can reject a recent log list containing the new event; the status
  route catches this and omits diagnostic history. Deploy Web reader and writer
  together; direct SQL remains available during skew or rollback. Connection
  state is unaffected. ReviewGPT and exact-head CI are PR gates when a PR is opened.
- Changelog: updated, device-return-link-recovery. This local task has no PR
  number, so the fragment does not invent source provenance.
Status: completed
Updated: 2026-09-08
Completed: 2026-09-08
