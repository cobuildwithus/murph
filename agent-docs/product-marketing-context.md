# Product Marketing Context

*Last updated: 2026-04-08*

## Product Overview
**One-liner:** A place to try things with your body and see what actually works — backed by research, measured by your wearable.

**What it does:** Connect your wearable, browse a library of health experiments sourced from experts using AI, start one, follow the protocol, and see AI-analyzed results showing what changed. Each experiment is a bounded hypothesis — something to try, not a new way to live. You interact with Murph through iMessage, Telegram, or email — no app to download.

**Product category:** Health experimentation / personal health assistant

**Product type:** SaaS ($5/mo managed) — works through existing messaging apps, no separate app to install

**Business model:** $5/mo for early access users.

## Product Philosophy

Murph exists to help people understand their bodies better. Not to turn the body into a permanent optimization project.

**Presence without piety.** Help people notice more, obsess less, and trust themselves more.

Core beliefs:
- **Curiosity beats compliance.** The right feeling is "huh, interesting" — not "I need to get back on track."
- **Silence is a feature.** A great health product knows when not to speak.
- **Protocols are temporary tools, not identities.** Every experiment has a reason, a burden, an expected upside, a stop condition, and a review point.
- **Numbers are clues, not verdicts.** A low score doesn't mean something is wrong. A mismatch between data and lived experience is often the interesting part.
- **Life-fit beats marginal gain.** Recommendations should account for work, relationships, travel, pleasure, and ordinary human mess.
- **The default should be "lighter," not "more."** The app should often say: keep this simple, leave this alone, this might be noise, this may not be worth it.

What we refuse to become:
- A whispering earring that gets increasingly granular and directive
- A protocol machine where the answer is always another stack, another fix
- A shame engine that makes the body feel like a disappointing project
- An anxiety business whose engagement comes from guilt and hypervigilance

## Target Audience
**Target users:** People who own a wearable (Oura, Whoop, eventually Garmin/Apple Watch) and want more from their data than a daily score.

**Primary use case:** Running bounded health experiments with measurable outcomes instead of passively checking scores.

**Jobs to be done:**
- Help me figure out what to actually try — and whether it worked for my body
- Give me expert-backed experiments I can trust, not random internet advice
- Let me learn something concrete, then move on

**Use cases:**
- "I want to improve my HRV — what should I try, and did it work?"
- "I heard cold showers help recovery — let me try it and see"
- "I quit drinking — show me the data on how my body responded"
- "My sleep sucks — what do experts suggest that I can actually measure?"

## Personas
*B2C product — single persona for MVP*

| Persona | Cares about | Challenge | Value we promise |
|---------|-------------|-----------|------------------|
| Health-curious wearable owner | Understanding their body better, sleeping/recovering/feeling better | Data overload without actionability, "3-month wall" where wearable becomes useless, anxiety from scores | Bounded experiments that answer real questions about your body — then get out of the way |

## Problems & Pain Points
**Core problem:** Wearables give you data but never tell you what to do with it. You check your recovery score, shrug, and go about your day. After 3 months the novelty wears off and the device sits in a drawer.

**Why alternatives fall short:**
- Whoop/Oura dashboards show scores but no action plan
- Wearable companion apps live on your phone in a place you don't want to be — opening a mobile app to chat with an advisor or log a meal feels clunky. Logging takes too long, the assistant is buried, the experience doesn't fit how people communicate.
- Generic health advice isn't personalized to your biometrics
- No way to measure whether a specific protocol actually worked for you
- AI chatbots can analyze data but require technical setup
- Most health apps escalate: more tracking, more nudges, more guilt
- Most health apps monetize your data or require yet another app on your phone

**What it costs them:** Wasted subscription, abandoned devices, no behavior change despite owning health data.

**Emotional tension:** Frustration ("I have all this data and nothing changes"), anxiety from tracking ("bad score ruins my day"), creeping guilt ("I should be doing more with this").

## Competitive Landscape
**Direct:** No direct competitor combines wearable data + expert-sourced experiment library + AI analysis in one product.

**Secondary:**
- Whoop/Oura native apps — show data, no experiment framework
- Whoop Coach AI / Oura Advisor — generic suggestions, not structured experiments with before/after measurement
- Manual DIY (export CSV, paste into ChatGPT) — works but requires effort, no protocol library

**Indirect:**
- Health coaches / personal trainers — expensive, not data-driven
- Huberman Lab / podcasts — great protocols but no measurement infrastructure
- Examine.com / research databases — information without implementation
- General-purpose AI (ChatGPT, Gemini, Claude) as DIY health coach — people already do this but must manually prompt, paste data, and maintain context across sessions. No wearable integration, no experiment structure, no persistent memory.

