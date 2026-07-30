# Experiment Outcome Selection

Last verified: 2026-07-29

## Product Boundary

This contract applies only when an experiment is the selected primitive or the
member explicitly asks to run one. It does not define new-member onboarding and
must not make experiment creation the default destination of a health goal,
question, task, or baseline review.

Experiment choice is a choice between **member-valued outcomes**, not between
compliance tactics. Offer two or three options only when that choice would be
useful. Never pad a menu with a weak candidate, and do not show a menu when one
clearly fitting experiment has already been chosen.

Every visible option should make four things legible:

1. the result the member wants
2. the intervention Murph proposes
3. the timeframe required to see a plausible signal
4. the evidence Murph will use to support a decision at the end

Behavior floors, tiny versions, fallbacks, reminder timing, and logging
mechanics belong in setup after the member chooses an outcome. They appear in
an option only when behavior adoption is explicitly the desired result.

## Outcome Quality Gate

Do not show or start a proposed experiment unless all of these are true:

1. **The result matters to this member.** It connects to something they said
   they want. Available data is not evidence of value.
2. **Murph can observe it credibly.** There is one stable primary outcome with
   a bounded capture and comparison plan, plus only a small number of
   supporting signals. Canonical metrics receive richer normalization and
   interpretation, while custom numeric outcomes may declare their own unit,
   capture route, and reducer. A session-captured custom outcome has exactly
   one declared matching field. Qualitative outcomes have explicit baseline
   and follow-up evidence for a structured review.
3. **The result can plausibly change in the timeframe.** Otherwise lengthen
   the run, narrow the promise, or do not offer it.
4. **The evidence can distinguish a worthwhile change from noise.** Define a
   useful direction or magnitude when the protocol supports it.
5. **The answer changes a decision.** The result can support keeping,
   changing, extending, or stopping the intervention.
6. **The expected value is worth the burden.** Logging, risk, cost, and
   disruption are proportionate to the usefulness of the answer.

A candidate fails when the only measurable result is completion rate, its
outcome is a generic phrase such as “be healthier,” it promotes a wearable
metric merely because it is available, its timeframe is too short for the
promise, or its likely signal cannot support a decision.

## Keep The Concepts Separate

- **Outcome:** the change the member values, such as sleeping longer, waking
  more rested, improving a repeatable running benchmark, gaining strength,
  reducing a symptom, or establishing a routine they explicitly want.
- **Intervention:** the thing being tested, such as a running block, caffeine
  cutoff, strength plan, protein target, or bedtime routine.
- **Evidence:** the primary measurement and supporting context used to
  evaluate progress.
- **Support mechanics:** floors, tiny versions, fallbacks, reminders, and
  repair policies that help the intervention survive real life.
- **Adherence:** evidence that the intervention was actually tested. It helps
  interpret the outcome; it is not automatically the outcome.

Consistency can be a legitimate primary outcome when the member explicitly
wants the behavior itself. Define an end state they value, such as establishing
three runs per week for four weeks. When the deeper goal is fitness,
appearance, sleep, pain, energy, or another health result, consistency remains
a mechanism or intermediate measure.

## Evidence And Timeframe

Prefer evidence that is direct and interpretable for the promised outcome:

- aerobic fitness: a repeatable pace, distance, or submaximal-effort benchmark
- strength: repeated load, reps, or movement benchmarks
- visual physique goals: optional standardized photos or measurements, with
  explicit interest and privacy-safe handling
- sleep: the specific dimension the member values, such as duration, timing,
  awakenings, or morning energy
- symptoms or function: a repeated symptom or capability measure that matters
  to the member
- biomarkers: a defined baseline and follow-up measurement when the protocol,
  timing, and collection plan support it

Wearable signals may be primary outcomes when the member explicitly cares
about them and the protocol and duration make the claim credible. Otherwise
they are supporting context.

For wearable sleep evidence, use the provider-neutral sleep-pattern read model rather than interpreting a provider title or one nightly score. Keep these boundaries visible:

- explicit naps are excluded from nightly-pattern dates, while legacy records with no explicit sleep type remain `unknown` and are included with a caveat rather than guessed from presentation text
- missing dates remain missing and never mean zero sleep or no sleep
- local clock statistics use each night's canonical IANA time zone, or an explicit validated reporting-zone fallback; without either, omit timing instead of inventing it
- duration uses elapsed instants across DST, while bedtime, wake time, and midpoint use local clock time
- provider and time-zone mixing, duplicate or overlapping windows, late arrivals, local-date mismatches, and both relative and absolute source freshness can weaken interpretation
- session duration and selected total sleep are different quantities; provider-reported awake minutes are not automatically WASO or awakening count

Duration must match the promise. A short run can fit a fast-moving sleep or
symptom outcome. Strength, aerobic performance, body composition, visible
physique change, and many lab outcomes often need longer windows or narrower
near-term claims. If a window can establish only feasibility, say so and offer
it only when that answer is useful.

## Option Shape

When options are useful, use this compact structure:

> **[Member-valued result]**
>
> [Intervention] for [credible timeframe]. Murph will compare [primary
> evidence] and use [supporting evidence, if useful] to help decide whether to
> keep, change, extend, or stop it.

End with a value question such as “Which of those results would feel most
valuable right now?” Make deferring easy. If a targeted repair pass produces
only one credible option, show that option with a defer path; never invent a
filler choice.

## Handoff To Experiment Onboarding

The selected outcome and evidence promise anchor experiment setup. Setup may
adapt dose, schedule, safety, support, or measurement details, but it must not
silently replace the outcome with an easier adherence target or convenient
proxy.

If the selected Health Commons protocol cannot credibly measure the promised
result, clarify the mismatch, choose a better same-family protocol, narrow the
promise, or offer a different option before creating a run. Absence from the
canonical metric catalog does not block a bounded experiment. Start fails
closed only when the capture plan is incomplete or contradictory, a
session-captured field is undeclared or ambiguous, or a structured review
lacks bounded baseline and follow-up evidence. Analysis support is progressive:
canonical outcomes retain richer interpretation, custom numeric outcomes use
the declared comparison, and qualitative outcomes close with a review-ready
evidence receipt rather than a manufactured numeric delta. A completed
qualitative interpretation is a separate review step.

## Success Criteria

1. Each proposed option is tied to a result the member values.
2. Every option names an intervention, credible timeframe, and primary
   evidence.
3. No option relies only on adherence or a convenient proxy unless the member
   explicitly chose that result.
4. The duration can reveal the promised signal or is clearly labeled as a
   feasibility phase.
5. Evidence can distinguish meaningful change from normal variation or the
   result is clearly exploratory.
6. The member can defer without pressure.
7. The chosen outcome survives setup and eventual outcome review.
