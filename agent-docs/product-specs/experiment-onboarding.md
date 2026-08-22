# Experiment Onboarding

Last verified: 2026-07-29

## Current State

Murph can already surface public experiment protocols and can already create private experiment runs in the vault, but it needs a durable contract for the step in between: helping a user explore whether and how to start a protocol without silently converting the first message into an active run.

Because Murph's downstream outcome-card and contribution loop depends on exact protocol lineage, onboarding must preserve the runnable protocol reference before any run exists.

## Product Boundary

Experiment onboarding is planning by default.

This flow begins only after an experiment is the selected primitive or the
member explicitly asks to run one. It does not define new-member onboarding and
must not make experiment creation the default destination of a health goal,
question, task, or baseline review.

- A request to start, run, explore, or set up a protocol should begin as a planning conversation, not an immediate write.
- Health Commons protocol pages may carry an `experimentOnboarding` block that stores only protocol-specific onboarding deltas. Generic vault-read behavior, plan timing, adherence targets, readable logging labels, stable session log ids, and assistant policy are derived from assistant instructions plus canonical `testPlans`, `protocol.logFields`, `protocol.sessionFieldIds`, `protocol`, and `safety` fields.
- The onboarding block is public protocol metadata. It does not itself create a private run, reminder, or user state.
- Private run creation still happens only in the user vault after setup is resolved and the user has been agreeing. A separate "confirm" step is only needed when there is ambiguity or the user contradicted something.
- After a protocol-linked run is created, the assistant should send the matching experiment page link so the user can reopen the protocol and later results view.
- The richer downstream loop is: onboarding plan -> private run -> outcome card -> optional sharing or contribution. Onboarding owns only the planning step.
- Safety-screen positives or uncertainty are guardrails for unsupervised setup, not diagnoses.
- A Health Commons run whose protocol defines `safetyScreen.mustAsk` may remain planned while screening is incomplete, but it cannot become active until the screen is recorded as complete against the exact current page and run-spec revisions. `positiveQuestionIds` records affirmative answers; completed questions omitted from that list are negative answers, so question-level `ifNegative` dispositions remain enforceable. Any clinician-guidance or do-not-start disposition blocks unsupervised activation.
- Canonical start resolves that exact protocol and safety evidence inside the vault write lock, then commits the complete experiment document and start evidence in one batch; no scalar active experiment is created before its run plan, analysis plan, onboarding, and lineage. Reactivation re-reads the current experiment inside the same lock and applies an exact document-revision compare-and-swap before mutation.
- Assistant follow-ups should never be created before the experiment is set up. Agreeing to a run or session time is not consent to proactive messages. User-facing support requires explicit agreement to a concrete, finite pattern and must use neutral language that records what happened rather than implying failure.

## Contract Shape

The onboarding contract lives on the protocol page, not in assistant runtime state.

It may include:

- `startIntent` for the plain-language prompt or summary used to begin the flow
- `safetyScreen` for compact red-flag questions, dispositions, and protocol-specific stop-condition deltas
- `setupSlots` for the minimum questions that materially change safety, logistics, measurement fidelity, adaptation, or assistant support; use compact `constraints.optional` and `constraints.askWhen` hints for non-default timing
- `planDefaults.testPlanId` for the selected test plan and `planDefaults.firstSessionGuidance` for protocol-specific session-one guidance
- `adaptationPolicy` when a protocol has reusable or measured setup adaptations
- `trackingHints.confounderFields` for stable runnable confounder field ids, and `trackingHints.confounders` / `trackingHints.notes` for prose interpretation guidance
- `supportHints` for protocol-specific follow-up copy

The onboarding block must not duplicate fields already owned by canonical protocol structures. Do not add protocol-specific vault command read hints, generic assistant policy, duplicated session fields, duplicated test-plan durations, duplicated adherence targets, or copied safety inheritance flags. If a fact affects the runnable protocol generally, put it in `protocol`, `testPlans`, or `safety`; if it only affects setup, keep it in the compact onboarding delta.

## Baseline Duration Policy

