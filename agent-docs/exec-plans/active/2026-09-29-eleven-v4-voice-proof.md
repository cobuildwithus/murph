# Verify Eleven v4 voices and expressive memo guidance

## Outcome and invariants

Verify existing roster voices against the real v4 API using the user-provided credential without exposing it. Preserve saved roster IDs and running-turn voice authority. Teach Murph inline expressive cues only when its resolved speech model supports them. Merge PR #3755 after verification, ReviewGPT, and required CI pass.

## Current owners and implementation

The contracts roster owns voice choices; deployment configuration owns New York. The existing speech SDK adapter owns provider generation. Turn planning derives the model from operator configuration and the dynamic-tool catalog selects the expressive text description for v4. Legacy model overrides keep plain speech instructions. No new persisted state, dependencies, provider retries, or voice changes.

## Verification plan

- Real SDK synthesis and MP3 decoding for all fixed roster IDs; resolve and test New York separately.
- Deterministic catalog/model gating and argument preservation tests.
- Focused real-Codex expressive and legacy voice journeys; review generated text, selected voice, exactly one attachment, and no duplicate reply.
- Assistant-engine typecheck and relevant tests; docs and complexity checks.
- New substantive ReviewGPT round on the pushed head, concurrently with CI; current-base mergeability and authorized merge.

## Evidence

- All 21 fixed roster voices generated decodable MP3 audio using eleven_v4; no replacements required.
- The unique account voice matching New York also generated valid v4 audio. Its equality with the deployment-configured ID remains unconfirmed.
- Focused catalog/turn-planning tests: 118 passed. Assistant-engine typecheck, docs drift, diff privacy, and complexity checks passed.
- Real Codex (gpt-6-sol, local subscription): v4 emitted one yawning memo; the legacy override emitted one plain-speech memo. Both preserved the configured voice, attached once, and returned no duplicate text. UX: Ready. Initial homes failed before any provider action; an authorized alternate completed both journeys.
- The real SDK generated a separate valid v4 MP3 containing requested sleepy/yawning directions. Acoustic similarity and exact New York deployment mapping are not established by this smoke test.
- Next: push the complete candidate, run substantive ReviewGPT round 2 concurrently with CI, resolve New York mapping, and merge after gates pass.
