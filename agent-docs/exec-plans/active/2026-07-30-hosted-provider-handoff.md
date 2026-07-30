# Hosted assistant provider handoff

## Outcome

Make a saved core-assistant provider change take effect before the member's
next private reply instead of making that reply discover and recover from a
stale warm invocation. Keep the Settings save interaction quiet on success
while preserving actionable error feedback.

## Root cause

Postgres is correctly the sole durable provider-preference owner, and every
provider turn revalidates that live preference before egress. The authenticated
Settings route currently commits the preference without signaling the existing
Temporal runtime owner. A warm invocation therefore discovers a provider
mismatch only when the next accepted turn reaches the provider boundary. It
then requeues the turn, checkpoints, releases its provider-specific invocation,
and asks for a fresh invocation. That makes the first reply after a switch
depend on a checkpoint/restart boundary that should have completed at save
time.

## Scope

- After a committed effective provider change, send the existing bounded,
  best-effort `runtime_recheck_requested` Temporal signal.
- On an external wake with no conversation work, let a warm invocation compare
  its provider snapshot with the live Web-owned preference.
- When they differ, checkpoint immediately and return the existing
  `immediateRecheckRequested` edge so the next invocation starts with the saved
  provider.
- Keep provider egress fail-closed when live provider authority is unavailable.
- Remove the verbose Settings success paragraph and its reserved layout space;
  retain retry and error feedback.
- Update the hosted configuration and runtime protocol documentation.

## Invariants

- Postgres remains the only durable provider-preference owner.
- Temporal remains the only orchestration and retry owner.
- The change adds no mailbox item, queue, preference replica, direct runtime
  wake, or second state machine.
- Provider credentials and provider-specific inference remain unavailable
  until a fresh invocation is created with matching authority.
- A failed best-effort recheck signal cannot roll back or misreport a durable
  preference save; the next invocation and per-turn provider gate remain the
  correctness backstop.
- Model-only and reasoning-only changes preserve their existing warm-thread
  behavior.

## Steps

1. Add exact effective-provider change evidence to the preference transaction
   result and signal the existing runtime recheck path after commit.
2. Teach the warm runtime to use an otherwise-unserviced external wake as a
   provider-authority handoff point.
3. Add focused Web route and assistant-runtime regressions for changed,
   unchanged, failure, and no-provider-egress cases.
4. Update durable contracts, run scoped verification, and capture frontend
   design proof.
5. Complete the required specialist/final reviews, commit, push, open a PR,
   and verify the exact PR head.

## Evidence

Pending.

Status: active
Updated: 2026-07-30
