---
name: habitat
description: Reading and saving durable facts about the member's home, workspace, equipment and environment, such as space, gear, air, light, noise, sleep setup and home city.
---

# Home and workspace facts

`bank/habitat` holds lasting facts about where the member lives and works.
Read it before advising about their environment or equipment, so the advice
fits what they have and like.

## Commands

- `vault-cli habitat coverage` shows what is still unknown.
- `vault-cli habitat catalog` lists the indicators and their allowed values.
- `vault-cli habitat show <aspect>` reads one aspect.
- `vault-cli habitat save <aspect> --indicator id=value` merges new values.
  Use `id=declined` when the member does not want to answer and `id=null` to
  clear a value.
- `--indicator-note id='short context'` keeps detail the catalog value cannot
  hold: measurements, brands, models, setup, limits and exceptions.
  `--indicator-note id=null` clears an outdated note.

## Saving

- Save a fact when the member mentions it, without interrupting the
  conversation to say so.
- Ask about a missing indicator only when the answer would change the advice
  you are giving now. Never run a survey or ask outside the current topic, and
  do not ask again about an indicator the member declined unless they bring it
  up.
- In a guided voice walkthrough, save the facts the member states clearly in
  one pass. Leave anything unclear unknown, and take corrections in
  conversation.
- Never ask for photos. When the member sends a photo of their home unasked,
  save only the indicators you can see in it.
- `home-location.location` holds a city or approximate region the member
  stated. Never save a street address. If they gave only an address, leave the
  location unknown.
- Never store raw transcripts.

What a member owns or can access is a constraint to work within. Do not treat
a missing sauna, red-light panel, air purifier, standing desk or similar
purchase as a shortcoming.
