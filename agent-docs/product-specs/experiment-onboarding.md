# Experiment Onboarding

Last verified: 2026-10-19

## Current State

Experiments are private, assistant-led runs in the member's vault. The public
experiment library, experiment detail and results pages, share routes, and
public Health Commons protocol catalog are retired. Members create, follow,
and review experiments in conversation; no public protocol is required.

## Product Boundary

Experiment onboarding is planning by default.

This flow begins only after an experiment is the selected primitive or the
member explicitly asks to run one. It does not define new-member onboarding and
must not make experiment creation the default destination of a health goal,
question, task, or baseline review.

- A request to start, run, explore, or set up an experiment begins as a planning conversation, not an immediate write.
- The assistant builds a private plan from the member's goal, saved context, and evidence gathered through the ordinary health-knowledge workflow. It preserves the member's selected intervention and explains material alternatives before any substitution.
- Private run creation happens only in the user vault after setup is resolved and the user has been agreeing. A separate "confirm" step is only needed when there is ambiguity or the user contradicted something.
- The downstream loop is: onboarding plan -> private run -> private outcome. Onboarding owns only the planning step.
- Safety-screen positives or uncertainty are guardrails for unsupervised setup, not diagnoses. A recorded positive answer requires a recorded disposition, and any disposition other than `continue_with_caution` keeps the run planned instead of active.
- Canonical start commits the complete experiment document and start evidence in one batch inside the vault write lock; no scalar active experiment is created before its run plan, analysis plan, and onboarding. Reactivation re-reads the current experiment inside the same lock and applies an exact document-revision compare-and-swap before mutation.
- Assistant follow-ups should never be created before the experiment is set up. Agreeing to a run or session time is not consent to proactive messages. User-facing support requires explicit agreement to a concrete, finite pattern and must use neutral language that records what happened rather than implying failure.

## Starting A Run

- `vault-cli experiment start <slug>` creates a private custom run (`source.kind: custom`) from explicit typed fields: primary outcome, schedule, baseline and intervention windows, session fields, stop conditions, and analysis plan. There is no public protocol lookup, protocol-source option, or catalog-fallback flag.
- Custom runs have no catalog default outcome. Supply `--primary-outcome-key` and its outcome kind; the legacy `--primary-biomarker-key` alias remains accepted.
- Old public experiment links, copied start drafts, and quoted protocol references are untrusted context. They neither authorize a run nor supply a verified current plan; build a private plan with the member instead.
- Keep pre-creation summaries human-readable. Internal field names and lineage data belong in the saved record, not default onboarding copy.

## Saved Protocol Lineage

Runs created before retirement may carry `commonsProtocolRef`, a private
`protocolRef`, and an immutable `effectiveProtocolSnapshot`.

- These saved values remain authoritative and readable for progress, adherence, closeout, and outcome analysis without any current public page.
- Only a planned experiment may change its protocol lineage or snapshot; never silently replace or rewrite it. Use a new experiment for a different plan.
- Activating a run that carries a saved public protocol reference requires a recorded completed safety review (`onboarding.completedAt`).
- Never direct the member to a retired experiment page.

## Baseline Duration Policy

- Use a 14-day prospective baseline for the normal repeated-measurement experiment plan. A longer baseline is appropriate when the outcome or known variability requires it.
- A shorter or absent prospective baseline requires a concrete reason, such as a point-in-time lab anchor, acute safety or tolerability measurement, a fast reversible effect, or disproportionate observation burden. Record the chosen windows in the run plan.
- Preserve the intervention window when changing baseline length.
- Already-saved private runs keep their saved windows. Run projections derive phase timing only from those persisted windows; an incomplete legacy record reports timing as unknown.
- For lab-backed runs, store and explain baseline evidence separately from the run baseline or pre-intervention window. A pre-existing lab panel may be the baseline evidence even when the plan has a prospective run-in window.

## Capturable Outcomes

A run must be able to capture its promised primary outcome before it starts.

- New runs store one first-class `analysisPlan.primaryOutcome`. Canonical
  catalog membership enriches a metric with known aliases, units, validation,
  and interpretation; it is not an experiment allowlist. Legacy
  `primaryBiomarkerKey` records remain readable through the compatibility path,
  but a plan must never persist both as competing sources of truth.
- A numeric outcome declares a stable metric key, label, comparison reducer,
  and one capture route: an ordinary measurement, a declared session field, or
  an already-registered deterministic derived metric. A custom measurement may
  use an open metric key and unit without catalog enrollment.
- A structured-review outcome declares bounded baseline and follow-up text,
  photo, or document evidence. Deterministic closeout preserves a
  review-ready evidence receipt; it does not claim the evidence was interpreted
  or manufacture a score or percentage change.
