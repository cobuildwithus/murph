# Creative notification song transport

## Outcome

Allow the application-owned song tool to complete Linq attachment uploads
without granting creative-notification model turns public Internet access.

## Scope

- Separate the Linq voice-media upload transport from Codex's native public
  Internet capability.
- Preserve the existing creative-notification sandbox, one-shot lifecycle,
  single `generate_song` tool surface, and text fallback.
- Add focused proof that a creative notification retains only its media upload
  transport and that the resulting song can traverse generation, Linq
  attachment creation, and signed upload.
- Keep the correction inside the existing assistant-engine and hosted runtime
  ownership boundaries; add no queue, state owner, provider allowlist exception,
  or feature-specific transport.

## Invariants

- The model receives no public fetch, shell, apps, browser, plugins, environment
  values, hosted tool context, workspace materialization, or progress delivery
  in a creative notification turn.
- ElevenLabs and Linq API calls continue through the write-fenced hosted
  provider transport.
- The provider-returned signed Linq upload URL uses the existing public
  transport only inside the media tool runtime and is never model-visible.
- Ordinary voice memo and Telegram behavior remains unchanged.

## Steps

1. Split model-native public fetch from application-owned media upload fetch at
   the provider-turn boundary.
2. Add integrated regression coverage for creative-turn capability confinement
   and successful signed song upload.
3. Run focused assistant-engine tests, typecheck, and direct path proof.
4. Complete required ReviewGPT, CI, commit, PR, and deployment-readiness gates.

## Evidence

- Focused Vitest: 98 tests passed across creative capability confinement,
  provider/runtime transport wiring, and generated voice-media behavior.
- Assistant-engine typecheck passed.
- Direct regression executes the real `generate_song` tool through the
  provider-created Linq media runtime: provider fetch handles ElevenLabs and
  Linq attachment creation, the distinct upload fetch handles the signed
  `PUT`, and Codex receives neither that field nor public Internet fetch.
- Product-experience review: `NO FINDINGS`; post-deploy live sponsorship remains
  the final cross-runtime proof.
- Preliminary `completion-specialists` ReviewGPT: `SPECIALIST_OUTCOME: PASS`,
  no findings, and no patch artifact.
- Parent final review found no remaining correctness, scope, architecture, or
  proof gap beyond the documented post-deploy live sponsorship check.

Status: completed
Updated: 2026-07-29
Completed: 2026-07-29
