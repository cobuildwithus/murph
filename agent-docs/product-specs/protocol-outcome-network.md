# Protocol Outcome Network

Last verified: 2026-07-16

## Current State

Murph already has the two ends of the loop: public protocol knowledge and private experiment runs. Current code supports private outcome analysis and outcome-card copy. Sharing artifacts, contribution records, cohort summaries, and friend digests are target-state surfaces that still need product and implementation contracts before they are treated as shipped behavior.

## Product Thesis

Murph starts as the easiest chat-first way to run personal health experiments.

The intended compounding layer is a protocol outcome network:

`exact protocol version -> private run -> completed outcome card -> opt-in contribution -> cohort learning -> next protocol discovery`

The assistant is the interface into this loop, not the full category by itself.

## Product Boundary

- Private run data is the default and remains user-owned.
- A completed private outcome card is derived from one private run plus its exact protocol ref, measurement window, and confidence metadata.
- Public Health Commons learning must come from explicit future contributions, not silent default sharing.
- The first social object is the completed outcome card, not a biomarker leaderboard, profile score, or infinite feed.
- Murph compares interventions and outcomes, not bodies in the abstract.

## Implemented Now

- The canonical experiment outcome writer saves one version-bound outcome with biomarker deltas, confidence, caveats, confounders, protocol references, and analysis windows.
- The encrypted browser-vault replica dereferences only the validated `outcomeRef` on a canonical experiment. Experiment detail renders that saved outcome verbatim instead of rebuilding a second conclusion from its rolling metric rows.
- Experiment detail keeps a stable **Your results** route for the matching active run or newest completed run. A completed run with no saved outcome is shown as pending; an invalid, missing, or mismatched reference is unavailable and fails closed without hiding the run.
- Canonical early stops are stored as `status: completed` with an `endedOn` before the planned intervention end. Browser Results presents those runs as stopped, clamps evidence to `endedOn`, and never shows a completed conclusion.
- CLI and web surfaces keep those results private by default.
- Consent scopes reserve space for future Health Commons contribution, but there is not yet a shipped share/contribute/cohort pipeline.

## Canonical Objects

| Product concept | Rule |
| --- | --- |
| Private run | Version-bound record of one user's experiment |
| Outcome card | Concise result summary with deltas, confounders, and confidence |
| Share artifact | Target-state rendered or viewed form of an outcome card for friends, export, or later public contribution |
| Contribution record | Target-state permissioned normalized summary sent into public cohort learning |
| Cohort summary | Target-state aggregate outcome block shown on protocol or biomarker pages |
| Protocol variant diff | Structured fork from a parent protocol with explicit changed fields |
| Friend digest | Bounded pull surface that highlights a small number of relevant results |

## Sharing Levels

Murph should eventually support a clear ladder of sharing, from safest to most public:

1. **Private self-comparison** is the default.
2. **Anonymous cohort contribution** lets a user add a normalized result to public learning without exposing raw identity.
3. **Selected-friend sharing** lets a user expose a chosen display name or relationship-scoped identity to specific people.

Public-by-default identity is out of bounds. If a result becomes part of the commons, it should do so as an explicit contribution with privacy boundaries that are clear to the user.

## Trust And Verification

Murph should avoid false certainty. It should not claim that it proved a protocol caused an outcome when the evidence is mixed.

Useful trust labels include:

- `self-reported`
- `device-connected`
- `protocol-adherent`
- `baseline-controlled`
- `confounder-noted`
- `cohort-replicated`

Outcome cards, and future cohort summaries, should use confidence language such as `low`, `medium`, or `high`, plus plain-language notes about confounders or missing context when relevant.

## Ranking And Social Rules

- Rank protocols, protocol variants, contribution quality, and outcome confidence before ranking people.
- No raw biomarker leaderboards by default.
- No infinite feed by default; prefer weekly digests, cohort views, and deliberate pull surfaces.
- No shame mechanics, purity framing, or "best body wins" status loops.
- If ranking ever exists, it should reward useful learning, replication, and helpful contributions rather than raw biomarker superiority.

## Protocol Revision And Fork Rules

- Every outcome card and contribution must stay tied to `commonsProtocolRef.key`, `pageRevisionId`, `runSpecRevisionId`, and the selected `testPlanId` when available; private `protocolRef` is an optional adaptation pointer, not the public comparison key.
- If a protocol changes in a way that affects the runnable behavior, the network object must change with it through a new `runSpecRevisionId`.
- Community forks should be expressed as structured diffs with changed fields such as frequency, modality, duration, timing, or dose rather than as unstructured free-form posts.

## Success Criteria

1. Every completed experiment can produce a private outcome card that clearly says what changed.
2. Users can keep results private now; future sharing and anonymous contribution flows must be unambiguous about the privacy level.
3. Future public protocol and biomarker pages can show cohort-level summaries without exposing raw personal data.
4. Shared results stay version-bound so comparisons mean the same thing across users and over time.
5. Social mechanics remain consistent with the constitution: useful, privacy-bounded, and non-addictive.
