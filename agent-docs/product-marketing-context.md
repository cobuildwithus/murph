# Product Marketing Context

*Last updated: 2026-04-22*

## Product Overview

**One-liner:** Murph is the experiment layer for personal health: run a protocol, measure what changed, and optionally contribute the result to a living Health Commons.

**Consumer shorthand:** Try things with your body, see what actually worked, and learn from other people doing the same.

**What it does:** Connect your wearable, browse or receive a protocol recommendation, run one bounded experiment through Telegram, iMessage, or email, and get a private outcome card showing what changed, what may have confounded it, and whether it looks worth repeating. Over time, Murph is building toward a living Health Commons where opt-in, structured results help people discover what works for bodies like theirs without turning health into a leaderboard.

**Product category:** Personal health experimentation / protocol outcome network

**Product type:** SaaS ($15/mo or $150/yr managed launch pricing) that works through existing messaging apps instead of a dedicated mobile app.

**Business model:** $15/mo or $150/yr for the launch tier.

## Positioning

Murph should not be positioned primarily as a generic AI health assistant. The assistant is the wedge, not the moat.

The wedge is:
- chat-first personal experimentation
- easy logging and follow-up in channels people already use
- private before/after learning tied to wearable data

The moat is:
- exact protocol version + user context + adherence + biomarker deltas + confounders + cohort learning
- a public Health Commons of protocol pages, biomarker pages, sources, and aggregate outcomes
- a network of structured results rather than a generic chatbot transcript pile

Useful internal analogies:
- GitHub for exact protocol versions, variants, and diffs
- Strava for lightweight sharing attached to real activity
- Wikipedia for the public Health Commons of reusable knowledge

Murph combines those patterns around protocols and outcomes rather than around identity, posting, or raw biomarker status.

## Product Philosophy

Murph exists to help people understand their bodies better without turning health into a permanent optimization project.

**Presence without piety.** Help people notice more, obsess less, and trust themselves more.

Core beliefs:
- **Curiosity beats compliance.** The right feeling is "huh, interesting," not "I need to get back on track."
- **Silence is a feature.** A good health product knows when not to speak.
- **Compare interventions, not bodies.** The interesting question is what people tried and what changed, not who has the best resting heart rate.
- **Protocols are temporary tools, not identities.** Every experiment has a reason, burden, expected upside, stop condition, and review point.
- **Numbers are clues, not verdicts.** A low score is not a moral event.
- **Life-fit beats marginal gain.** Recommendations and rankings should account for friction, social cost, pleasure, and ordinary life.
- **Private by default, sharing by consent.** The product should never quietly turn private health behavior into public performance.
- **Status should come from useful contribution, not elite biomarkers.** If there is social proof, it should reward clean experiments, helpful notes, replication, and good evidence.

What we refuse to become:
- A whispering earring that grows increasingly granular and directive
- A protocol machine where the answer is always another stack
- A shame engine that makes people feel behind or broken
- An anxiety business powered by guilt and hypervigilance
- A health-status social network that ranks bodies before it teaches anything

## Target Audience

**Target users:** Wearable owners (Oura, WHOOP, and adjacent device users over time) who want more from their data than passive scores and are willing to try small experiments.

**Initial ICP:** The data-curious, socially motivated experimenter who already screenshots graphs to friends, wants clearer answers than "my score was weird," and does not want another app or a permanent health identity.

**Primary use case:** Run one bounded protocol, measure what changed, and decide whether it is worth repeating, sharing, or contributing anonymously.

**Jobs to be done:**
- Help me figure out what to try next and whether it worked for my body
- Show me what people like me tried, what changed, and how confident the signal looks
- Give me a result I can keep private, share with friends, or contribute to the commons
- Keep the whole loop lightweight enough that I do not need another dashboard or logging chore

**Use cases:**
- "I want to improve my HRV. What should I try, and did it work?"
- "I heard Norwegian 4x4 can move VO2 max. Show me the cleanest version and what people actually saw."
- "I stopped drinking. Give me a result card I can compare against my baseline."
- "My sleep sucks. What low-burden protocol is worth trying first?"
- "Show me what people with bodies like mine tried, without turning this into a gross comparison game."

## Personas

| Persona | Cares about | Challenge | Value we promise |
| --- | --- | --- | --- |
| Data-curious wearable experimenter | Learning what actually helps, with enough proof to trust the answer | Scores create awareness but not action; screenshots and anecdotes do not add up to clean learning | Run one protocol, get a private outcome card, and learn from cleaner cohort evidence when you want it |

## Problems & Pain Points

**Core problem:** Wearables create awareness without an experiment loop. People accumulate scores, anecdotes, and screenshots but still do not know what to try, what changed, or how to learn from other people's results.

