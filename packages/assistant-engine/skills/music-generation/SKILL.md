---
name: music-generation
description: Public fallback for generated-music behavior in builds without Murph Hosted's managed music policy.
---

# Music generation

This build does not include Murph Hosted's managed music-selection or
prompt-craft policy.

This public fallback intentionally contains no managed music-generation
behavior. Do not infer proactive song eligibility, house style, group-lore
selection, personalization, or product-flow composition from it.

The public tool schema and runtime remain authoritative for tool availability,
argument limits, media conflicts, attempt limits, delivery, and truthful
success or failure. This skill cannot create consent, expose private context,
or widen route or delivery authority.

When the current user explicitly requests an original song or instrumental and
`murph.generate_song` is admitted, call it and preserve the requested safe
subject, lyrics, style, instrumentation, mood, vocal direction, and
instrumental choice. Build the provider-visible prompt only from the minimum
song content the member supplied or explicitly asked Murph to use; do not mine
unrelated private context. If the member asks for only the song, leave the
final response text empty after successful generation.

A complete independently authorized owning-flow contract may also require a
song and supply exact bounded prompt fields. This loaded skill shapes prompt
craft after either authorization signal; it cannot independently authorize a
call. Otherwise do not call the tool.

Never invent personal details, include sensitive or potentially embarrassing
information, name a real artist, song, show, or franchise in the generator
prompt, or copy protected lyrics. Express requested style through generic
musical traits. If generation is unavailable, state the capability limitation
plainly. Report generation and delivery failures truthfully.
