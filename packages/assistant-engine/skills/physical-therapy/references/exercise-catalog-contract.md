# Exercise and rehabilitation-module catalog contract

This contract defines the future catalog Murph should use. The catalog must support safe selection, dose, progression, and auditability; it must not be a bag of diagnosis-to-video mappings.

## Design principles

1. **Separate exercise records from rehabilitation modules.** An exercise record explains one movement or exposure. A module explains when and why intervention roles may be selected.
2. **Select by function and capacity.** Goal, irritability, equipment, precautions, experience, and response matter more than a body-part label alone.
3. **Run safety filters before ranking.** Contraindications, clinician restrictions, red flags, and supervision requirements cannot be outweighed by relevance.
4. **Start small.** A module should normally select two to four actions with distinct jobs.
5. **Make every dose reviewable.** Every prescription needs expected response, regression, progression, and reassessment.
6. **Scope the evidence.** Evidence from healthy adults, postoperative care, athletes, older adults, or one body region does not automatically generalize.
7. **Version everything.** Never silently change an instruction already active in a user's plan.
8. **Treat media as optional.** Text must remain complete; videos do not contain the safety logic.
9. **Separate fact sources.** Distinguish clinician-reported restrictions, user reports, observed behavior, and assistant inference.
10. **Do not scrape first and govern later.** Only reviewed content becomes active.

## Data layers

### 1. Canonical exercise or exposure

A stable description of one movement, activity, education action, or graded exposure.

Generic examples:

- supported active range movement
- sit-to-stand from a chair
- supported low step task
- wall-supported balance
- low-load isometric hold
- walking interval
- task-specific reach or carry exposure

### 2. Relationship graph

Explicit links among regressions, progressions, substitutions, and prohibited transitions.

“Harder” is multidimensional. Range, load, support, balance, speed, impact, fatigue, volume, and task specificity may change independently.

### 3. Regional or condition module

Defines scope, inclusion clues, exclusions, must-screen items, plausible alternatives, intervention roles, phase criteria, outcomes, progression, and referral triggers.

### 4. Episode prescription

The user-specific runtime plan. It references exact catalog versions and stores dose, modifications, response criteria, and review date. It does not copy mutable catalog content without provenance.

## Canonical exercise fields

Use `../schemas/exercise.schema.json`.

### Identity and lifecycle

- stable `id`
- semantic `version`
- `status`: draft, active, or deprecated
- replacement link when deprecated
- display name and aliases

Never reuse an ID for a meaningfully different movement.

### Classification

- body regions
- movement patterns
- rehabilitation roles
- target capacities
- task-transfer tags
- positions

These are retrieval tags, not claims about the injured tissue.

### Environment and equipment

- required and optional equipment
- floor and space needs
- support/anchor requirements
- footwear or surface assumptions
- supervision level
- accessibility considerations

### Instructions

- setup
- numbered steps
- one to three high-value cues
- common compensations only when they change safety or demand
- breathing guidance only when relevant
- side-specific instructions

Avoid unexplained anatomy jargon and causal claims.

### Dose options

An item may support:

- repetitions and sets
- hold time
- continuous time
- distance
- work/rest intervals
- rate of perceived effort
- repetitions in reserve

Each dose option must include:

- intended population/context
- starting range rather than fake precision
- rest and frequency
- evidence basis: condition-specific, exercise-family, general-training, or practice heuristic

### Safety and response

- prerequisites
- contraindication tags
- caution tags
- clinician-clearance requirements
- hard-stop conditions
- acceptable response
- same-session regression
- later-day/next-day regression
- progress criteria
- fall-risk and supervision needs

Urgent safety logic must be machine-filterable; do not hide it only in prose.

### Adaptation graph

Each relation includes the dimension changed and the reason.

Dimensions may include:

- range
- external load
- lever length
- base of support
- hand support
- speed
- impact
- volume
- fatigue
- task specificity
- equivalent role

### Evidence and review

- evidence tier
- evidence scope
- source IDs
- summary of what evidence supports
- limitations
- evidence-search date
- clinical-review date and reviewer
- conflicts of interest when material

Distinguish evidence for the exercise family, exact variation, dose, condition, and population.

## Rehabilitation-module fields

Use `../schemas/rehab-protocol.schema.json`.

### Identity and scope

- stable ID and version
- user-facing name that does not overstate diagnosis
- age/population scope
- body regions and common user phrases
- owner and review dates

### Entry and exclusion logic

- inclusion clues
- features against the pattern
- must-screen questions
- emergency and prompt-care triggers
- clinician-directed exclusions
- minimum information needed before a plan

### Outcomes

- meaningful activity examples
- primary baseline options
- supporting outcome signals
- review windows
- criteria for meaningful improvement

Completion or adherence cannot be the only outcome.

### Intervention roles and selection rules

A module requests roles rather than fixed exercise names when several movements can serve the same purpose.

Generic roles:

