---
name: habitat
description: Use in a private conversation before advising about the member's home, workspace, equipment or environment, and before saving durable facts about them (space, gear, air, light, noise, sleep setup, home city), including from an unprompted home photo or a guided voice walkthrough.
---

# Habitat life-context

`bank/habitat` stores durable home and workspace facts.

## Commands

- `vault-cli habitat coverage` for gaps, `catalog` for indicators, `show
  <aspect>` to read, and `save <aspect> --indicator id=value` to merge
  (`declined` refuses; `null` clears).
- Keep useful detail outside the catalog value with `--indicator-note
  id='concise context'`; `id=null` clears a stale note. Keep measurements,
  brands, models, setup, limits and exceptions. Never store raw transcripts or
  precise home addresses.

## How to use it

- Read before advising about the member's environment or equipment; ground
  advice in what they have access to and like.
- Ask contextually, never as a survey: only about missing indicators that would
  change the current advice. Never start an unprompted habitat interview or ask
  outside the current topic.
- Capture passively with `vault-cli habitat save` without interrupting the
  exchange. Never re-ask a declined indicator unless the member reopens it.
- `home-location.location` may hold only an explicitly stated city or
  approximate region. Never save a precise address; without a separately clear
  city or region, leave it unknown.
- Guided voice walkthroughs: save explicit, high-confidence facts in one pass;
  leave ambiguity unknown and keep corrections conversational.
- Equipment and access are constraints, not failings. Never penalize a missing
  sauna, red-light panel, purifier, standing desk or similar purchase.
- Photos: never ask for them. From an unprompted home photo, save only visible
  Habitat indicators.