**Why alternatives fall short:**
- Wearable dashboards show status but not exact protocol-versioned before/after learning
- Wearable assistants and generic AI can answer questions, but they do not bind advice to exact protocol revisions, adherence, confounders, and sharable outcomes
- People already share graphs with friends, but the unit of sharing is messy and unstructured
- Most health communities drift into status comparison, guru dynamics, or protocol stacking
- Most health apps either keep the experience purely private or make the social layer feel gross
- Most health products still require opening another app to log, ask, or reflect

**What it costs them:** Wasted wearable subscriptions, abandoned devices, weak behavior change, noisy self-experiments, and no compounding shared evidence.

**Emotional tension:** "I want clearer answers and some social proof, but I do not want my body turned into a competition."

## Competitive Landscape

**Direct:** No direct competitor combines exact protocol versions, wearable-connected private runs, sharable outcome cards, and an opt-in Health Commons of aggregate results.

**Secondary:**
- Wearable apps with built-in AI helpers
- Generic AI chat used as a DIY health coach
- Research databases, podcasts, and expert content
- Manual spreadsheet or screenshot-based self-experimentation
- Human coaching

**Strategic read:** Assistant-only positioning is weak because assistant features will be table stakes. The defensible layer is the protocol outcome graph: protocol family -> protocol variant -> private run -> outcome card -> cohort summary -> next protocol discovery.

## Differentiation

**Key differentiators:**
- Exact protocol revision binding from public protocol page to private run to finished outcome
- One meaningful experiment at a time by default for cleaner attribution
- Private outcome cards with biomarker deltas, confidence, and confounders
- Opt-in contribution path from private result to anonymous cohort learning
- Health Commons that combines literature-backed protocol pages with community outcome summaries
- Structured protocol variants and forks instead of vague "I kind of tried this" posts
- Chat-first interface in Telegram, iMessage, or email rather than a separate app
- Anti-shame product design that rewards useful learning, not elite biomarkers
- Privacy posture: private by default, minimal data exposure, no quiet data sale story

**How we do it differently:** Instead of showing a score and saying "good luck," Murph gives the user a bounded protocol, a clean before/after frame, a private result, and an optional way to contribute that learning to something larger.

**Why that is better:** Data becomes a tool for curiosity instead of a source of anxiety. Users learn something concrete from each run. The product gets more useful as the commons fills in, but it does not need to become louder or more addictive.

**Why customers choose us:** Their wearable finally becomes useful, and the result is something they can actually act on or share.

## Product Loop

1. Discover a protocol or ask Murph what is worth trying.
2. Start a private, bounded run tied to an exact protocol revision.
3. Log only what matters for the run.
4. Finish with a private outcome card showing what changed.
5. Keep it private, share it with selected friends, or contribute it anonymously.
6. Use that result and the commons to decide what to try next.

The first-class social object is the completed outcome card, not the biomarker itself and not a scrolling feed.

## Objections

| Objection | Response |
| --- | --- |
| "I already have Oura or WHOOP." | Murph does not replace the wearable. It gives the wearable an experiment loop and a result worth acting on. |
| "I can already do this in ChatGPT." | You can improvise the analysis, but you do not get exact protocol versions, persistent run context, clean before/after structure, sharable outcome cards, or a living commons of comparable results. |
| "This sounds like social health leaderboards." | That is explicitly not the goal. Murph compares interventions and outcomes, keeps sharing opt-in, and avoids raw body-ranking as the default social mechanic. |
| "Won't this make me more obsessive?" | The product is built around one bounded run, explicit stop conditions, and lightweight sharing. It should lower noise, not create more of it. |
| "I do not want another app." | There is not one. Murph works through the messaging channels people already use. |
| "I do not want my health data to become public." | Private is the default. Public learning comes only from explicit contribution, and it should be aggregated or permissioned rather than silently identity-first. |

**Anti-persona:** People who want a passive dashboard only. People seeking diagnosis. People who mainly want public health-status leaderboards. People who want the app to tell them what to do every day forever.

## Switching Dynamics

**Push:** "I pay for the wearable but I am not using the data." / "After a few months it just tells me what I already know." / "I already screenshot graphs to friends because the app itself is not enough."

**Pull:** "I can see whether a protocol actually moved my numbers." / "I can learn from people like me without turning it into a competition." / "The result is shareable if it is useful." / "I just text it; I do not have to open another app."

**Habit:** Passive score checking is easy even when it is not helpful. Existing social behavior already happens in screenshots, texts, and anecdotes rather than in structured product loops.

**Anxiety:** "What if the experiment does not show anything?" / "What if my result looks bad?" / "What if this turns into another health-status rabbit hole?"

## Customer Language

**How they describe the problem:**
- "I have all this data and I am still not changing anything."
- "The wearable told me something was off, but not what to try."
- "I already send screenshots to friends when something weird happens."
- "It is too much information without a clear experiment."
- "I want to know what people actually tried and what changed."
- "Show me where I stand without making it weird."
- "Do not make this into a gross leaderboard."
- "I do not want another app just to log something small."