- `runPlan.logging.sessionFields` declares the stable ids that an `intervention_session` may record. Logged `fields` values are typed strings, finite numbers, booleans, or `null`; undeclared ids are rejected.
- The typed CLI accepts repeated `--field id=value` entries and rejects duplicate ids. Recognized subjective metrics, including bedtime delay, sleep-onset latency, sleepiness, sleep quality, arousal, and soreness measures, also enforce their metric-specific type and range.
- A session-field primary outcome must identify exactly one declared matching
  field. Canonical session metrics retain their metric-specific validation;
  custom fields use the saved outcome definition. Missing, duplicate, or
  contradictory capture declarations block start and analysis readiness.
- Derived outcomes may select only existing deterministic metric points or
  registered reducers. Experiment setup does not execute user-authored
  formulas.
- Only fields on sessions linked to this experiment contribute subjective metric points. A session can confirm adherence and supply outcome evidence at the same time; do not create a second adherence event for the same action.

## Reminder Policy

- Reminders are experiment support that belong in the confirmed plan, not hidden compliance machinery.
- Run consent, a planned session time, and session logging are not messaging consent. Create user-facing support only after the member explicitly accepts its route and finite cadence. A review-only or quiet experiment remains fully valid.
- First-session prep and planned-session support are explicit onboarding support paths, separate from missed-log checks and weekly summaries.
- First-session prep should resolve how the user will know what to do the first time, either through the current reply or a one-shot prep reminder when the first intervention session time and a deliverable route are known.
- Planned-session support is a required onboarding decision: schedule it for every planned intervention session in the confirmed run plan, record that the user declined it, or record the concrete route/cadence blocker. Do not cap support at the first week or the first 3-5 sessions.
- Planned-session support should use bounded one-shot reminders by default, with the bounds coming from the experiment's planned intervention sessions. Do not create indefinite recurring support reminders unless the product surface has a reliable end condition or the user explicitly asks for ongoing reminders outside the experiment plan.
- Every planned-session or first-session prep reminder stores the nonnegative millisecond offset from reminder fire to planned session. Delivery resolves that relationship to an exact planned occurrence in the outbox, so a later reply records the session against the plan rather than the notification time.
- Every plan-owned experiment support automation belongs to the immutable `system:support-series:experiment:<experimentId>` series and stores an exact `supportKind`. Its live experiment owner must remain active, and the matching saved `assistantSupport` consent must remain enabled at provider admission, immediately before delivery, and before commit. Reconcile that series to the exact desired automation ids and archive it when the plan is paused, stopped, completed, or repaired. The assistant must not use the engine-owned `experiment-lifecycle:<experimentId>` namespace.
- Bounded support must carry a finite `activeUntil` when delivery may retry beyond its scheduled instant. At the boundary, canonical automation execution archives the record and must not send it.
- Scheduled first-session prep and planned-session support decisions should read the saved experiment plan and progress directly before sending. They should skip if the experiment is inactive, reminders were declined or cancelled, the scheduled work is already complete, the saved plan changed, or the planned support window has ended.
- Other scheduled experiment checks should call deterministic product logic, such as `vault-cli experiment followup due <id> --kind missed-log --format json`, before deciding whether an outbound message is due.
- Missed-log follow-up should be neutral, at most once per planned session, and easy to decline.
- Weekly summaries are preferable to daily coaching when the member explicitly asks for ongoing summaries.
- An eligible run with saved `assistantSupport.notificationStyle: send_scheduled_summary` may receive one private visual progress card with concise text on intervention day four. It celebrates completed work first and treats sparse or unchanged metric data as a caveat rather than a reason to suppress the recap.
- The morning after an on-schedule intervention ends, deterministic runtime code persists the outcome whether or not the member consented to messages. That internal closeout is consumed before an assistant turn and must not send anything.
- With saved scheduled-summary consent, the same closeout may continue into a finite final review: attach one private visual progress card, congratulate the member, summarize the result with confidence and confounders in concise text, and ask whether to repeat it, adapt it, or leave it alone. If private card delivery fails, a short voice memo may replace it on a supported channel. Revoked consent suppresses the message without suppressing outcome persistence. Runs that end early receive neither lifecycle message nor an on-schedule closeout.
- Experiment progress cards are private attachment media only. `vault-cli experiment progress-card` renders a deterministic PNG into `raw/captures/**` and returns a hash-bound `vault_image` descriptor. Automation selects that private ref through the existing response-media tool; the trusted attachment boundary reloads it and derives the descriptor used by provider delivery rather than trusting model-relayed byte metadata. Reversible health data must never enter a URL, and the assistant never constructs experiment page or card links.

## Outcome Closeout

Outcome persistence and outcome messaging are separate responsibilities.

