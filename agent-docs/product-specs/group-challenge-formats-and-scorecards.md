# Group Challenge Formats and Additive Scorecards

Last verified: 2026-08-09

Status: Implemented for new group challenges

## Outcome

Murph can run one challenge lifecycle across the social formats groups already use:

- people competing individually;
- teams competing against one another;
- a whole group working toward one shared target;
- one metric or a weighted scorecard composed from several behaviors.

A scorecard may contain one to five additive components. The model understands the
room, preserves or proposes the rules, interprets exact consented shared records, and
explains the result. Deterministic code owns only bounded validation, arithmetic,
coverage, and aggregation.

This is not a separate product for teams, run clubs, charity goals, protein games, or
multi-metric challenges. Every format reuses the existing challenge knowledge page,
one challenge automation, the hosted group shared-read boundary, and the same scoring
primitive.

## Canonical composition

A challenge combines five concerns:

1. **Format** — `individual`, `teams`, or `collective`.
2. **Objective** — a ranking or a positive integer points target.
3. **Scorecard** — one to five ordered additive components.
4. **Window** — fixed scoring dates, settlement mode, closeout grace, and publishing
   cadence.
5. **Social payoff** — a winner, team result, shared celebration, beneficiary,
   consequence, or meaningful completion the room will experience.

The participant-level scorecard is the common seam. Components do not know about
teams, teams do not know how a quantity was derived, and the comedy layer never owns
arithmetic.

### Formats

```ts
type GroupChallengeObjective =
  | { kind: "ranking" }
  | { kind: "target"; targetPoints: number };

type GroupChallengeFormat =
  | {
      kind: "individual";
      objective: GroupChallengeObjective;
    }
  | {
      kind: "teams";
      aggregation: "sum" | "average";
      objective: GroupChallengeObjective;
      teams: GroupChallengeTeam[];
    }
  | {
      kind: "collective";
      objective: { kind: "target"; targetPoints: number };
    };
```

Collective games require a target because their core question is how far the group
has moved toward something together. Individual and team games may rank competitors
or race toward a target.

### Teams

A team has a stable id, a room-facing name, participant ids, and an optional captain.
The captain is a social role only. A captain cannot opt another person in, grant their
data, or change their sharing choices.

Every opted-in participant belongs to exactly one team. Team membership is frozen at
kickoff. A later move is an explicit dated ruling that applies prospectively and never
rewrites an already published result.

Use `sum` for equal teams and naturally additive games. Use `average` only when
unequal team sizes make per-person scoring the intended comparison. A team sum with
incomplete evidence is labeled a verified subtotal. A team average is withheld until
every included participant has complete component coverage.

## Additive scorecards

A scorecard contains one to five components. Five is a hard product bound, not the
recommended default; most games should use one to three.

Each component freezes:

- a stable kebab-case id and room-facing label;
- the exact Vault Share projection scope or scopes it needs;
- one inspectable evaluation rule for deriving a non-negative integer quantity;
- the integer quantity unit;
- positive integer `points` and `perQuantity`;
- an optional non-negative component cap;
- `window-total` or `daily-additive` settlement.

```ts
type PersistedGroupChallengeComponentRule = {
  id: string;
  label: string;
  quantityUnit: string;
  evaluationRule: string;
  projectionScopes: HostedVaultShareSelectableProjectionScope[];
  points: number;
  perQuantity: number;
  maxPoints?: number;
  settlementMode: "window-total" | "daily-additive";
};
```

The deterministic `score-challenge` payload projects this page-owned rule down to
`id`, `label`, `quantityUnit`, `points`, `perQuantity`, and optional `maxPoints`.
Projection scopes, `evaluationRule`, and `settlementMode` remain on the challenge page
and never cross the arithmetic boundary.

The model owns `evaluationRule`. Useful quantities include total Steps, logged protein
grams on complete logged days, qualifying workouts after a frozen local-time
threshold, days meeting a threshold, total distance in integer meters, or
baseline-adjusted change normalized to integer basis points.

The rule must be reproducible from the named authorized records and frozen before
scoring begins. Murph says a rule is unsupported when the available projection cannot
evaluate it reliably.

The arithmetic contract is:

```text
component points = min(optional cap, floor(quantity × points / perQuantity))
participant points = sum(component points)
```

The implementation uses exact `BigInt` arithmetic internally, applies caps before
converting back to numbers, rejects unsafe integer results, and never uses floating
point scoring. Decimal source values are normalized to an explicit integer base unit
before crossing the arithmetic boundary.

V1 intentionally has no arbitrary code, general expression language, negative
points, multipliers, nested formulas, or cross-component bonuses.

## Model and code ownership

The model owns:

