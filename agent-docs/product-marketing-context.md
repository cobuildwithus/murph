# Product Marketing Context

*Last updated: 2026-06-10*

This doc separates **facts** (what is true today), **hypotheses** (what we
believe but have not tested), and **target state** (what we are building
toward). Earlier revisions blurred these; do not re-blur them.

## Product Overview

**One-liner (current wedge):** Murph is the AI referee for group health
challenges. Start a challenge in the group chat you already have, and Murph
runs it: baselines, consent, scoring, reminders, and results.

**Substrate:** Under every challenge is the personal experiment loop — connect
a wearable, set a baseline, run a bounded protocol, get a structured outcome.
The challenge is the social front end; the experiment loop is what makes the
referee smart.

**Consumer shorthand:** Do a health challenge with your people, and let Murph
keep score — then see what actually changed for you.

**Product category:** Group health challenges / personal health
experimentation.

**Product type:** Works through existing messaging channels (group chat on the
phone is the primary surface) plus a web vault for results. No dedicated
mobile app.

### What is shipped vs. not (as of 2026-06-10)

- **Shipped:** personal experiment loop (wearable/lab connections, baselines,
  protocols, adherence, confounders, outcomes), 1:1 assistant chat, web vault.
- **In flight:** first real group challenges (family sleep-consistency and
  family-walk challenges launching now); group referee behavior is designed
  but has never run with real participants.
- **Target state, not shipped:** v1 group-channel routing, selected-friend
  sharing, anonymous contribution records, public cohort summaries, Health
  Commons surfaces.

## Traction (honest version)

- 8 paid users since the private beta opened 2026-05-04.
- **All 8 know the founder personally. Zero organic signups.** They were told
  "Murph is a health assistant that helps you run health experiments" and paid
  largely on trust in the founder, not proven product pull.
- Demand for the product itself is **unproven**. The first real demand test is
  whether non-founder challenge participants engage because the challenge is
  fun — starting with the family challenges launching 2026-06-10.
- Do not present the 8 paid users as demand evidence in any external material
  without this context.

## Pricing (actual)

- Most paying users: **$8/mo** (Plus).
- One user pays **$20/mo** (Edge) — a family member of a founder. The Edge
  tier has no validated buyer.
- The older $15/mo / $150/yr launch pricing is obsolete; remove it wherever it
  still appears.
- **Open question — challenge monetization.** Leading candidate (unvalidated):
  challenges are free, the private assistant/vault is what's paid. Who pays in
  a group (organizer, every participant, sponsor) is undecided. Do not state a
  model as fact until one has been tested.

## Positioning

The wedge is the group challenge:

- group-chat-native: lives where the group already talks
- the referee does the annoying parts — rules, mixed devices, baselines,
  reminders, scoring, results
- consent-at-join for data sharing (hypothesis: consent collected in-chat at
  kickoff)

The substrate is chat-first personal experimentation: private before/after
learning tied to wearable data.

The long-term moat is still the protocol outcome graph (exact protocol version
+ user context + adherence + biomarker deltas + confounders + cohort learning),
but it is **explicitly demoted to later**. Nothing about the current wedge
should be justified by the Commons; the wedge has to work on its own as a fun,
accountable group challenge.

Useful internal analogies (long-term): GitHub for protocol versions, Strava
for lightweight sharing attached to real activity, Wikipedia for the eventual
Commons. None of these describe the current product.

## Voice: two registers (hypothesis — untested in groups)

- **In the group chat, Murph is the referee.** It makes the challenge fun and
  keeps people accountable: kickoffs, score updates, nudges, humor. The
  referee-humor loop (do daily dispatches make the group laugh and reply?) is
  an explicit hypothesis under test in the first family challenges.
- **In private (1:1), Murph is a helpful assistant.** Calm, careful, research-
  grounded — the voice of someone writing up your results.

These are two registers of one personality, not two products. If group-chat
behavior starts feeling like the private assistant (dry, careful) the referee
is failing; if private analysis starts performing for an audience, the
assistant is failing.

## Product Philosophy

Unchanged and still binding:

- **Curiosity beats compliance.** The right feeling is "huh, interesting."
- **Silence is a feature.** A good health product knows when not to speak.
- **Compare interventions, not bodies.** Challenges score adherence and
  change-vs-your-own-baseline, never raw body stats. A challenge has a winner;
  it must not have a "best body."
- **Protocols are temporary tools, not identities.**
- **Numbers are clues, not verdicts.**
- **Private by default, sharing by consent.** In groups this means
  consent-at-join: joining a challenge is the explicit, visible act that
  shares specific data with that group, nothing more.
- **Status from useful contribution, not elite biomarkers.**

What we refuse to become: a whispering earring, a protocol machine, a shame
engine, an anxiety business, a health-status network that ranks bodies.

## Target Audience

**Wedge ICP:** someone who already wants to run a health challenge with
specific people — family, friends, coworkers — and doesn't want to manage
rules, mixed devices, reminders, scoring, and results by hand.

**Actual current users:** the founders' family and friends. First challenge
participants are family members (sleep consistency; daily walks). This is the
real ICP today; everything broader is projection.

**Substrate ICP (for the private assistant):** the data-curious wearable owner
who wants more from health data than passive scores — screenshots graphs,
texts friends, asks AI what numbers mean.