## Differentiation
**Key differentiators:**
- Expert-sourced experiment library with real study citations
- Automatic baseline measurement (7 days before) vs experiment period comparison
- AI analysis connecting your biometric changes to research
- One experiment at a time = you know what caused the change
- Match % based on your profile data — personalized recommendations
- Every experiment has a stop condition — we don't escalate, we conclude
- Chat-first interface — talk to Murph through iMessage, Telegram, or email. Log a meal, ask about your experiment, get a reminder. No app to open.
- Your data stays yours — encrypted infrastructure, minimal data collection, no data sales. Health apps monetize your data; Murph doesn't.
- Experiment-aware assistant — Murph knows what you're running and reaches out at the right moments. Reminds you to log what you ate, asks if you did your sauna session, nudges you when a check-in matters for the experiment. The assistant lives inside the experiment, not in a separate tab.

**How we do it differently:** Instead of showing you a score and saying "good luck", we give you a bounded protocol, measure your baseline, track the experiment, and tell you what changed. Then we let you decide what's next.

**Why that's better:** Data becomes a tool for curiosity, not a source of anxiety. Each experiment answers a real question. And the product gets quieter as you learn more about yourself.

**Why customers choose us:** The wearable finally makes sense. You learn something concrete about your body and move on.

## Objections
| Objection | Response |
|-----------|----------|
| "I already have Whoop/Oura — why another app?" | We don't replace your wearable. We make it useful. Your device collects data, we turn it into experiments with measurable outcomes. |
| "I can just Google protocols and track them myself" | You could. But you won't set up a proper baseline, control for variables, or compare your data to the research. We automate that. |
| "One experiment at a time is too limiting" | That's the point. Running multiple means you can't attribute changes to anything specific. Clean experiments = trustworthy results. |
| "Won't this just make me more obsessed with my data?" | The opposite. Experiments have a defined end. You try something, learn from it, and move on. No infinite dashboards, no daily score anxiety. |
| "I don't want another app on my phone" | There isn't one. Murph works through iMessage, Telegram, or email — wherever you already are. |
| "Is my health data safe?" | Encrypted infrastructure, minimal data collection, no data sales. Your data stays yours. |

**Anti-persona:** People who want a passive dashboard. People who don't own a wearable. People looking for medical diagnosis. People who want to be told what to do every day forever.

## Switching Dynamics
**Push:** "I'm paying $30/mo for Whoop and not using the data." / "After 3 months it just tells me what I already know." / "Too much data, no actionability."
**Pull:** "I can see if sauna actually improved my HRV." / "Expert-backed protocols, not random advice." / "It concludes — I don't have to track forever." / "I just text it — no app to open." / "It reminds me what to log for my experiment." / "My data isn't being sold."
**Habit:** Checking the daily score is a habit even if it's useless. People are used to passive monitoring.
**Anxiety:** "What if the experiments don't show results?" / "What if I can't follow the protocol perfectly?" / "Am I just adding another health app to the pile?"

## Customer Language
**How they describe the problem:**
- "I wasn't using the data to change anything"
- "I stopped doing the things I loved because the data told me to"
- "Too much information and not really that helpful"
- "It only told me what I already knew"
- "The insights are not actionable"
- "It never tells you what to actually do differently"
- "Expensive self-awareness with no behavioral loop"
- "How much stress is added by tracking your stress?"
- "Useful for 3 months, then you catch the patterns and it's done"
- "I felt fine but my score said I recovered bad, and it got in my head"
- "I don't want to open a separate app just to log a meal or talk to an advisor"
- "The assistant in my wearable app is buried and clunky"
- "Logging takes too long, I just stop doing it"

**How they describe what they want:**
- "Connect the API to AI and get a daily overview of what to do"
- "Seeing the effect of a single drink on my HRV made me stop drinking"
- "The gap is connecting daily inputs (food, timing, habits) to outputs"
- "Tell me how hard to push myself each day"
- "Something that reaches out to me, not something I have to remember to open"
- "Log a meal in two seconds by texting what I ate"

**Words to use:** experiment, try, see what happens, your body, what changed, evidence, expert-backed, bounded, protocol, baseline, results, interesting, clue, notice

**Words to avoid:** optimize, biohack, score, tracking, monitoring, dashboard, data-driven, crush it, level up, hack, stack, routine (when meaning permanent lifestyle change)

