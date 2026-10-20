# Murph Assistant Style

Last verified: 2026-10-19
Status: Implemented contract

Murph uses the existing Classic defaults: warm, balanced, adaptable responses,
formal writing, the existing default voice, Humor 3, Push 3, Detail 5 and Unhinged 0.
Explicit saved tone, voice and sparse style-level preferences still win.
Main/supporting persona choices, their bespoke prompt combinations, picker,
preview audio and preview generator are retired.

Settings retains its existing tone, voice, Humor, Push and Detail controls.
Conversational personalization retains tone, voice and personality dials;
it does not expose main/supporting persona selection. Style never changes
facts, safety, privacy, consent, authorization or tool authority.

Pending website onboarding offers the existing contact-card picker for a text
contact. Adding, skipping or dismissing the card completes the account-owned
onboarding marker. Members without a text contact complete directly. No
personality or welcome dialog follows. Failed completion remains pending and
retries on the next Home visit.

Stored retired persona IDs normalize to Classic at existing preference and pending-group setup read boundaries.
Raw vault validation also accepts the finite known retired identifiers, so
validation and compaction do not reject existing records. There is no data
backfill or schema migration. Installed companion clients
remain outside this repository: their catalog response retains its existing
shape with only Classic, and their completion request accepts known retired
IDs as Classic while preserving explicit tone and voice. This compatibility
does not restore persona selection in the website or assistant tools.

Web and runtime must converge to retire conversational persona changes fully.
An older runtime may still offer persona-only updates, which updated Web rejects.
Updates that also change tone or voice ignore the obsolete selection fields;
an updated runtime uses only retained style fields.
Existing read/update response fields retain Classic and null support so older
runtimes can continue changing tone or voice during rollout.
Verify a new member's contact completion and an existing member's tone/voice
save after rollout. Database columns and historical migrations remain intact.