- inferring or proposing the game from conversation;
- preserving explicit human rules;
- choosing the narrowest exact projection scopes;
- writing and freezing evaluation rules;
- converting authorized records into normalized component quantities;
- previewing whether one proposed weight will dominate;
- adjudicating ambiguities and composing the room-facing update.

Deterministic code owns:

- strict input schemas and one-to-five component bounds;
- stable ids, team membership, and explicit observation validation;
- exact point rates, caps, and participant totals;
- individual, team, and collective aggregation;
- complete, partial, and unscored coverage summaries;
- target progress and remaining points;
- stable output shapes.

It does not read health data, choose a metric, infer a rule, schedule a message, write
challenge state, or decide what to say.

## Evidence contract

Every participant-component observation is exactly one of:

- `available` with a non-negative integer quantity;
- `pending` because producer-owned completion has not settled it;
- `missing` because the exact share is granted but current usable data is absent;
- `not_granted` because the exact required group share is absent.

Observed zero is `available` with quantity `0`. Missing, pending, and not-granted
components never become measured zeroes. Because every rate is non-negative, the sum
of available components is a verified lower-bound score when coverage is incomplete.

Nutrient components use labels such as “logged protein” because those projections
represent complete logged meal totals, not verified consumption.

## Bounded shared reads

The hosted shared-read limit remains deliberately small. A challenge deduplicates its
exact scoring scopes in component order and splits them into stable batches of at
most `ASSISTANT_HOSTED_GROUP_SHARED_READ_MAX_PROJECTION_SCOPES` scopes, currently
three.

Five components therefore do not require a wider hosted transport. Components may
reuse a scope, and several bounded reads may feed one scorecard.

The required sequence is:

1. Start the model turn and read the first scoring batch only.
2. When that read proves a `not_granted` participant/scope that still needs a new
   eligible permission offer, handle the exact offer from that evidence and stop before
   another shared read. The latest read remains the only permission evidence.
3. When every `not_granted` participant/scope in the batch already has an explicit
   decline or handled offer action, retain `not_granted` as normalized partial coverage
   and continue; no later action depends on that read's offer evidence.
4. Otherwise retain only normalized component evidence and read the next batch.
5. Require every successful batch to return the same ordered current
   `participantId` set. A changed membership snapshot cannot be combined; the run is
   unverified and publishes no standings.
6. Only after all scoring batches have been read and no new permission offer is owed may
   a separate diagnostic-only `device-sync-status.v0` read investigate genuinely
   missing data.

This preserves the existing privacy, authority, and result-size boundary. Raw
vault-share files and private 1:1 data are never alternate scoring paths.

## Deterministic CLI seam

After all scoring batches agree on the roster, the model creates one explicit
observation per opted-in participant and component. Only normalized statuses and
integer quantities cross the arithmetic boundary—never raw shared records, provider
payloads, handles, names, or unnecessary dates.

The command is:

```sh
vault-cli knowledge score-challenge --input @<temporary-json-path> --format json
```

Its JSON input contains exactly `format`, `scorecard`, and `participants`. The command
validates and returns a `GroupChallengeScoreResult`; it does not read the vault or
write the challenge page. The assistant removes the temporary input and persists the
result on the existing challenge page in the same turn.

A command failure is an invalid normalized input or ruling. Murph fixes that input
instead of silently falling back to model arithmetic.

When a requested Linq group update is eligible for the native standings card, the
attachment tool accepts only the challenge-page slug and normalized observations,
rather than accepting a model-authored definition or scoreboard. The host reads the
closed definition from that typed challenge page, derives the complete scorer input
and component scopes, requires every successful batch to share the same ordered
current-room-member and authorized-label roster, requires exact observations for
every page participant in state `in`, verifies that every definition scope was read,
runs the scorer, and compare-and-set persists the exact page-derived input and result
before attaching. Card participants, format, objective, teams, rates, caps, units,
points, target, order, coverage, counts, ranks, and ties therefore cannot drift from
the page at the irreversible effect boundary. The model still owns authorized record
interpretation; the trusted host owns definition authority, read proof, arithmetic,
and canonical persistence.

## Durable ownership

The existing group challenge knowledge page is the sole durable owner. There is no
Prisma challenge entity, Web scoring service, parallel score file, or second
scheduler.

The page keeps:

- **Format & objective**
- **Scorecard & exact rules**, including scopes, units, rates, caps, settlement modes,
  rounding, and `rulesRevision`
- **Window & publishing cadence**
- **Roster & teams**
- **Sharing choices**
- **Baselines**, only where a component needs one
- **Cumulative settlement**, only for long-running daily-additive components
- **Stakes or shared payoff**
- **Canon, comedy bank, sent log, and protected notes**
- **Scoreboard snapshots**, including coverage and the deterministic result

Managed state changes use `knowledge upsert`; append-only social facts may use
`append-section`. Rules, weights, caps, thresholds, teams, settlement mode, and
`rulesRevision` never change silently after results are visible.