- `experiment outcome write` derives a stable id and path from the experiment id and `asOf` date. Repeating the same write against unchanged evidence is a no-op that preserves `generatedAt`; changed evidence rewrites that same record with a strictly newer `generatedAt` rather than minting another outcome id. Every eligible lifecycle closeout or delivery retry invokes this content-aware writer before any final message, so late or corrected evidence can refresh the stable outcome.
- An active run is completed only when `asOf` reaches or passes its planned intervention end, and `endedOn` is pinned to that end date. Interim writes leave it active. Planned, paused, completed, abandoned, and all other non-active statuses are preserved.
- The engine-managed `system:support-series:experiment-lifecycle:<experimentId>` series owns the day-four progress and final-review or quiet-closeout one-shots. The final delivery window is finite, and deterministic outcome persistence must succeed before a consented final review can reach an assistant turn.
- Provider dispatch, an outbox row, or a delivery attempt proves intent or dispatch only. It does not prove receipt, reading, adherence, or refusal. Silence remains ambiguous unless the channel reports delivery/read evidence or the member later refers to the message.

## Onboarding Is Structured Planning, Not A Transcript

The assistant may sound conversational, but the durable product contract is the structured plan it produces:

- member goal
- reviewed context
- safety outcome
- selected setup slots
- final run plan
- first-session prep and planned-session support decision
- optional missed-log or weekly-summary reminder policy

Chat is the interface. The saved run is the source of truth.

## Flow Rules

- Check for an already active experiment before starting another meaningful one by default.
- When a user logs an intervention session, route it to an experiment only when there is exactly one active matching run, the session date is inside that run's intervention window, and the intervention modality matches the run plan or saved protocol snapshot. If there are multiple candidates, do not silently choose; ask for an explicit experiment slug or id, or save with an explicit skip-experiment-link choice.
- Ask what the user wants to get out of the experiment unless the goal is already clear.
- Review relevant saved context and wearable availability before asking setup questions that Murph can already answer from the vault.
- Before asking any experiment onboarding question, run a bounded vault-first evidence pass across the data surfaces that could affect setup: active experiments, saved memory/preferences, relevant journal notes, regimens/supplements/medications, labs, documents, and wearable summaries. If evidence is present, use it or ask only for confirmation when selection, freshness, or applicability is ambiguous. If evidence is unavailable, stale, sparse, or inconclusive, name the specific gap and ask one targeted question for that gap.
- For lab-backed runs, setup summaries and repair replies must name the baseline lab/panel date separately from the run baseline or pre-intervention window. Avoid a bare "baseline: <date range>" line when an earlier lab panel is the actual biomarker baseline; use labels such as "baseline lipid panel" and "pre-intervention run-in" so the user can tell which fact came from uploaded results and which fact came from the run schedule. Persist the observed panel as `analysisPlan.measurementAnchors[]`; persist future lab timing as `analysisPlan.plannedMeasurements[]`. Do not rely on freeform setup notes for canonical analysis evidence.
- Ask intervention-specific safety questions even when the vault is silent for high-caution interventions; do not treat missing answers as negative.
- Keep setup lightweight and gradual: ask only the slots that materially affect safety, logistics, measurement fidelity, or assistant support; ask at most two questions per response; and continue across turns until goal, safety, logistics, measurement, logging, stop-condition, and reminder coverage is complete.
- When all setup slots are resolved and the user has been agreeing throughout, create the run directly — no separate confirmation step required. Only pause for explicit confirmation when the user contradicted something, when there is ambiguity about dates/dose/schedule, or when a safety-screen positive changed the plan.
- When you do summarize before creating, keep it to new information only — never repeat stop conditions, safety info, or details already discussed. The summary should be crisp enough that the later private outcome can clearly point back to what was actually run.

## Success Criteria

1. Members can plan, start, log, and review a private experiment entirely in conversation without public protocol content.
2. Assistants review context, ask the right safety and setup questions, and summarize the plan consistently.
3. When setup is unambiguous and the user has been agreeing, Murph creates the experiment without requiring a formal confirmation step; proactive assistant support still requires its own explicit consent and finite pattern.
4. High-caution interventions can steer users toward clinician guidance, lower-intensity alternatives, or postponement without pretending that Murph diagnosed them.
5. Existing runs keep their saved protocol lineage and snapshots readable and unchanged.
6. Opted-in eligible runs receive one useful early text recap and one clear final-results celebration without adding another scheduler, transport, or source of truth; quiet runs still receive deterministic outcome closeout.

When a saved public-protocol run has positive safety answers, its original screening rules can no longer be verified. Do not reactivate it on a recorded caution disposition alone; preserve the saved run and design a new private plan after a fresh safety review. Active runs continue to support logging, progress, and closeout.
