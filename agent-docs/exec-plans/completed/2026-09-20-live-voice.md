# Local GPT-Live voice control

## Outcome and scope

A reusable website circle starts a full-duplex GPT-Live conversation, pauses
microphone and playback, resumes the same session, and ends it explicitly.
Local preview at `/voice`; public admission and Murph records are out of scope.

## Ownership and invariants

The browser owns transient WebRTC/media state. A development-only, loopback,
same-origin route holds the API key and chooses `gpt-live-1` plus a Responses
backend. No new dependencies, database state, transcripts, or storage owner.
Official GPT-Live WebRTC and session documentation establish the protocol.

## Product UX and failure proof

Check start/permission, ready, pause acknowledgement, resume acknowledgement,
end/finalization, cancelled startup, denied microphone, network/provider failure,
and unmount cleanup. Pause silences both directions locally; the session remains
connected and billable until ended. Retry starts a fresh session.
Render the actual control at desktop and phone sizes and inert states under
`/screenshots/voice`. Check the route's development/origin/key boundaries with
focused tests, then lint and typecheck. Verify actual provider audio if available.

## Delivery

Local prototype only; no public changelog, PR, deployment, or member behavior.
Focused review and scoped commit after validation.

## Validation and review

- Nine focused route and media-lifecycle tests pass.
- Full website typecheck, scoped ESLint, and complexity guard pass.
- Real browser/provider proof: GPT-Live started, accepted synthetic microphone
  speech, returned transcript events and nonzero received audio energy,
  acknowledged pause/resume, and confirmed graceful session closure.
- Desktop and phone captures inspected; no phone overflow or browser errors.
- Reviewed provider credential isolation, production denial, late microphone
  grant cleanup, startup/pause/close timeouts, and stale-session teardown.
- Product UX: Ready for the local prototype. Public member admission and billing
  integration remain outside this task. No public changelog is appropriate.
Status: completed
Updated: 2026-09-20
Completed: 2026-09-20
