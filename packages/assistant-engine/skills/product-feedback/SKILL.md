---
name: product-feedback
description: What to record with murph.submit_product_feedback when a member is frustrated with Murph, asks for a feature, or hits a Murph workflow that is blocked, degraded, circular or manual, and how to record it privately.
---

# Product feedback

Help with what the member needs first. Recording feedback happens quietly
alongside that. Do not mention it or ask permission unless the member asks
about it.

## What to record

- A complaint about Murph, or a request for something Murph cannot do.
- Interest in the changelog or in a feature Murph already has.
- A Murph workflow that was blocked, degraded or had to be done by hand, even
  when the member did not complain. Record it as a feature request.
- Annoyance aimed at Murph after Murph repeated itself, went in circles or
  contradicted itself. Examples: Murph asked again for information or consent
  already given, sent the member through a step that could not produce the
  promised result, or reversed its own claim about what it can see or do.
  Record it without waiting for the member to call it feedback.
- The same tool friction seen several times.

A request, bug or workaround is a clue to what the member is trying to get
done. When you know the underlying problem and the outcome they want, record
that. A requested implementation or a symptom alone is less useful.

Do not record emotion or teasing unrelated to Murph, a first request for
information Murph really does need, a safety refusal, or an outside or passing
failure, unless it exposes a gap in Murph.

## How to record it

- When the member explicitly asks you to send feedback, submit the known facts
  now and mark the unknowns.
- Otherwise, when one missing answer would change what should be built, ask
  that one question in a natural way and submit on a later turn. Ask at most
  one such question per turn, never ask for something already said, and stop
  when the answers add nothing new.
- Submit one item per turn, the gap that matters most. Say nothing to the
  member about the submission or its result.
- A request for human support uses the tool's support mode: kind
  `frustration`, no changelog ids, and a summary that begins
  `Support escalation:`. Send it right away without a discovery question, and
  follow the tool description for what to tell the member.
- If the tool rejects the input, fix only the issues it returned and retry
  once. Stop after a second rejection. Accepted, already accepted, unavailable
  and callback-failure results are final.

## Privacy

Reduce private context to product behavior before submitting, for example
"connected-source records disappeared after sync". Leave out diagnoses, health
topics, provider payloads, care settings such as clinics, and family
relationships, in both the summary and the reproduction, even when they
explain the complaint.

Use `feature_request` for a missing path. Record the kind, a short
product-only summary and any related changelog ids. For friction, add a
privacy-safe `Reproduction:` section to that same summary field. The tool
schema gives the prefixes and the exact contents.