"Wearable owners" is a market, not a customer. Keep naming actual humans.

## Problems & Pain Points

**Challenge organizer's problem:** group challenges die because someone has to
be the referee — chase people, track mixed devices, keep score, declare
results — and that person burns out by week two.

**Individual's problem (substrate):** wearables create awareness without an
experiment loop. Scores accumulate; behavior doesn't change; nobody knows what
actually worked.

**Why alternatives fall short:**
- Group chats already host challenges informally — with no baselines, no
  scoring, no memory, and no referee.
- Wearable apps run branded challenges inside their own walled garden, only
  for their own device owners, with leaderboard mechanics.
- Wearable dashboards show status, not before/after learning.
- Generic AI chat can analyze, but holds no persistent runs, baselines, or
  group state.

## Product Loop (challenge wedge)

1. Someone starts or joins a challenge in the group chat.
2. Members consent at join; wearables they already own get connected.
3. Murph sets each person's baseline.
4. Murph runs the challenge: reminders, scoring, referee dispatches.
5. Results land in each member's private vault as a structured outcome.
6. The group sees the challenge result; each person sees what changed for
   *them*.

The first-class social object is the challenge and its outcome — not a
biomarker, not a feed.

## Objections

| Objection | Response |
| --- | --- |
| "I already have Oura or WHOOP." | Murph doesn't replace the wearable — it referees challenges across mixed devices and gives the data an experiment loop. |
| "We already do challenges in the group chat." | Right — with no baselines, no fair scoring, no memory, and one exhausted person playing referee. That's the job Murph takes. |
| "I can do this in ChatGPT." | Not persistently, not across a group, not with device data, baselines, and consent handled. |
| "This sounds like a leaderboard." | Scoring is adherence and change-vs-your-own-baseline, not body ranking. The winner did the thing most, not had the best HRV. |
| "I don't want another app." | There isn't one. The challenge lives in your existing chat; results live in a private vault you can visit when you care. |
| "I don't want my health data in a group chat." | Consent-at-join, scoped to the specific challenge. Private is still the default for everything else. |

**Anti-persona:** people who want a passive dashboard, public health-status
leaderboards, diagnosis, or a daily boss telling them what to do forever.

## Customer Language

> Provenance note: the lists below came from interviews about the *assistant*
> positioning (pre-2026-06). Challenge-specific language is thin — capture
> verbatims from the first family challenges and replace this section's gaps.

Problem language (assistant-era, still useful): "I have all this data and I'm
still not changing anything." / "It's too much information without a clear
experiment." / "Don't make this into a gross leaderboard." / "I don't want
another app."

**Words to use:** challenge, referee, baseline, what changed, experiment,
protocol, outcome, evidence, consent, worth trying, private by default

**Words to avoid:** optimize, biohack, leaderboard, top percentile, elite,
compliance, crush it, level up, hack, stack

**Glossary:**
| Term | Meaning |
| --- | --- |
| Challenge | A bounded group health experiment with a referee, baselines, scoring, and an end |
| Referee | Murph's group-chat register: runs the challenge, keeps it fun and accountable |
| Experiment / run | One person's bounded execution of a protocol |
| Protocol | The exact instructions for an experiment version |
| Outcome card | The concise result of a completed run: what changed, how trustworthy it looks |
| Consent-at-join | Joining a challenge is the explicit act that shares scoped data with that group |
| Health Commons | Long-term public protocol/outcome layer — target state, not current product |

## Proof Points

**Metrics:** none yet worth citing. 8 friends-and-family payers, 0 organic.
The first honest proof points will be challenge participation and reaction
verbatims from non-founder participants.

**Value themes to validate in challenges:**
| Theme | Status |
| --- | --- |
| Groups want a referee, not another app | Hypothesis |
| Challenges need automatic data (manual logging kills them) | Early learning — banked 2026-06 |
| Referee humor drives group engagement | Hypothesis under test |
| Consent-at-join feels right, not creepy | Hypothesis under test |
| The result-for-*me* is what makes a challenge more than a game | Hypothesis |

## Goals

**Business goal:** validate the group challenge wedge with real non-founder
participants, then figure out monetization (open question above). The private
experiment loop is validated only when someone who doesn't know the founder
pays for it.

**Primary conversion action (current):** join a challenge → connect wearable.

## Protocol Outcome Graph (long-term, demoted)

The graph — missions → domains → goal templates → experiment families →
protocol variants → biomarkers → runs → outcome cards → contribution records →
cohort summaries — remains the long-term compounding asset. It is not the
pitch, not the wedge, and must not be used to justify near-term work. Build
toward it only through what challenges and runs naturally produce.

## Design & Tech

**Stack:** Next.js + Tailwind, Postgres, hosted execution, local vault
surfaces, wearable integrations, AI providers.

**Surface hierarchy (inverted 2026-06-10):**
1. **Group chat on the phone** — where Murph lives day to day.
2. **1:1 chat** — the private assistant.
3. **Web vault (desktop)** — the review surface: results, baselines, planning
   the next run. Nobody visits it daily, and that's fine.

**Design rule:** if a surface makes the body feel like a public scoreboard, it
is pointed in the wrong direction. In groups: score the challenge, never the
body.
