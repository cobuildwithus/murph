# Environment Reconciliation Wire Compatibility

Status: active
Updated: 2026-08-26

## Outcome And Invariant

New Temporal workers can read `environmentInterviewPending` and select the
dedicated Environment owner without exposing that additive key to still-routable
immutable readers that reject unknown reconciliation facts. The request remains
authenticated and signed, legacy readers keep their exact prior response, and
the change adds no persisted rollout state or second scheduling owner.

## Proven Boundary

- Required exact-SHA Temporal compatibility failed because reader `6bff...`
  rejects `environmentInterviewPending`; the other supported readers passed.
- That reader remains in the private supported-reader manifest, so publishing
  the key unconditionally would break a live compatibility boundary.
- The current private client signs the reconciliation URL search, which can
  carry an explicit capability without weakening callback authentication.

## Plan

1. Keep the legacy no-search wire projection byte-shape compatible and add one
   exact signed-search capability for the Environment fact. Completed.
2. Make the new private Temporal reader opt in to that capability and retain
   strict parsing of the boolean fact. Completed.
3. Cover legacy omission, negotiated inclusion, signed client search, workflow
   selection, and both ownership directions with focused and production-shaped
   proof. In progress.
4. Push and rerun sensitive exact-head ReviewGPT, required CI, and the protected
   immutable-reader matrix before merge. Pending.

## Deployment

Publish and deploy the public legacy-default route and processing controller
before deploying the private worker that sends the opt-in search. Old readers
continue receiving their old response throughout the window. The new worker
pins the released public package, signs the exact search, and only then selects
`environment_interview`; rollback removes the private opt-in first.

## Verification

- Hosted-execution tests pass 557/557.
- Exact producer-fixture tests pass 3/3 and prove legacy fixtures omit the key.
- The Web route test passes both legacy omission and negotiated inclusion.
- Five focused private Temporal files pass 214/214 and private typecheck passes.
- Public Hosted Web prepared typecheck passes.
- The production-shaped local journey setup was blocked before runtime by the
  macOS runner static-closure budget; exact-head Linux CI owns that platform
  check, while the previously reviewed ownership behavior remains unchanged.