- Use a 14-day prospective baseline for the normal repeated-measurement experiment plan. A longer baseline is appropriate when the outcome or known variability requires it.
- A shorter or absent prospective baseline requires a concrete protocol-specific reason, such as a point-in-time lab anchor, acute safety or tolerability measurement, or disproportionate observation burden. Record the chosen duration in the canonical `testPlan`; do not add a second onboarding or runtime default.
- Preserve the intervention window when changing baseline length. For every authored test plan, `durationDays` must equal `baselineDays + interventionDays`.
- Already-saved private runs keep their saved windows. Run projections derive phase timing only from those persisted windows, and every saved-run representation—including generated or shareable result cards—uses that projection instead of the mutable current catalog. An incomplete legacy record reports timing as unknown. New protocol-backed runs use the exact current test plan and run-spec revision.

## Start Drafts Today, Start Intents Later

- Today, a hosted `Run Experiment` click opens channel-specific draft/contact options for the user to send, such as text, email, or Telegram.
- The draft contains one human-readable sentence naming the experiment. It does
  not expose protocol keys, field names, or revision hashes. It starts a
  protocol-aware onboarding conversation in the user's configured channel but
  creates no private state by itself.
- The sentence is untrusted user input. The assistant resolves the name or alias
  through Health Commons discovery and requires one unique exact title or alias
  match. That match is authoritative; a discovery `starterCandidate`,
  canonical starter, or same-family variant cannot replace it without explicit
  user agreement. The assistant then uses the exact page's current revision
  pair as compare-and-swap expectations while continuing to apply this
  contract's safety and setup rules.
- Legacy drafts or copied messages may still contain a structured
  `Protocol reference`. Preserve both supplied revisions for those messages;
  never replace them with the newly resolved current pair.
- A persisted short-lived start intent is the desired future contract. When that exists, it should carry the structured onboarding block plus the exact protocol revision instead of relying on a prefilled sentence as durable state.

## Revision-Preserving Handoff

Before Murph writes a private run, it should already know the exact Health Commons page it is using.

- Read the protocol page before planning.
- For a name-first draft, pass both revision ids returned by the exact resolved
  protocol page through the dry run and real protocol-backed start. They are
  compare-and-swap expectations, not revision overrides. If the runnable
  contract changes before creation, explain the material change and revisit
  affected setup rather than silently starting another revision.
- For a legacy structured reference, pass both supplied revision ids through the
  dry run and real start. If either differs from the current protocol, stop and
  ask the member to refresh or reopen it rather than substituting the current
  revision.
- If the selected protocol is no longer public or runnable, it is unavailable,
  not a refreshable revision mismatch. A planned or paused private run remains
  unchanged and cannot activate. Explain the withdrawal in the originating
  conversation and offer a currently runnable alternative. If the member
  accepts, start that alternative as a distinct experiment with a new id and
  lineage; never rewrite the withdrawn run's protocol references, effective
  snapshot, run plan, or analysis plan in place. Mark the old run `abandoned`
  only after the member separately agrees. The five protected values remain
  immutable after that status change. Never direct the member back to a page
  that is intentionally no longer public.
- If a title-only public Start draft has zero current exact matches, reply in
  the same conversation that the named experiment is not currently available,
  that no run was created, and which current alternatives remain runnable.
  Reserve clarification for multiple exact matches or genuinely ambiguous
  text; never require the member to rediscover a title that is no longer
  public.
