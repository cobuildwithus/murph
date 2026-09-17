# Scope inactivity pause to proactive iMessage delivery

## Outcome and proof

Email, Telegram and other non-Linq assistant work must remain runnable when the
iMessage inactivity window has elapsed. Proactive iMessage delivery keeps the existing
28-day engagement policy; accepted conversation replies remain deliverable.

## Ownership and implementation

Remove the member-wide pause from Web reconciliation. Move its engagement
predicate to the existing authenticated Linq egress owner after route authority
and exact inbound resolution. Use the existing delivery-block result, scheduled
preflight skip, and durable outbox recipient-inbound recovery. Add no scheduler,
state, queue, or database migration. Preserve existing qualifying engagement
sources, usage/consent gates, signup participant authority and exact replies.

## Product UX

- Email welcome and non-Linq schedules: execute under ordinary access and usage.
- Dormant iMessage schedules: skip before model work; do not send outreach.
- Known SMS/RCS: bypass the pause; unknown Linq service stays conservative.
- Queued Linq delivery: block before provider dispatch and retain ordinary recovery.
- Fresh Linq replies: remain eligible through exact accepted-input authority.
- Mixed-channel work: blocked Linq work cannot prevent other channel work.

## Verification and completion

- Focused Web reconciliation/egress tests; shared parser coverage; scheduled
  preflight and outbox recovery tests; relevant typechecks.
- Focused synthetic real-Codex journey for non-Linq scheduled behavior.
- Parent diff/privacy/complexity review; owner docs and changelog; scoped commit.
- Deployment: consumer-first rollout of the added block code, then Web removal
  of the global gate. Old Workers ignore the new preflight code, but Web withholds dispatch
  claims and old runtime claim validation prevents provider delivery. No deployment is part of this task.

## Result and evidence

Implemented locally. Removed the member-wide reconciliation predicate and
relocated its existing engagement checks to the resolved Linq egress boundary.
No new durable state or migration. The old reconciliation reason remains
readable for wire compatibility. Parent review verified route authority,
provider-dispatch withholding, typed blocked recovery, usage gates, bounded
engagement reads, changed paths, and privacy. Complexity diff passes and reduces
existing debt in the edited Web handlers.

Deterministic proof passed:

- Web reconciliation, Linq engagement, inbound daily state, changelog and
  provider-health suites: 199 tests in total.
- Engine scheduled preflight: two block-code cases skip before model execution.
- Runtime provider entry: two cases issue no provider message and classify the
  durable block for recipient-inbound recovery.
- Worker delivery-block parsing: two cases preserve the typed code.
- Typechecks: hosted-execution, assistant-runtime, assistant-engine, Web and
  Cloudflare. Package checks use the repository source-resolved lane; separate
  package-build boundary proof was not run.
- `pnpm complexity:diff` and `git diff --check` pass.

Focused local live proof passed with `gpt-5.6-terra`, local subscription auth:

- `pnpm test:assistant:live -- --test 'greets a new channel contextually.*40 inactive days'`:
  one model request, one new contextual email greeting after a synthetic
  40-day-old Linq conversation, no tools, and no duplicate on replay.
- `pnpm test:assistant:live -- --test 'sends one scheduled Telegram cue with live route audience true'`:
  one concise scheduled reminder, one delivery intent, current Telegram route
  resolution, and no Linq route lookup.

Both commands used the authorized alternate-home argument after available
logins failed before provider action; no credential was copied or persisted.
Exact local auth paths and synthetic transcripts are omitted. Reply review:
Ready. Both replies were concise, contextual or timely, and free of internal
implementation language. Combined deterministic and live proof covers the
admission and delivery boundaries; live runs use synthetic providers and do not
prove deployed recovery.

Changelog included for the member-visible channel independence fix. Existing
focused-live-selector friction is already tracked; no new repository workaround
or Frog entry was needed. No PR, exact-head CI, ReviewGPT, or deployment was
performed in this local change task. A later PR requires the routed final
ReviewGPT and CI before merge; production rollout remains consumer-first.

Status: completed
Updated: 2026-09-17
Completed: 2026-09-17
