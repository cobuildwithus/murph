# Expand female GPT-Live voice choices

## Outcome and ownership

Show only female voices, including missing GPT-Live options. Reuse the shared
voice allowlist and existing session configuration. Remove male selection and
group state rather than adding a new picker. Keep Gleam as the default.

## Evidence and UX

OpenAI's September 10 API announcement introduces twelve additional voices.
The Live session guide identifies five as feminine; Marin is the existing
session default. Add Bossa with its Brazilian Portuguese label and Marin.
Real GPT-Live startup probes also accepted Coral, Sage, and Shimmer, bringing
the picker to nine female voices. Nova received HTTP 403. Alloy was accepted but
is not included in the female-only selection because its presentation is neutral.
Selection remains locked until the active conversation ends. No new persistence,
credentials, provider configuration, or production access is introduced.

## Proof

Focused allowlist/route tests must accept every offered voice and reject retired
male options. Run website typecheck, scoped lint, and complexity. Verify added
voices against the provider and inspect the real picker at desktop/phone sizes.
No public changelog: this remains a local preview. Finish with a scoped commit.

## Results and review

All 30 focused tests, website typecheck, scoped lint, and complexity checks pass.
Provider startup accepted Marin, Bossa, Coral, Sage, and Shimmer. The actual page
returned speech for Coral and Bossa and reported the matching resolved provider
voice. The browser verified nine radio choices, no male switch, selection locked
while connected, switching after end, and no browser errors or phone overflow.
Desktop and phone renders inspected. Parent review confirmed removal of obsolete
group state and preservation of the key, allowlist, pause, and close boundaries.
Ready for local use; public integration remains outside the task.
Status: completed
Updated: 2026-09-20
Completed: 2026-09-20
