# Proactive health coaching

Status: active
Created: 2026-08-30
Updated: 2026-08-30

## Goal

- Make Murph notice meaningful emerging health behaviors and continue a member's own stated thread with timely, useful coaching, without requiring a request to "be proactive."
- Reuse the existing managed weekly digest and existing conversation/vault primitives; introduce no scheduler, durable state, or delivery owner.

## Success criteria

- A repeated new behavior tied to a still-current member-stated intention can produce one concise, natural, useful note before a novel physiological insight exists.
- One-off activity, generic praise, ordinary shortfalls, duplicate outreach, weak evidence, or poor conversational timing remain silent.
- Without a still-current member-stated intention, Murph can make only a useful neutral observation and cannot invent a goal, plan, reminder, experiment, or accountability loop.
- Deterministic prompt composition and a focused production-derived real-Codex journey prove both the send and skip paths.

## Scope

- In scope: weekly health digest selection/composition guidance, shared proactive-health pacing guidance, focused deterministic and live assistant tests, and a member-facing changelog decision.
- Out of scope: a new automation, event detector, scoring model, persisted insight ledger, notification scheduler, delivery path, or user preference surface.

## Constraints

- Technical constraints: keep the existing managed-automation contract and existing engine-supplied conversation plus narrow canonical vault reads; do not infer delivery from transcript presence.
- Product/process constraints: optimize for autonomy, relevance, usefulness, and interruption cost rather than replies or engagement. Keep one compact phone-screen message and make silence a first-class outcome.

## Product UX plan

- Classification: Product change. This changes when and why an existing weekly message may appear, with no new surface or setup.
- Entry and promise: the existing weekly digest notices a meaningful repeated change connected to the member's own words and offers one useful continuation; no member command or preference setup is required.
- Journey 1 — emerging behavior: a member states a current intention, then repeats a relevant new behavior; Murph recognizes the pattern, connects it to that intention, and adds one grounded interpretation or low-burden recommendation.
- Journey 2 — ordinary shortfall: a member already works on a domain but has an unremarkable weaker week with no new lever, safety issue, or question; Murph stays silent.
- Journey 3 — no stated intention: Murph may name a repeated change only when the neutral observation is useful on its own; it creates no target, evaluation, pressure, or follow-up machinery.
- Journey 4 — interruption cost: a recent unsolicited note or unrelated urgent/sensitive thread causes a wait or fold into the existing conversation.
- Control and recovery: existing automation preferences, routing, pacing, and send/skip behavior remain authoritative; there is no new state to migrate or recover.

## Risks and mitigations

1. Risk: proactive coaching becomes surveillance, nagging, or a report card.
   Mitigation: require repeated evidence, personal relevance, novel help, receptive timing, and earned language; suppress ordinary negatives and engagement-bait questions.
2. Risk: prompt rules conflict about whether a conversational intention authorizes coaching.
   Mitigation: name still-current, uncontradicted member-stated intentions explicitly and keep no-intention notes observational only.
3. Risk: automations stack messages or create a second outreach ledger.
   Mitigation: compose one pacing fragment across proactive health automations and use committed conversation only as conservative pacing evidence, never delivery proof.

## Tasks

1. Tighten the shared proactive-health selection and pacing policy.
2. Add the emerging-behavior path to the existing weekly digest without new primitives.
3. Add deterministic presence/absence coverage and a focused real-Codex send/skip journey.
4. Run focused tests, package typecheck, live assistant verification, diff/privacy review, Product UX walkthrough, and required PR review gates.

## Decisions

- Reuse the weekly digest rather than add a fifth proactive automation.
- Treat a still-current member-stated intention as sufficient context for supportive interpretation; absent that context, allow only useful neutral observation.
- Treat silence as an expected successful action and do not optimize for eliciting a reply.
- Do not add learned ranking or a persisted opportunity score until real send/skip outcomes demonstrate a current need.

## Verification

- Commands to run: focused managed-automation Vitest files; Assistant Engine typecheck; one uniquely named `pnpm test:assistant:live` journey; `git diff --check`; exact-head CI and preliminary ReviewGPT prompt/Product UX/coverage lenses.
- Expected outcomes: deterministic composition contains the new authorization, evidence, pacing, mutation, tone, and suppression boundaries and excludes the old goal-only conflict; the live send is specific, useful, natural, and pressure-free; the live ordinary-shortfall case returns the exact skip decision; no automation or canonical goal/plan/experiment mutation occurs.