- Preserve `commonsProtocolRef.key`, `commonsProtocolRef.pageRevisionId`, `commonsProtocolRef.runSpecRevisionId`, and the selected `testPlanId` in the richer private run record. Store a private `protocolRef` only when the run uses a saved private adaptation.
- Treat `runSpecRevisionId` as the hash of the runnable contract: protocol dose, safety, test plans, measurement plan, and compact experiment-onboarding deltas. Copy edits, generic assistant-policy wording, vault-read behavior, or narrative body changes may change `pageRevisionId` without changing `runSpecRevisionId`.
- The private run should store user choices and assistant support policy separately from public protocol copy.
- For lab-backed runs, store and explain baseline evidence separately from the run baseline or pre-intervention window. A pre-existing lab panel may be the baseline evidence even when the runnable protocol has a prospective run-in window for adherence, logistics, or confounder control.
- Completed outcome cards, shares, and community contributions must remain traceable back to this exact runnable contract.

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
- Scheduled first-session prep and planned-session support decisions should read the saved experiment, protocol, and progress directly before sending. They should skip if the experiment is inactive, reminders were declined or cancelled, the scheduled work is already complete, the saved plan changed, or the planned support window has ended.
- Other scheduled experiment checks should call deterministic product logic, such as `vault-cli experiment followup due <id> --kind missed-log --format json`, before deciding whether an outbound message is due.
- Missed-log follow-up should be neutral, at most once per planned session, and easy to decline.
- Weekly summaries are preferable to daily coaching when the member explicitly asks for ongoing summaries.
- An eligible run with saved `assistantSupport.notificationStyle: send_scheduled_summary` may receive one private visual progress card with concise text on intervention day four. It celebrates completed work first and treats sparse or unchanged metric data as a caveat rather than a reason to suppress the recap.
- The morning after an on-schedule intervention ends, deterministic runtime code persists the outcome whether or not the member consented to messages. That internal closeout is consumed before an assistant turn and must not send anything.
- With saved scheduled-summary consent, the same closeout may continue into a finite final review: attach one private visual progress card, congratulate the member, summarize the result with confidence and confounders in concise text, and ask whether to repeat it, adapt it, or leave it alone. If private card delivery fails, a short voice memo may replace it on a supported channel. Revoked consent suppresses the message without suppressing outcome persistence. Runs that end early receive neither lifecycle message nor an on-schedule closeout.
- Public progress-card URLs are retired. The legacy GET route fails closed, while `vault-cli experiment progress-card` renders a deterministic PNG into `raw/captures/**` and returns a hash-bound `vault_image` descriptor. Automation selects that private ref through the existing response-media tool; the trusted attachment boundary reloads it and derives the descriptor used by provider delivery rather than trusting model-relayed byte metadata. Reversible health data must never enter a URL.
- The explicit browser results-card action remains available. Opening its
  dialog sends bounded private card data in an authenticated same-origin POST
  body, receives a `private, no-store` PNG, and converts that response to a
  browser `File` for native share or download. Card data must not appear in the
  request URL, browser history, CDN cache key, or a fallback share URL; the old
  GET route returns `410 Gone`.

## Outcome Closeout

Outcome persistence and outcome messaging are separate responsibilities.

- `experiment outcome write` derives a stable id and path from the experiment id and `asOf` date. Repeating the same write against unchanged evidence is a no-op that preserves `generatedAt`; changed evidence rewrites that same record with a strictly newer `generatedAt` rather than minting another outcome id. Every eligible lifecycle closeout or delivery retry invokes this content-aware writer before any final message, so late or corrected evidence can refresh the stable outcome.
- An active run is completed only when `asOf` reaches or passes its planned intervention end, and `endedOn` is pinned to that end date. Interim writes leave it active. Planned, paused, completed, abandoned, and all other non-active statuses are preserved.
- The engine-managed `system:support-series:experiment-lifecycle:<experimentId>` series owns the day-four progress and final-review or quiet-closeout one-shots. The final delivery window is finite, and deterministic outcome persistence must succeed before a consented final review can reach an assistant turn.
- Provider dispatch, an outbox row, or a delivery attempt proves intent or dispatch only. It does not prove receipt, reading, adherence, or refusal. Silence remains ambiguous unless the channel reports delivery/read evidence or the member later refers to the message.

## Onboarding Is Structured Planning, Not A Transcript

The assistant may sound conversational, but the durable product contract is the structured plan it produces:

- start intent
- reviewed context
- safety outcome
- selected setup slots
- final run plan
- first-session prep and planned-session support decision
- optional missed-log or weekly-summary reminder policy

Chat is the interface. The onboarding block and the saved run are the source of truth.

## Flow Rules