**How they describe what they want:**
- "Tell me what is worth trying first."
- "Give me a clean before/after."
- "Show me what worked for people like me."
- "Let me share the result if it is interesting."
- "I want the social part to help me learn, not compare bodies."
- "Keep it lightweight."

**Words to use:** experiment, protocol, outcome, what changed, baseline, confidence, confounders, cohort, contribution, evidence, result card, worth trying, private by default

**Words to avoid:** optimize, biohack, leaderboard, top percentile, elite, compliance, score, monitoring, crush it, level up, hack, stack

**Glossary:**
| Term | Meaning |
| --- | --- |
| Experiment | A bounded health protocol with a start, end, and review point |
| Protocol | The exact instructions for an experiment version |
| Outcome card | The concise result of a completed run, including what changed and how trustworthy it looks |
| Health Commons | The public protocol, biomarker, source, and aggregate-outcome layer |
| Contribution | An explicit choice to turn a private result into public or cohort learning |
| Confidence | Murph's honest read on how clean the signal looks, not proof of causation |

## Brand Voice

**Tone:** Warm, curious, grounded, lightly skeptical. Murph should sound like a calm companion who knows the research and respects uncertainty.

**Style:** Direct, conversational, no hype. Present data as signal with caveats, not as moral judgment or clinical certainty.

**Personality:** Curious, calm, trustworthy, understated, anti-hype.

**What we sound like:**
- "You finished the run. Here is what moved, what may have confounded it, and what looks worth repeating."
- "Could be noise. Probably not worth optimizing right now."
- "Interesting. People running this protocol often see a signal here, but your result looks mixed."
- "This is worth sharing if it helped. You can also keep it private."

**What we never sound like:**
- "Your recovery is down 12%. Fix this now."
- "Beat your cohort."
- "You are outperforming most users."
- "Unlock your full potential with these five stacks."

## Proof Points

**Metrics:** TBD (MVP stage)

**Customers:** Early-access wearable owners experimenting with Oura, WHOOP, and adjacent data sources.

**Value themes:**
| Theme | Evidence |
| --- | --- |
| Wearables need an experiment loop | Users already say passive scores are interesting at first and then stop changing behavior |
| People already improvise this manually | Users screenshot graphs, text friends, or paste context into general AI tools |
| The right share unit is the result, not the dashboard | People naturally talk about "I tried this and here is what happened," not "here is my abstract health profile" |
| Exact protocol version matters | Clean before/after learning requires knowing what someone actually did, not just the topic |
| Social learning has to stay healthy | Users want to learn from others without body-status theater |
| Graduation is a feature, not churn | Murph should help people learn, conclude, and get quieter over time |

## Goals

**Business goal:** Validate the private experiment loop first, then validate that opt-in contributions and cohort learning materially improve discovery and retention.

**Primary conversion action:** Connect wearable -> start first experiment.

**Compounding loop:** Finish experiment -> review outcome card -> share or contribute if useful -> discover next protocol.

## Protocol Outcome Graph

Murph is not a flat library and not just a chat thread. The product graph is:

- **Missions** - long-horizon health directions such as longevity, resilience, or performance
- **Domains** - areas such as sleep, cardiovascular, nutrition, stress, exercise, supplements, circadian, or recovery
- **Goal templates** - specific desired changes within a domain
- **Experiment families** - categories of interventions sharing a mechanism
- **Protocol variants** - exact performable versions with instructions, contraindications, and expected biomarker directions
- **Biomarkers** - measured outcomes with context, caveats, and expected latency
- **Private runs** - one user's bounded execution of one exact protocol revision
- **Outcome cards** - concise results derived from those runs
- **Contribution records** - explicit permissioned summaries used for cohort learning
- **Cohort summaries** - aggregate "what people saw" blocks on protocol and biomarker pages
- **Protocol variants and forks** - structured diffs that keep lineage clear instead of turning protocols into free-form posts
- **Source people and source artifacts** - the literature, experts, and references behind each claim

The compounding asset is the graph from biomarker -> goal -> protocol family -> protocol variant -> run -> outcome -> cohort -> next protocol.

## Design & Tech

**Stack:** Next.js + Tailwind, Postgres, hosted execution, local vault surfaces, wearable integrations, and AI providers.

**Design aesthetic:** Warm, calm, grounded. Avoid clinical dashboards and avoid hype-y quantified-self visuals.

**Key screens and surfaces:**
- Health Commons protocol page
- Biomarker page with community outcomes
- Private experiment run and result card
- Friend or cohort digest
- Chat-based onboarding, logging, and check-ins

**Design rule:** If a surface makes the body feel like a public scoreboard, it is pointed in the wrong direction.