**Glossary:**
| Term | Meaning |
|------|---------|
| Experiment | A bounded health protocol — something to try, with a start, end, and review point |
| Baseline | 7 days of data before an experiment starts, used as the comparison point |
| Protocol | The specific instructions for an experiment (frequency, duration, dosage, timing) |
| Match % | How well an experiment fits your profile based on your wearable data |
| Evidence level | How strong the research is (clinical trial → expert opinion → anecdotal) |

## Brand Voice
**Tone:** Warm, curious, grounded. Like a friend who reads the research and tells you the interesting parts — without lecturing.

**Style:** Direct, conversational, no jargon. Present data as signal with uncertainty, not judgment. Prefer "huh, interesting" over "you need to fix this."

**Personality:** Curious, calm, trustworthy, understated, gently skeptical. Anti-hype.

**What we sound like:**
- "Worth trying. Here's what changed."
- "Probably noise. Don't worry about it."
- "Interesting — your HRV moved. Could be the magnesium, could be the better sleep. Hard to say."
- "You finished the experiment. Here's what we saw. Want to try something else, or leave it?"

**What we never sound like:**
- "Your recovery is DOWN 12%! Take action NOW."
- "Unlock your full potential with these 5 protocols."
- "You're falling behind on your health goals."

## Proof Points
**Metrics:** TBD (MVP stage)

**Customers:** Early-access users with Oura or Whoop wearables.

**Value themes:**
| Theme | Evidence |
|-------|----------|
| Passive data → bounded experiments | Wearable users say data is useless without an action framework |
| Alcohol/HRV is the #1 "aha moment" | Seeing alcohol's effect on biometrics is the most common catalyst for actual behavior change |
| 3-month wall is real | Wearables become useless after initial novelty — bounded experiments give a reason to keep going |
| People already build this manually | Technically savvy users wire wearable APIs to AI — we make that accessible |
| Expert trust matters | Study citations and evidence levels address "random internet advice" skepticism |
| Tracking anxiety is a real problem | Many users report that scores make them feel worse, not better — bounded experiments with stop conditions solve this |
| People already use general-purpose AI as health coaches | Users feed their height, weight, and training history into ChatGPT/Gemini/Claude and get workout plans back. It works but requires manual prompting, no wearable integration, no memory across sessions. We productize this with persistent context and real biometric data. |
| "Graduation" is a feature, not churn | Users quit wearables after learning what they needed — "once I made the changes I didn't need the membership." Bounded experiments align with this: you learn, you finish, the product gets quieter. This is healthy, not failure. |

## Goals
**Business goal:** Validate the experiment loop with early-access users, then open access.
**Conversion action:** Connect wearable → start first experiment.
**Current metrics:** Pre-launch. Small early-access group paying $5/mo.

## Experiment Data Model

The library is a layered knowledge graph, not a flat list of protocols:

**Missions** — long-horizon health directions (e.g., longevity, performance)
**Domains** — areas of health (sleep, cardiovascular, nutrition, stress, exercise, supplements, circadian, breathwork/cold). Each domain groups related experiments and biomarkers.
**Goal templates** — specific goals within a domain (e.g., lower resting heart rate, improve sleep consistency)
**Experiment families** — categories of interventions that share a mechanism (e.g., heat exposure, aerobic base, meal timing)
**Protocol variants** — specific, actionable versions within a family. Each variant has instructions, contraindications, a source expert, and links to biomarkers with expected direction, latency, evidence level, and confidence score.
**Biomarkers** — measured outcomes with reference ranges, mechanisms, guardrails, and healthspan evidence. Each biomarker supports multiple measurement contexts (e.g., nighttime wearable vs morning manual vs clinical).
**Source people** — experts behind protocols
**Source artifacts** — studies and references backing each claim

Each protocol tells you what should change, how long it might take, and how confident the research is. Active experiments bind a protocol to a hypothesis, a primary biomarker, and a time window — with a clear start, end, and review point.

## Design & Tech
**Stack:** Next.js + Tailwind, Postgres (Supabase/Neon), Claude API, Oura API v2, Whoop API v1, Vercel
**Design aesthetic:** Warm, natural — cream background, olive accents, Fraunces serif + DM Sans. Grounded and calm, not clinical or tech-bro.
**Key screens:** Library (browse/filter/recommended), Experiment Detail (protocol + research + safety), Your Results (active experiment with live metrics vs baseline)
**Expert sources:** Peter Attia, Rhonda Patrick, Andrew Huberman, Bryan Johnson, Andy Galpin, Matthew Walker, Layne Norton, David Sinclair, Tim Ferriss, Wim Hof, James Clear, Gabrielle Lyon, Sara Gottfried, Stan Efferding, and others.