- provoking-load adjustment
- preserve comfortable movement
- local or regional capacity
- general strength/endurance
- balance or coordination
- graded target-task exposure
- optional symptom-comfort strategy

Selection rules specify:

- minimum and maximum number of items
- mutually exclusive roles
- equipment, supervision, and irritability filters
- when a movement observation is required
- when no exercise should be selected

### Phases and criteria

Use criteria rather than calendar dates alone.

Each phase includes:

- entry criteria
- goals
- permitted roles
- dose constraints
- exit criteria
- regression criteria
- referral triggers

### Uncertainty

Every module states:

- what is supported
- what is plausible but uncertain
- what is not supported
- common myths to avoid
- what requires in-person examination

## Runtime selection algorithm

1. **Safety:** stop for red flags, out-of-scope population, or clinician restrictions.
2. **Goal:** choose one primary meaningful task.
3. **Working pattern:** select a broad pattern and reviewed module only when fit is adequate.
4. **Constraints:** filter by equipment, space, experience, irritability, schedule, balance, accessibility, and preference.
5. **Roles:** select the smallest necessary role set.
6. **Exercises:** retrieve active records that match a role and pass every hard safety filter.
7. **Diversity:** avoid multiple items that duplicate the same role and demand.
8. **Dose:** choose the lowest credible starting dose for the context.
9. **Response:** attach same-session and next-day rules.
10. **Review:** set the exposure count/date and primary outcome.
11. **Provenance:** store exact exercise/module versions.
12. **Gap handling:** if no reviewed item fits, do not fabricate an ID; record a catalog gap.

A relevance model may rank only after hard filters.

## Evidence tiers

Use a simple internal hierarchy while preserving applicability limits.

- `A`: current guideline or strong systematic review directly applicable to the population and outcome
- `B`: multiple trials or one strong trial with reasonable applicability
- `C`: limited trial, observational, or mechanistic evidence
- `D`: expert consensus or established clinical practice with indirect evidence
- `E`: transparent pragmatic starting heuristic or product convention

Do not display the letter grade to users by default. Explain uncertainty in plain language.

## Episode prescription example

```json
{
  "episode_id": "generated-episode-id",
  "created_at": "2026-06-25T14:00:00Z",
  "working_pattern": {
    "label": "stable local load-related presentation",
    "certainty": "tentative",
    "alternatives": ["referred or neurological", "structural injury requiring examination"]
  },
  "goal": {
    "activity": "complete a 30-minute walk at normal pace",
    "baseline": "symptoms alter pace after 12 minutes"
  },
  "module": {
    "id": "reviewed-module-id",
    "version": "1.0.0"
  },
  "prescription": [
    {
      "exercise_id": "reviewed-exercise-id",
      "exercise_version": "1.0.0",
      "role": "capacity",
      "dose": "2 sets of 8, moderate and controlled",
      "modifications": ["use stable hand support"]
    }
  ],
  "load_adjustment": "split the target task into two green exposures",
  "response_rule": "hold or reduce if symptoms escalate, movement changes, or next morning is worse",
  "review_after": "3 comparable exposures",
  "referral_triggers": ["new swelling", "progressive weakness", "worsening despite regression"]
}
```

Do not store the tentative pattern as a confirmed diagnosis.

## Media contract

Each asset includes:

- media ID
- linked exercise ID/version
- framing and view
- duration
- captions/transcript and alt text
- demonstrated equipment/variation
- safety-overlay requirements
- reviewer and review date
- consent, provenance, and licensing

Reject media that conflicts with text, omits required support, demonstrates another variation, lacks accessibility, makes unsupported anatomical claims, or shows unsafe loading.

## Maintenance and deprecation

- Re-review high-risk and condition-specific records at least annually or when material guidance changes.
- Keep prior versions available for audit while active plans reference them.
- Deprecate rather than silently delete.
- Add migration notes explaining whether active users should continue, modify, or stop.
- Separate evidence-search date from content-edit date.
- Require clinical review before AI-generated content becomes active.
- Maintain a rollback path and adverse-event linkage.

## Catalog acceptance tests

Validation fails when:

- an active exercise has no hard-stop conditions
- a module has no triage or referral rules
- a dose lacks context or response criteria
- a relation points to a missing item
- a deprecated item has no explanation
- a module claims diagnosis from chat or video
- evidence has no scope, limitations, or review date
- adherence is the only outcome
- a hard safety tag can be bypassed by ranking
- media and text describe different variations
- a runtime plan references an unknown or deprecated version without migration handling

## Seed strategy

Start with a small, reviewed set organized by capacity family:

- supported active movement
- basic isometrics
- sit-to-stand, squat, hinge, and step families
- pushing, pulling, carrying, and reaching
- supported balance
- walking and interval exposures
- low-impact conditioning substitutions
- task-specific graded exposure primitives

Then add reviewed modules that select from those records. Do not bulk-scrape routines or duplicate instructions across labels.
