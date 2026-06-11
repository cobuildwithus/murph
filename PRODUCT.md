# Product

## Register

product

## Users

Self-directed individuals who take their own health seriously and want to run structured experiments on themselves — not consume generic wellness advice. They already track data (sleep, HRV, glucose, training load) and want a tool that respects their intelligence and produces conclusions they can act on.

Primary context (inverted 2026-06-10): the group chat on the phone — challenges and day-to-day Murph contact happen where people already talk (iMessage, WhatsApp, Telegram). The desktop web vault is the secondary surface: a focused session reviewing results or planning the next protocol. Design the vault for depth, but never assume it's where users meet Murph first — almost nobody visits the website unprompted.

For deeper positioning, ICP detail, and brand voice see `agent-docs/product-marketing-context.md`.

## Product Purpose

Murph turns self-experimentation into a rigorous, readable practice. Users pick a protocol, run a baseline, execute the active phase, and get a structured conclusion — not a dashboard of numbers, a finding. Success is when a user finishes an experiment and says "I know what to do next" with evidence to back it.

Named after Murph from Interstellar — the physicist who solved the equation. The product should feel like her notebook, not a fitness app.

## Brand Personality

**Clean. Precise. Scientific.**

Curiosity-driven, rigorous, warm underneath the science. Not cold or clinical. Not gamified or cheerful. A tool for someone who takes their health seriously and wants real answers.

The voice of a careful researcher writing up results — direct, specific, unafraid of nuance. No marketing hype, no "you got this!" cheerleading, no jargon-for-jargon's-sake. When the data is ambiguous, say so.

Two registers, one personality (group register is a hypothesis, untested as of 2026-06-10):

- **Group chat — the referee.** Keeps the challenge fun and the participants accountable: kickoffs, scoring dispatches, nudges, humor. Looser and warmer than the private voice, never a cheerleader.
- **Private chat & vault — the researcher.** The careful voice described above.

If the referee reads dry and clinical, it's failing; if the private write-ups start performing for an audience, they're failing.

## Anti-references

- **Generic health apps** (Oura, Fitbit, Whoop) — ring charts, gamification, "great job!" messages, vibes-based scores.
- **SaaS analytics dashboards** (Mixpanel, Amplitude) — gray boxes, corporate tables, metric overload, dashboards that measure engagement instead of meaning.
- **Cyberpunk / Blade Runner / biohacker aesthetics** — neon, glossy, aggressive, performative.
- **AI slop** — generic gradients, purple-blue tech aesthetic, meaningless hero illustrations, "modern SaaS" landing pages, hero-metric templates.
- **Clinical sterility** — hospital-white interfaces, stock-photo doctors, insurance-portal energy.

## Design Principles

1. **Respect intelligence.** No tooltips explaining what HRV means. No gamification. No "great job!" messages. The user is a scientist running experiments on themselves. The same rule extends to UI labels — a tooltip on `In range` next to `55–75 bpm` restates what's already on screen. If a label needs a tooltip to be understood, the label needs rewriting; the tooltip is not the fix.
2. **Space is content.** Whitespace is not wasted space — it creates focus. Every element earns its pixels. When in doubt, remove.
3. **Data as poetry, not dashboards.** Present metrics like equations on a chalkboard — structured, beautiful, meaningful. Not pie charts in gray boxes.
4. **Warm precision.** Scientific rigor with human warmth. The interface should feel like a well-lit research library, not a hospital or a server room.
5. **Show, don't decorate.** No gradients for gradients' sake. No rounded-corner cards because "modern." Every visual choice serves comprehension or emotion.
6. **Content density over minimalism.** Scientific data, expert quotes, research citations, mechanism explanations — the depth IS the product. More information, presented with care.

## Accessibility & Inclusion

- Target **WCAG AA** for text contrast. Muted text (`#736a58`) and warning (`#8b5d3f`) are already chosen to meet AA on the cream background.
- Light mode is primary. Dark mode comes later; don't design dark-first and retrofit.
- Restrained motion. Animations serve hierarchy and affordance, never decoration — reduced-motion users should lose nothing essential.
- Desktop-first (1440px artboards) but every surface must stay usable at tablet and phone widths.
