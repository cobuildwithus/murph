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

- Production evidence showed that the failed switch windows never reached
  Venice. The durable provider preference changed successfully, but the warm
  private runtime did not begin its existing mismatch/checkpoint/restart path
  until the next foreground turn. The member's group runtime was independent,
  which explains why group replies continued.
- The Settings route regression proves that only an effective provider change
  schedules the existing bounded runtime-recheck signal, that the HTTP response
  is not held open for the handoff, and that signal failure cannot undo the
  committed preference.
- Assistant-runtime regressions prove matching-provider, changed-provider, and
  unavailable-authority external wakes. A mismatch uses the existing immediate
  checkpoint/recheck edge; an unavailable best-effort read keeps the ordinary
  idle window while the mandatory provider-entry gate remains fail-closed.
- The existing hosted-local warm-reuse egress scenario now changes the provider
  through the production preference owner, sends the real Temporal recheck,
  observes the immediate-recheck result and a fresh Venice-configured
  invocation, and proves that no stale OpenAI request occurs during handoff.
- The preliminary completion-specialists ReviewGPT pass returned four findings.
  The product-copy finding was accepted by changing visible semantics from
  current execution to the saved default for new replies; its suggested visible
  timing paragraph was rejected because the requested experience is explicitly
  quiet and the controls already communicate the saved default. The
  accessibility finding was accepted as a screen-reader-only canonical save
  announcement with no layout reservation. Both requested coverage gaps were
  accepted through the runtime authority-failure case and the extended
  warm-reuse scenario.
- Product-purpose revalidation: this surface saves one default and retires a
  stale provider-specific runtime before the next private reply. The smallest
  complete experience is the selected/default controls, future-scoped provider
  summary, hidden assistive-technology completion announcement, and visible
  errors. No explanatory success block, new state owner, queue, mailbox item, or
  direct wake is needed.
- Focused Web verification passed: 3 files, 50 tests.
- Assistant-runtime entrypoint verification passed: 261 tests.
- Web, assistant-runtime, and Cloudflare typechecks passed.
- Scoped Web lint and `git diff --check` passed.
- Desktop and mobile design-study proof plus a direct intercepted save confirmed
  that success leaves no visible status row or reserved space and exposes one
  polite screen-reader announcement.
- The production-faithful hosted-local warm-reuse scenario could not begin
  locally because the guarded runner bundle measured 9,950,881 bytes against
  the 9,889,219-byte production budget. The invariant was not weakened or
  bypassed. The exact-head canonical GitHub warm-reuse lane remains the required
  execution proof.
- Draft PR: https://github.com/cobuildwithus/murph/pull/1170
- Preliminary ReviewGPT:
  https://chatgpt.com/c/6a6afb2a-26b8-83ea-b32e-997d1a8541fb

Status: completed
Updated: 2026-07-30
Completed: 2026-07-30
