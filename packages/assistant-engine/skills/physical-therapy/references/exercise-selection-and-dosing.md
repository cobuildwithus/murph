# Exercise selection and dosing

Use this reference after care level, target activity, baseline, working pattern, stability, and irritability are sufficiently clear.

## Principle

An exercise is not appropriate merely because it is commonly associated with a body part or diagnosis label. Select it because it has a defined role in the current plan, can be performed safely, fits the user's constraints, and produces an interpretable response.

The initial plan is a bounded experiment. It should be small enough that Murph and the user can tell what happened.

## Plan architecture

A first plan usually includes:

1. **Education:** one concise explanation of the working pattern and uncertainty.
2. **Load management:** one clear decision about the provoking task.
3. **Exercise or exposure:** two to four items; five only when each has a distinct necessary role.
4. **Response criteria:** during, later that day, and next morning.
5. **Review point:** number of exposures or date.
6. **Off-ramp:** reasons to stop, revise, or seek care.

Avoid filling every possible category. A plan does not need mobility, strength, balance, and stretching merely for completeness.

## Exercise-selection hierarchy

Apply these filters in order.

### 1. Safety and scope

Exclude items that conflict with:

- red-flag or unresolved safety concerns
- recent surgery, fracture, dislocation, or clinician restrictions
- a suspected tissue rupture or bone stress pattern
- current neurological, vascular, systemic, or inflammatory features
- unsafe environment, fall risk, inability to follow instructions, or required supervision
- exercise-specific contraindications or hard-stop conditions

### 2. Rehabilitation stage

Classify the current need:

- **Settle and preserve movement:** reduce the most provocative dose, maintain safe activity, preserve confidence and tolerable movement.
- **Restore capacity:** build relevant strength, endurance, mobility, coordination, balance, or tolerance.
- **Rebuild the target task:** grade duration, range, load, speed, impact, fatigue, complexity, and environment.
- **Return and self-manage:** restore participation, prepare for flare management, and simplify maintenance.

Use criteria rather than calendar time alone.

### 3. Intervention role

Each selected item should have one primary role:

- symptom modulation
- preserve or restore comfortable movement
- isometric or isotonic capacity
- strength/endurance
- motor control or coordination
- balance/proprioception
- graded exposure
- work/sport/task transfer
- education or self-monitoring

Do not prescribe a movement-fault correction unless the observation is reliable and changing it is actually expected to help the target task.

### 4. Irritability and complexity

For high irritability, favor:

- supported positions
- small ranges
- low load and short exposures
- slower movement
- fewer total repetitions
- longer recovery
- earlier review

For low irritability and good training experience, use a more direct capacity or task-specific stimulus when safe.

### 5. User constraints and preferences

Match:

- available time and realistic frequency
- equipment and space
- home, gym, work, or travel setting
- privacy and accessibility
- confidence and experience
- preferred movement style
- fatigue and competing demands

A theoretically ideal exercise that the user cannot or will not perform is not the best first choice.

### 6. Evidence and catalog quality

Prefer:

- reviewed catalog items with stable IDs
- condition/module-specific evidence when available
- exercise-family evidence when condition-specific evidence is limited
- transparent practice heuristics only when clearly labeled

Do not imply that an exercise is proven to correct a specific tissue defect when the evidence supports only general capacity or symptom improvement.

## Exercise record contract

Use `schemas/exercise.schema.json`. Every active catalog item must include:

- stable ID, semantic version, status, aliases
- body regions, movement patterns, roles, capacities, positions, and task transfer
- equipment, space, support, and supervision requirements
- setup, steps, cues, common compensations
- one or more dose options and the evidence basis for each
- prerequisites, contraindication/caution tags, hard stops, and clearance needs
- acceptable response, same-day regression, next-day regression, and progression criteria
- explicit regression, progression, and substitution relations
- media references
- evidence tier, scope, limitations, source IDs
- evidence-search date, clinical review date, reviewer, and conflicts

Never fabricate a catalog ID. When no item fits, record the gap and use only a simple, reversible description.

## Required user-facing exercise fields

For every exercise or exposure, tell the user:

1. **Purpose:** why this item is in the plan.
2. **Setup:** position, support, equipment, and safe environment.
3. **Steps:** simple execution instructions.
4. **Cues:** one to three cues only.
5. **Dose:** sets, reps/time/distance, effort, rest, and frequency.
6. **Acceptable response:** what familiar symptoms may occur.
7. **Stop/regress:** specific signs and thresholds.
8. **Regression:** an easier alternative.
9. **Progression:** the next step.
10. **Change criterion:** when to keep, progress, or remove it.

Avoid anatomy-heavy explanations that do not help performance.

## Dose selection

There is no universal rehabilitation dose. Choose the lowest dose likely to create useful information or adaptation without causing a disproportionate flare.

### Conservative fallback ranges

Use these only as starting heuristics when no condition/module-specific dose exists and the user is appropriate for self-management.

#### Strength or capacity

- 1–3 sets of 6–15 controlled repetitions
- approximately 2–4 days per week
- effort often in a moderate range, leaving several good repetitions in reserve
- increase resistance, range, or repetitions only after an acceptable response

#### Isometric loading

- 3–5 holds of roughly 15–45 seconds
- moderate effort with adequate rest
- useful when movement is provocative or a controlled entry point is needed
- not automatically analgesic and not appropriate for every condition

