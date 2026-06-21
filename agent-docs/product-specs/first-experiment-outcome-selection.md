# First-Experiment Outcome Selection

Last verified: 2026-06-21

## Current State

First-run onboarding currently ends by offering several bounded health experiments. The option set is grounded in the user's context and Health Commons, but the visible copy can still lead with behavior mechanics such as a run floor, step floor, protein minimum, or session cadence.

That makes the handoff feel like a list of chores. It also creates a deeper product risk: Murph can complete a technically valid experiment and return only an adherence result that the user did not care about.

## Product Decision

The first-experiment choice is a choice between **user-valued outcomes**, not between compliance tactics.

Murph should normally offer two or three credible options. Never pad the menu with a weak candidate just to reach a count. Every option must make four things legible without becoming verbose:

1. the result the user wants
2. the intervention Murph proposes
3. the timeframe required to see a plausible signal
4. the evidence Murph will use to support a decision at the end

Behavior floors, tiny versions, fallbacks, reminder timing, and logging mechanics belong in setup after the user chooses an outcome. They appear in the option itself only when behavior adoption is explicitly the result the user wants.

## Outcome Quality Gate

Do not show an option unless all of these answers are yes:

1. **Would this result matter to this user?** It should connect to something they said they want. Available data is not evidence of user value.
2. **Can Murph observe the result with credible evidence?** There should be one primary outcome and only a small number of supporting signals.
3. **Can the result plausibly change within the proposed timeframe?** If not, lengthen the run, narrow the promise, or do not offer it.
4. **Can the evidence distinguish a worthwhile change from noise?** Where the protocol supports it, define the magnitude or direction that would be meaningful enough to act on. A tiny fluctuation or unstable daily wearable shift is not a result.
5. **Would the answer change a decision?** The result should support keeping, changing, extending, or stopping the intervention.
6. **Is the expected value worth the burden?** Logging, risk, cost, and disruption should be proportionate to the usefulness of the answer.

A candidate fails the gate when the only measurable result is completion rate, when its outcome is a generic phrase such as "be healthier" or "improve recovery," when it promotes a wearable metric merely because it is available, when the timeframe is too short for the promised change, or when the likely signal is too small or noisy to support a decision.

## Outcome, Intervention, Evidence, and Support

Keep these concepts separate:

- **Outcome:** the change the user values, such as sleeping longer, waking more rested, improving a repeatable running benchmark, gaining strength, documenting early physique change, reducing a symptom, or establishing a routine they explicitly want.
- **Intervention:** the thing being tested, such as a running block, caffeine cutoff, strength plan, protein target, or bedtime routine.
- **Evidence:** the primary measurement and supporting context used to evaluate progress.
- **Support mechanics:** floors, tiny versions, fallbacks, reminders, and repair policies that help the intervention survive real life.
- **Adherence:** evidence about whether the intervention was actually tested. It helps interpret the outcome; it is not automatically the outcome.

### Behavior-change exception

Consistency can be a legitimate primary outcome when the user explicitly wants the behavior itself. Define an end state the user would value, such as "establish three runs per week for four weeks" or "make a weekday protein breakfast automatic," rather than "see whether reminders improve adherence."

When the user's deeper goal is fitness, appearance, sleep, pain, energy, or another health result, consistency should remain a mechanism or intermediate measure rather than replacing that result.

## Evidence Rules

Prefer evidence that is direct and interpretable for the promised outcome:

- aerobic fitness: a repeatable pace, distance, or submaximal effort benchmark; training volume and wearable trends may support interpretation
- strength: repeated load, reps, or movement benchmarks
- visual physique goals: optional standardized photos or measurements, with explicit user interest and privacy-safe handling
- sleep: the specific dimension the user values, such as duration, timing consistency, awakenings, or morning energy
- symptoms or function: a repeated symptom or capability measure that matters to the user
- biomarkers: a defined baseline and follow-up measurement when the protocol, timing, and collection plan support it

RHR, HRV, recovery, steps, and similar wearable signals may be primary outcomes when the user explicitly cares about them and the protocol and duration make the claim credible. Otherwise they are supporting context. Murph must not turn an available proxy into the headline result by default.

## Timeframe Integrity

The duration must match the promise.

A short run may be appropriate for a fast-moving sleep or symptom outcome. Strength, aerobic performance, body composition, visible physique change, and many lab outcomes often require longer windows or a narrower near-term claim. Protocol evidence should determine the exact duration.

When the available window can only establish feasibility, Murph should say that directly. It may offer a feasibility block only when the user values that answer or when it is clearly presented as the first phase of a longer outcome-oriented plan. It must not imply that completing a two-week behavior block proves meaningful health improvement.

## Option Shape

Each visible option should fit this compact structure:

> **[User-valued result]**
>
> [Intervention] for [credible timeframe]. Murph will compare [primary evidence] and use [supporting evidence, if useful] to help decide whether to keep, change, extend, or stop it.

A brief user-specific rationale may precede the options. Do not repeat the entire intake or turn the orientation into a logging inventory.

End with a value question, such as:

> Which of those results would feel most valuable right now?

Make deferring easy. Do not close by asking to set up a numbered option before the user has expressed a preference. If one targeted repair pass still produces only one credible option, show that option with a defer path and say no second candidate cleared the quality bar; never invent a filler choice.

## Examples

### Running

Weak:

> Daily run floor: five minutes every day for two weeks.

Better when the user wants fitness:

> **Improve your aerobic fitness.** Run through a progressive four-to-six-week block and compare a repeatable pace-at-effort benchmark, completed training volume, and supporting wearable trends. The five-minute floor can be the busy-day fallback during setup.

Better when the user explicitly wants consistency:

> **Make running a stable part of your week.** Build toward three runs per week for four weeks and judge whether the routine survives normal work, travel, and low-energy days. Add a performance benchmark only if the user also wants evidence of early fitness change.

### Strength and appearance

Weak:

> High-protein floor or calisthenics consistency block.

Better:

> **Get stronger and document whether your physique is beginning to change.** Run a protocol-backed strength block long enough for a plausible signal, using repeatable strength benchmarks and optional standardized photos or measurements. Protein and tiny-session fallbacks are setup mechanics, not the outcome.

Do not promise visible transformation when the duration or intervention cannot credibly produce it.

### Sleep

Weak:

> Test whether recovery improves.

Better:

> **Sleep longer and wake more rested.** Test one targeted sleep lever for a protocol-supported window, then compare the relevant sleep measure and a brief morning-energy rating. Recovery and HRV may help explain the result but should not replace the outcome unless the user specifically values them.

## Handoff to Experiment Onboarding

Once the user chooses an option, the selected user-valued outcome and evidence promise become the anchor for experiment setup.

Experiment onboarding may adapt dose, schedule, safety, support, or measurement details. It must not silently replace the chosen outcome with an easier adherence target or convenient proxy. If the selected Health Commons protocol cannot credibly measure the promised result, Murph should clarify the mismatch, choose a better same-family protocol, narrow the promise, or offer a different option before creating the run.

## Success Criteria

1. The user normally sees two or three options framed around results they could genuinely value, with no filler option added to reach a count.
2. Every option names an intervention, credible timeframe, and primary evidence.
3. No option relies only on adherence or a convenient wearable proxy unless the user explicitly chose that result.
4. The proposed duration can plausibly reveal the promised signal, or the copy clearly labels a feasibility phase.
5. The evidence can distinguish a meaningful change from normal variation, or the copy clearly labels the result as exploratory.
6. The final question asks which result matters most and allows deferral without pressure.
7. The chosen outcome survives the handoff into experiment setup and the eventual outcome review.