- Check for an already active experiment before starting another meaningful one by default.
- When a user logs an intervention session, route it to an experiment only when there is exactly one active matching run, the session date is inside that run's intervention window, and the intervention modality matches the run plan or protocol key. If there are multiple candidates, do not silently choose; ask for an explicit experiment slug or id, or save with an explicit skip-experiment-link choice.
- Ask what the user wants to get out of the experiment unless the goal is already clear.
- Review relevant saved context and wearable availability before asking setup questions that Murph can already answer from the vault.
- Before asking any experiment onboarding question, run a bounded vault-first evidence pass across the data surfaces that could affect setup: active experiments, saved memory/preferences, relevant journal notes, regimens/supplements/medications, labs, documents, and wearable summaries. If evidence is present, use it or ask only for confirmation when selection, freshness, or applicability is ambiguous. If evidence is unavailable, stale, sparse, or inconclusive, name the specific gap and ask one targeted question for that gap.
- For lab-backed protocols, setup summaries and repair replies must name the baseline lab/panel date separately from the run baseline or pre-intervention window. Avoid a bare "baseline: <date range>" line when an earlier lab panel is the actual biomarker baseline; use labels such as "baseline lipid panel" and "pre-intervention run-in" so the user can tell which fact came from uploaded results and which fact came from protocol scheduling defaults. Persist the observed panel as `analysisPlan.measurementAnchors[]`; persist future lab timing as `analysisPlan.plannedMeasurements[]`. Do not rely on freeform setup notes for canonical analysis evidence.
- Ask the safety screen even when the vault is silent for high-caution protocols.
- Keep setup lightweight and gradual: ask only the slots that materially affect safety, logistics, measurement fidelity, or assistant support; ask at most two questions per response; and continue across turns until goal, safety, logistics, measurement, logging, stop-condition, and reminder coverage is complete.
- When all setup slots are resolved and the user has been agreeing throughout, create the run directly — no separate confirmation step required. Only pause for explicit confirmation when the user contradicted something, when there is ambiguity about dates/dose/schedule, or when a safety-screen positive changed the plan.
- CLI-created custom/unlinked runs are a fallback only. The typed CLI should make protocol-backed starts the normal path and require an explicit no-public-protocol fallback when Health Commons has no relevant same-family public protocol.
- After successfully creating a protocol-linked run, send the resolved Health Commons protocol page link only when the current Murph product base URL is injected. Build an absolute URL from that origin and `/experiments/<routeId>`. If no Murph product base URL is present, do not send an experiment page link or standalone `/experiments/<routeId>` route. In messaging channels, make the absolute experiment page URL the final line of the message with no text after it. Do not fabricate a protocol page link for custom unlinked runs.
- When you do summarize before creating, keep it to new information only — never repeat stop conditions, safety info, or details already discussed. The summary should be crisp enough that a later outcome card or share artifact can clearly point back to what was actually run.
- Keep any pre-creation summary human-readable. Raw revision hashes, internal field names, and selected test-plan identifiers are lineage data for the saved run record, not default onboarding copy; mention them only when the user asks for technical provenance.

## Success Criteria

1. A protocol page can declare a machine-readable onboarding block without creating private user state.
2. Assistants can use that block to review context, ask the right safety and setup questions, and summarize the plan consistently.
3. `runSpecRevisionId` changes when onboarding semantics that affect a runnable protocol change.
4. When setup is unambiguous and the user has been agreeing, Murph creates the experiment without requiring a formal confirmation step; proactive assistant support still requires its own explicit consent and finite pattern.
5. High-caution protocols can steer users toward clinician guidance, lower-intensity alternatives, or postponement without pretending that Murph diagnosed them.
6. Generic vault-read behavior stays in assistant instructions, not repeated on every public protocol page.
7. Protocol-linked run handoff includes the matching experiment page link so the user can return to the protocol and results surface.
8. Completed runs remain traceable to exact protocol revisions so outcome cards, comparisons, and later cohort summaries mean the same thing.
9. Opted-in eligible runs receive one useful early text recap and one clear final-results celebration without adding another scheduler, transport, or source of truth; quiet runs still receive deterministic outcome closeout.