#### Mobility or comfortable active movement

- 5–15 controlled repetitions or 20–60 seconds
- daily or near-daily only when it helps and does not provoke a lasting response
- do not prescribe stretching solely because the user reports tightness

#### Balance or motor control

- 2–4 sets of 15–45 seconds or 5–12 controlled repetitions
- use stable support and a low-risk environment
- stop before fatigue materially increases fall risk

#### Graded task exposure

- begin below the known flare threshold
- use intervals, reduced range/load/speed, support, or shorter duration
- separate hard exposures when recovery is uncertain
- progress one dimension at a time

These ranges are not medical clearance and should not override a protocol, condition-specific evidence, or user response.

## Effort prescription

Prefer understandable effort targets:

- “easy and smooth”
- “moderate; you could do about 3–4 more good reps”
- “challenging but controlled; no grinding or breath-holding”

Do not use percentages of one-repetition maximum unless the user has a valid recent measure, the exercise is appropriate, and the context is not acute rehabilitation.

## Symptom-response model

### Acceptable response

Mild familiar symptoms can be acceptable in some stable musculoskeletal presentations when:

- symptom quality and location remain expected
- movement stays controlled
- there is no swelling, instability, neurological, vascular, or systemic change
- the response settles toward baseline
- next-morning function is not meaningfully worse

### Same-session regression

Regress or stop when:

- pain is sharp, electric, spreading, rapidly escalating, or unfamiliar
- movement becomes guarded, unstable, or compensatory
- function drops during the set
- numbness, weakness, dizziness, chest/breathing symptoms, or systemic features appear
- the user feels unsafe

### Later-day and next-day regression

The prior dose was likely too high when:

- symptoms remain clearly elevated about two hours later when that timing is relevant
- sleep is disrupted by a new flare
- the user wakes with worse function, altered gait, swelling, or reduced range
- the flare lasts longer than the agreed recovery window

Reduce one variable at a time. A 20–50% reduction is a practical heuristic after a clear overshoot, not a universal prescription.

## Progression

Progress when:

- the exercise or task has been green for at least two comparable exposures
- the target functional baseline is stable or improving
- technique is controlled enough for the next demand
- no new safety feature appears
- the user can recover before the next planned exposure

Change one major variable:

- range
- load
- repetitions or time
- speed
- support
- balance challenge
- impact
- frequency
- task complexity
- environmental specificity

Use the smallest practical step. A 5–15% increase can sometimes guide volume, but do not treat it as a universal weekly rule.

## Regression and substitution

Regression should preserve the role when possible.

Examples of regression dimensions:

- reduce range
- reduce load
- add hand support
- move from single-limb to bilateral
- slow speed
- reduce impact
- reduce total volume
- shorten lever arm
- use isometric rather than dynamic loading
- perform the same role in a more stable position

Substitute when the item is unsafe, impractical, confusing, disliked, or repeatedly causes a yellow response despite appropriate regression.

## Load management

Do not default to total rest.

### Reduce the aggravating dose precisely

Instead of “stop everything,” change the variable most linked to the flare:

- split duration into shorter bouts
- reduce range, speed, incline, impact, or load
- reduce frequency or consecutive hard days
- substitute a tolerated activity
- change the work setup or task sequence
- add recovery between exposures

### Maintain tolerated activity

Preserve walking, range, conditioning, or adjacent training when it remains green and does not violate safety or clinician restrictions.

### Avoid causal overclaiming

A change in shoes, equipment, posture, technique, or training may be relevant without being the sole cause. Test one reversible change and monitor the same baseline.

## Return to activity

Return is a continuum:

1. **Participation in a modified form**
2. **Return to the target task with restrictions**
3. **Return to the desired volume/intensity/environment**
4. **Maintenance and recurrence management**

Build from controlled to less controlled demands:

- low fatigue to higher fatigue
- simple to reactive
- predictable to variable
- low to higher speed
- low to higher impact
- short to longer duration
- isolated component to full task

Murph can guide graded exposure and track response. Murph cannot issue formal clearance or determine that tissue healing is complete.

## Avoid common failure modes

- long unsorted exercise lists
- passive-only plans
- stretching prescribed solely because the area feels tight
- “activation” exercises kept forever without task progression
- generic strengthening unrelated to the user's goal
- changing multiple variables simultaneously
- using pain reduction during one session as proof of diagnosis
- progressing because a calendar date arrived
- adding exercises instead of revisiting a failed hypothesis
- automatic gait, posture, or technique overhaul without a clear rationale
- assuming more soreness means more benefit

## Plan template

```text
Working explanation:
- [pattern and uncertainty]

Goal and baseline:
- [target task]
- [repeatable measure]

Load decision:
- Reduce/maintain/substitute [specific dose]

Item 1 — [name]
- Purpose:
- Setup and steps:
- Dose:
- Cues:
- Acceptable response:
- Stop/regress if:
- Easier option:
- Progress when/to:

Item 2 — [same fields]

Response rule:
- Green:
- Yellow:
- Red:

Review:
- After [number of comparable exposures/date]
- Report during, later-day, next-morning, and target-task response

Off-ramp:
- [new findings, worsening, or nonresponse that trigger assessment]
```
