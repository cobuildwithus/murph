# Group Challenge Formats and Additive Scorecards

Last verified: 2026-07-29

Status: Proposed, implementation in progress

## Purpose

Murph group challenges should support the social games groups already invent:

- people competing individually;
- teams competing against one another;
- a whole group working toward one shared target;
- one metric or a weighted scorecard composed from several behaviors.

The architecture must stay conversation-first and model-flexible. The model should
understand the room, propose or preserve the rules, interpret consented shared data,
and explain the result. Deterministic code should own only the repetitive parts where
small arithmetic or aggregation mistakes would make the referee untrustworthy.

This is one challenge lifecycle, not separate individual, team, collective, Steps,
protein, run-club, or charity-challenge products.

## Product outcome

A group can naturally ask Murph for games such as:

- a seven-day individual Steps competition;
- two teams competing on a weighted scorecard;
- a run club accumulating distance toward an annual target;
- a scorecard combining Steps, logged protein, and workouts after a fixed local time.

Murph keeps setup conversational, remembers the exact rules, reads only the exact
consented group projections required by those rules, publishes truthful partial
scores when evidence is incomplete, and closes the challenge in the format the group
chose.

## Canonical model

A challenge is the composition of five concerns:

1. **Format**: individual, teams, or collective.
2. **Objective**: ranking or a points target.
3. **Scorecard**: one to five additive components.
4. **Window**: the fixed scoring dates plus any explicit closeout grace period.
5. **Social payoff**: the winner, team result, shared celebration, beneficiary,
   consequence, or meaningful completion the room will experience.

The same participant-level scorecard feeds every format. Metrics never know about
teams, teams never know how a quantity was extracted, and the comedy layer never
owns arithmetic.

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

Collective challenges require a target because their core question is how far the
group has moved toward something together. Individual and team formats may rank
competitors or race toward a target.

### Teams

A team has a stable id, a room-facing name, participant ids, and an optional captain.
The captain is a social role only. A captain cannot opt another person into a
challenge, grant their data, or change their sharing choices.

```ts
type GroupChallengeTeam = {
  id: string;
  name: string;
  participantIds: string[];
  captainParticipantId?: string;
};
```

A participant may belong to at most one team. Team membership is frozen when the
challenge starts. A later change is an explicit dated ruling that applies
prospectively and never rewrites an already published result.

Use `sum` for equally sized teams and naturally additive games. Use `average` when
team sizes differ and a per-person comparison is the intended game. An average is
not final or comparison-safe while any included participant has incomplete scoring
evidence.

## Additive scorecards

A scorecard contains one to five components. Five is a hard product bound, not a
suggested setup target. Most games should stay at one to three components; the extra
room exists for groups that genuinely want a broader game.

Each component records:

- a stable id and room-facing label;
- the exact Vault Share projection scope or scopes it needs;
- one human-readable evaluation rule explaining how the model derives a
  non-negative integer quantity from those records;
- the canonical quantity unit used for arithmetic;
- a non-negative integer points rate;
- an optional component cap.

```ts
type GroupChallengeScorecardComponent = {
  id: string;
  label: string;
  quantityUnit: string;
  evaluationRule: string;
  projectionScopes: HostedVaultShareSelectableProjectionScope[];
  points: number;
  perQuantity: number;
  maxPoints?: number;
};
```

The model owns `evaluationRule`. This deliberately avoids encoding every useful
health-data question into a brittle metric-specific tool or formula language. For
example, the model may define a component quantity as:

- total Steps in the challenge window;
- total logged protein grams on complete logged days;
- the number of settled workouts whose local start time is after 9 PM;
- the number of days that met an agreed threshold;
- baseline-adjusted improvement normalized to integer basis points.

The rule must remain inspectable, reproducible from the exact shared records, and
frozen before scoring begins. If the rule cannot be evaluated reliably from an
available projection, Murph says that it is unsupported instead of inventing data.

The arithmetic layer receives only the normalized integer quantity and applies:

```ts
componentPoints = floor(quantity * points / perQuantity);
```

Then it applies `maxPoints` when configured. Internally this calculation uses exact
integer arithmetic so repeated runs cannot drift due to floating point behavior.
All components are additive and non-negative in v1.

### Why the model owns interpretation

Models will continue improving at understanding natural rules and structured data.
Murph should benefit from that rather than forcing every future challenge idea
through a growing enum of metric adapters.

The model therefore owns:

- inferring or proposing the game from the conversation;
- choosing the narrowest exact projection scopes;
- explaining and freezing each evaluation rule;
- converting the authorized records into a normalized component quantity;
- judging whether a proposed scorecard is socially coherent and fairly balanced;
- composing the update in the room's register.

Deterministic code owns:

- validating ids, bounds, team membership, and integer inputs;
- applying point rates and caps;
- adding component points;
- team and collective aggregation;
- coverage summaries;
- target progress and remaining points;
- stable, testable output shapes.

It does not read health data, choose metrics, define rules, schedule messages, store
challenge state, or decide what to say.

## Point-balance preview

Before kickoff, Murph should preview the practical effect of proposed weights using
one ordinary reference day or week. It need not optimize the weights or present a
spreadsheet. It should simply expose when one component is likely to dominate.

For example, when a representative day makes one component worth materially more
than all other components combined, Murph says so and asks whether the room wants
that intentionally. The group can keep an intentionally lopsided game.

Optional caps are encouraged when an uncapped "more is always better" rule could
create a bad exercise, nutrition, sleep, or recovery incentive. Caps are game
mechanics, not health prescriptions.

