# GPT-Live voice selection

## Outcome and ownership

Offer ten documented English GPT-Live voices, grouped by female and male
presentation, with Gleam selected initially. Keep the reusable circle compact
unless its caller opts into the picker. A shared catalog owns the allowlist;
the browser sends the selection and the server sets audio.output.voice.
No transcripts, credentials, or new persistent state are introduced.

## Product UX

Choose a voice, start a conversation, pause/resume, then end before choosing a
new voice. Lock selection during connection, conversation, pause, and closing:
OpenAI requires a fresh session for a different voice. Show female choices first,
with accent labels and a separate male group. Use native radio inputs and
keyboard focus. Preserve the simple circle without the optional picker.

## Proof and completion

Prove default selection, male/female browsing, outgoing selected voice, provider
allowlisting, selection lock, and switch-after-end. Check actual GPT-Live sessions
with female and male selections, desktop/phone layout, focused route and lifecycle
tests, website typecheck, lint, and complexity. Local prototype only: no public
changelog, PR, or production integration. Commit the scoped result.

## Results

Ready for local use. All 23 focused tests, website typecheck, scoped ESLint, and
complexity checks pass. A real browser proved female-first selection, four female
and six male options, selected voice forwarding, disabled selection while active,
Willow speech, pause/resume/end, then Vesper speech in a fresh session. No browser
errors or mobile horizontal overflow. Desktop and phone captures were inspected.
Parent review confirmed the provider allowlist, existing local-only key boundary,
and reuse of the existing session lifecycle. No new dependency or durable state.
Status: completed
Updated: 2026-09-20
Completed: 2026-09-20
