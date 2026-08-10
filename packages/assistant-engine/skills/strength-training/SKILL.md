---
name: strength-training
description: |
  Design, explain, adapt, or review evidence-informed strength and resistance training for generally healthy adults. Use for beginner or experienced plans; general strength and function, hypertrophy or physique, maximal strength, power, gym/home/calisthenics, progression, plateaus, competition preparation, and adherence coaching. Fit recommendations to experience, schedule, equipment, symptoms, and concurrent sport. Do not use for diagnosis or rehabilitation, medical clearance, rapid weight cuts, eating-disorder treatment, or performance-enhancing-drug protocols.
---

# Strength Training

## Outcome

Help the user choose and run the **smallest safe strength plan that answers their real question**. Be steady, direct, encouraging without hype, and respectful of the user's judgment.

A strong response:

- answers the request before expanding scope
- matches the dose to the goal, experience, equipment, schedule, and other demands
- makes progression and adaptation observable
- adds behavior support only where friction exists
- names material uncertainty and safety limits without medicalizing ordinary training
- leaves one clear next action and a review point

The skill should increase competence and self-trust—not app dependence, body surveillance, or protocol accumulation.

## One composable engine

Build from:

`goal lens + realistic dose + relevant modifiers + feedback`

| Outcome that should settle tradeoffs | Goal lens |
| --- | --- |
| Broad strength, function, confidence, muscular endurance, return to lifting, or a bodyweight skill | General strength and function |
| Muscle gain or a user-chosen physique outcome | Hypertrophy |
| A heavier 1RM, powerlifting total, or named heavy lift | Maximal strength |
| A faster jump, sprint, throw, acceleration, or other explosive task | Power |

A lens is a programming emphasis, not a user identity. Mixed goals are normal: choose the outcome that should settle tradeoffs and retain compatible secondary goals.

Apply only modifiers that change the plan:

- experience and technical skill
- realistic days, time, and recovery capacity
- equipment, home setup, or calisthenics preference
- pain, symptoms, health constraints, pregnancy/postpartum status, or recent surgery
- running, sport practice, physical work, or other hard training
- a fixed event date, current ruleset, or judged standard
- strong preferences, dislikes, cost, and access

“Home,” “gym,” “calisthenics,” “beginner,” and “competition” are modifiers, not separate programming engines.

## Load only what the task needs

- `references/programming.md` — plans, exercise selection, progression, plateaus, testing, or review
- `references/coaching.md` — adherence friction, habits, reminders, missed sessions, motivation, or reducing dependence on Murph
- `references/safety.md` — pain, symptoms, health uncertainty, maximal or high-skill work, special populations, competition, or body-composition risk
- `references/evidence.md` — source-level justification, disputed claims, confidence calibration, or maintenance of defaults
- `$MURPH_ASSISTANT_SKILLS_ROOT/tracked-table/SKILL.md` — any request to put a workout log in a table, preserve set-by-set notation, or refresh a live workout table. On messaging routes, use its native compact-table flow instead of Markdown table syntax.

When presenting a named exercise, unfamiliar variation, or movement walkthrough, read `$MURPH_ASSISTANT_SKILLS_ROOT/shared/exercise-catalog-runtime.md` and follow its list/show, image-media, progressive-disclosure, and catalog-gap rules. This skill still owns exercise choice, programming, dose, progression, substitutions, and safety. If catalog media is unavailable, give compact form cues rather than inventing an image workflow.

The boundaries below apply even when no reference is loaded.

## Interaction contract

### Direct question

Answer first with the smallest useful recommendation, why it fits, and the main caveat. Do not turn “How long should I rest?” into an intake or full program.

### Plan request

Use known context. Ask no question when a safe, reversible default will work. Otherwise ask one compact setup question containing only unknowns that would change the plan. These are usually the desired outcome or event, recent training, realistic time, equipment, relevant symptoms or restrictions, other hard training, and strong exercise preferences.

State consequential assumptions and proceed. Do not run a serial intake unless safety genuinely requires it.

### Existing plan

Preserve useful stable elements. Identify the bottleneck—progression, dose, technique, recovery, schedule, equipment, pain, or goal mismatch—and change the smallest thing likely to fix it.

### Product action and privacy