New challenge pages that may emit native standings use `pageType: challenge` and
exactly one closed definition section:

````md
<!-- murph:group-challenge-definition:v1:start -->
## Challenge definition

```json
{
  "version": 1,
  "rulesRevision": 1,
  "format": { "kind": "individual", "objective": { "kind": "ranking" } },
  "participants": [
    { "participantId": "participant_example", "state": "in" }
  ],
  "scorecard": {
    "components": [
      {
        "id": "steps",
        "label": "Steps",
        "quantityUnit": "steps",
        "evaluationRule": "Sum settled shared steps in the challenge window.",
        "projectionScopeKeys": ["steps-days.v0"],
        "points": 3,
        "perQuantity": 100,
        "settlementMode": "window-total"
      }
    ]
  }
}
```
<!-- murph:group-challenge-definition:v1:end -->
````

The JSON is closed and bounded: one to five components, one to three exact scopes per
component, positive integer rates, optional non-negative caps, a positive integer
`rulesRevision`, and participation states `in`, `pending`, `declined`, or
`withdrawn`. A malformed, duplicate, missing, generic-page, or legacy unstructured
definition is ordinary-text-only. Attachment never creates or repairs this section.

## Long-running cumulative settlement

A short `window-total` component may be recomputed from the current shared window. A
challenge that can outlive that window is production-safe only when every
long-running component is `daily-additive`, or its source exposes the entire challenge
history.

For each participant and daily-additive component, the page stores compact state:

```json
{
  "rulesRevision": 1,
  "settledThroughDate": "2026-07-28",
  "cumulativeQuantity": 12345,
  "skippedDates": []
}
```

Every daily automation run:

1. Reads the page before shared data.
2. Considers only producer-settled dates after the watermark and inside the frozen
   challenge window.
3. Adds each date at most once and in order. An observed zero advances the watermark.
4. Does not advance across absent or pending dates. A permanently unavailable date
   enters `skippedDates` only through an explicit dated ruling; skip never means zero.
5. Upserts the cumulative quantities and watermark before publishing or finishing
   without reply.
6. Feeds cumulative quantities—not the rolling source subtotal—to
   `score-challenge`.

The first settled value for a date owns the published challenge ruling. Later imports
may be noted as context but do not silently rewrite history. A missed run whose source
dates have already rolled out is unverified rather than reconstructed from memory.

This bounded watermark state supports annual automatic goals without retaining an
unbounded daily ledger or creating another persistence system.

## Scheduling and presentation

Each challenge uses one automation. A long-running challenge may settle daily while
publishing weekly and at meaningful milestones. An ordinary settlement run may finish
without a group reply. Capture and publishing never become separate schedulers.

Presentation follows format:

- **Individual** — placement, participant targets, and agreed individual stakes.
- **Teams** — the team result first; captains, names, rivalries, and aggregate swings
  supply the social material.
- **Collective** — verified progress, completeness, remaining points, pace or next
  milestone, and the shared celebration or beneficiary.

A cooperative challenge never invents an individual loser or turns the least-active
member into the price of missing the target.

## Compatibility and rollout

Existing active one-metric challenge pages continue under their frozen rules and
ordinary-text presentation. New challenges use the typed page and closed definition
contract before native cards are eligible. A legacy page is migrated only through an
explicit prospective rules revision; past published snapshots are never rewritten.

The static root system prompt is unchanged. `group-challenge-scorecards` is an
on-demand companion skill loaded for teams, targets, multiple metrics, weighted
points, or long-running cumulative games.

## Acceptance cases

- One through five unique additive components are accepted; six are rejected.
- The same participant scorecard produces individual, team, and collective outputs.
- Steps, logged protein, and workouts after a local-time threshold score without
  metric-specific arithmetic code.
- Missing protein preserves verified lower-bound points and partial coverage.
- Observed zero earns zero points while remaining available evidence.
- Team sum exposes a verified subtotal; team average waits for complete coverage.
- Collective progress reports verified points, remaining points, target status, and
  coverage.
- A captain cannot opt in teammates or authorize their data.
- Five distinct scopes compose through bounded reads without widening the transport.
- A `not_granted` batch stops before a later read can replace its offer evidence.
- Batches with different ordered participant sets are never combined.
- A native card requires one typed page with a valid closed definition, at least one
  successful read, exact observations for all page-owned `in` participants, those
  participants present in the stable current-room read, definition-owned scopes
  backed by those reads, and canonical snapshot persistence before attachment.
  Additional current room members never become challenge participants.
- Only normalized quantities and statuses reach deterministic scoring.
- Daily-additive settlement cannot count a settled date twice.
- Missing or pending dates do not advance the cumulative watermark.
- Cooperative closeout never manufactures an individual loser.