## Evidence contract

These states remain distinct for every participant and component:

- **available**: an authorized quantity can be computed from current eligible data;
- **pending**: relevant data exists but its producer-owned completion rule has not
  settled it yet;
- **missing**: the exact share is granted but no usable current record is available;
- **not_granted**: the participant has not shared the exact required scope;
- **observed zero**: available evidence proves a real zero quantity.

A missing or pending component never becomes a measured zero. Because point rates
are non-negative, the sum of available components is a verified lower-bound score,
not necessarily the participant's final score.

Every update reports aggregate coverage alongside the scoreboard. Team and
collective coverage derives from participant-component coverage; aggregation never
hides a missing person or component.

Nutrient components use labels such as "logged protein" because the current
projection represents complete logged meal totals, not verified consumption.

## Sharing and reads

The challenge uses the existing `murph.group action="read_shared"` authority. It
requests the deduplicated exact scoring scopes needed by the scorecard, never a broad
health-data bundle.

The target contract supports up to five distinct scoring scopes in one coherent
read. The initial implementation may land in stages while the existing hosted read
limit is raised from three to five. Until the runtime and parser limits move
together, a five-component scorecard must fit within the currently supported number
of distinct scopes; multiple components may legitimately reuse one scope.

The permission order remains unchanged:

1. Read all scoring scopes first.
2. If a scoring scope is `not_granted`, preserve that read as the current permission
   evidence and offer only exact eligible scoring scopes.
3. Only when scoring grants exist but usable data is genuinely missing may Murph run
   a separate diagnostic-only read for `device-sync-status.v0`.
4. A diagnostic read never explains the missing health quantity; it exposes only
   its literal bounded connection-status facts.

## Durable ownership

The existing group challenge knowledge page remains the sole durable challenge
owner. Do not add a Prisma challenge table, Web scoring service, or second state
system.

The page keeps:

- **Format & objective**
- **Scorecard & exact rules**
- **Window & publishing cadence**
- **Roster & teams**
- **Sharing choices**
- **Baselines**, only for components that use them
- **Stakes or shared payoff**
- **Canon and comedy bank**
- **Sent log**
- **Scoreboard snapshots**
- **Confounders and protected notes**

Rules are frozen at kickoff. An amendment is a dated revision that applies
prospectively. Murph never silently changes weights, thresholds, team membership, or
rounding after seeing the standings.

## Scheduling

Use one automation per challenge. It may settle data daily while publishing less
often:

- short friend challenges usually publish daily;
- long-running club or charity targets usually publish weekly and on meaningful
  milestones;
- an ordinary settlement run may finish without a group reply.

Do not create separate capture and publishing schedulers. The existing challenge
page stores the durable cumulative result required when the Vault Share source window
rolls forward.

## Social behavior

The social payoff varies by format:

- **Individual**: winner, loser, placement, or participant target.
- **Teams**: team result, captaincy, rivalries, and team-owned stakes.
- **Collective**: shared progress, milestones, celebration, beneficiary, or the
  meaning of completing the goal.

A cooperative challenge never manufactures an individual loser. Murph does not
blame the least-active participant when a collective target is missed. Team comedy
starts with team identity, claims, captains, and swings in the aggregate before
singling out a participant.

## V1 boundaries

V1 intentionally does not include:

- arbitrary code or a general expression language;
- multiplicative or negative components;
- cross-component bonuses;
- more than five components;
- model-hidden scoring rules;
- a new challenge database or Web scoring endpoint;
- a separate implementation per format;
- automatic migration of an active legacy challenge;
- self-reported contribution events.

Self-reported contributions are a later evidence adapter. They must be attributable,
append-only, correctable through superseding entries, and never silently added on
top of automatic data.

## Migration

1. Land this product contract and the pure scorecard arithmetic/aggregation helper.
2. Teach the group-challenge skill to persist format, objective, and one-to-five
   component scorecards while preserving room-native formation.
3. Raise the operation-local shared-read scope limit from three to five across the
   contract, parser, runtime adapter, tool schema, and focused tests.
4. Use the helper from a small local scoring seam after the model has normalized
   component quantities; do not move metric interpretation into that seam.
5. Generalize diagnostics from participant-by-one-metric to
   participant-by-component coverage.
6. Generalize the comedy and closeout rules for team and collective formats.
7. Prove long-running cumulative settlement before marketing annual targets.
8. Leave existing active challenge pages on their current one-metric rules. New
   challenges use the new format; legacy behavior can be deleted after no live page
   depends on it.

## Acceptance cases

- A scorecard accepts one through five unique additive components and rejects six.
- The same scorecard can produce individual, team, and collective scoreboards.
- A Steps, logged-protein, and after-9-PM-workout scorecard computes exact repeatable
  integer points without metric-specific arithmetic code.
- A missing protein component leaves the participant's verified lower-bound points
  intact and labels coverage partial.
- An observed zero earns zero points and remains available evidence.
- Team sum remains a verified subtotal when evidence is partial.
- Team average is not presented as comparison-safe until every included participant
  has complete component coverage.
- Collective target progress reports verified points, remaining points, and coverage.
- A captain cannot opt in teammates or authorize their data.
- A rules amendment is explicit, revisioned, and prospective.
- One component may reuse another component's exact scope without requesting the
  permission twice.
- A sixth distinct scoring scope is impossible because the component bound is five.
- A scoring-grant miss is handled before any diagnostic read replaces its evidence.
- Cooperative closeout never invents an individual loser.