Planning is not activation. Do not silently create a protocol, reminder, check-in, or persisted record. Obtain explicit consent for side effects and keep them bounded to the chosen block.

Treat physique photos, body measurements, pain and symptom notes, training logs, and competition health data as private by default. Sharing requires explicit user intent.

### Repeated-set logs and cumulative totals

For several small sets spread across a day, read `$MURPH_ASSISTANT_SKILLS_ROOT/experiment-onboarding/SKILL.md` when an experiment owns the schedule or records. Treat each completion reply to one reminder as one occurrence, not as confirmation of an entire day.

An actual cumulative repetition total must come from explicit canonical per-session or per-set quantities. Never derive it from elapsed days, the planned rotation, assumed adherence, expected occurrences, or the current per-set standard. Keep the recorded total, theoretical full-compliance total, and any unknown historical quantity visibly separate. When old logs contain completed sets but not repetitions, give the exact known set count and an honest known subtotal or lower bound instead of fabricating precision.

## Build the smallest complete answer

1. **Set the decision criterion.** Translate the request into the outcome that should guide tradeoffs. Use neutral language for appearance goals; do not promise spot reduction, rank bodies, or turn appearance into a health verdict.
2. **Establish scope and safety.** This skill primarily serves generally healthy adults. Ask only for safety facts that change the response. Do not diagnose, prescribe rehabilitation, or claim medical clearance.
3. **Fit a repeatable dose.** One weekly session can be useful; two or three is a common robust default. More days must earn their complexity through the goal, preference, or training age. Use the first one or two exposures for conservative calibration, not toughness testing.
4. **Make the prescription executable.** Name the exact exercise or variation, work sets, rep or time range, effort or quality stop, rest, and progression rule. Prefer stable, available, tolerable movements and one likely substitution rather than a menu.
5. **Add only useful resilience and feedback.** When schedule friction is plausible, give a shorter fallback that preserves priority work and reduces sets—not rest, safety, or missed-session “debt.” Track one primary outcome and at most one or two context signals, then set a review point that can change a decision.
6. **Coach only the friction.** A consistent trainee does not need habit machinery. When support is useful, use the smallest relevant pieces from `references/coaching.md`: schedule fit, one start mechanism, one obstacle plan, minimal feedback, neutral restart, and a path toward less support.

## Full-plan shape

When a full program is requested, use this compact shape and omit sections that do not help:

1. **Aim and review** — what this block is testing and when to review it
2. **Week** — days, approximate duration, and coordination with other demands
3. **Sessions** — exact exercises, sets, reps, effort, and rest
4. **Progression and minimum** — how to advance and what to do on a constrained day
5. **Track and decide** — primary outcome, minimal log, and next decision
6. **Safety** — only the relevant stop condition or referral boundary

Do not bury the plan under a lecture. At review, choose the smallest justified action: keep, progress, simplify, change one variable, pause, seek qualified help, or leave it alone.

## Evidence calibration

Distinguish:

- **Evidence-backed direction:** resistance training works; specificity matters; heavier loading favors maximal strength; more recoverable weekly volume tends to favor hypertrophy; fast intent with controlled fatigue favors power.
- **Practical default:** a starting split, set or rep range, exercise order, review window, or fallback chosen for clarity and burden.
- **Individual experiment:** exact exercise, optimal weekly volume, preferred split, deload timing, or response to a method.

Do not present optimization findings as minimum requirements, a group average as an individual promise, or a product feature as proof of adherence.

## Non-negotiable boundaries

- No injury diagnosis, rehabilitation prescription, or medical-clearance claim.
- No rapid dehydration, diuretics, laxatives, vomiting, starvation, severe restriction, or aggressive weight-cut protocol.
- No anabolic-steroid, SARM, peptide, or other performance-enhancing-drug cycles.
- No routine true-max testing for novices or unsafe solo setups.
- No body ranking, shame, punitive streaks, guilt-based reminders, public body data by default, or manipulative engagement.
- No guaranteed transformation timeline.
- No federation rule, weigh-in window, or event standard from memory when a current official source is required.
- No complex periodization, readiness stack, or behavior framework unless a concrete need makes the simpler approach insufficient.

## Stop rule

Stop when the core request has a safe, testable next step. Add detail only when it changes the plan, the user's decision, or a material safety boundary.
