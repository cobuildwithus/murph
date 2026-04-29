# Make experiment start CTA auth-gated and route to connected contact channel

Status: completed
Created: 2026-04-29
Updated: 2026-04-29

## Goal

- Make the experiment detail "Start Experiment" CTA auth-gated and route authenticated users into the best available Murph contact channel.
- Add a reusable hosted-web helper that resolves start-experiment contact options from connected Privy phone, Telegram, and email accounts plus the member's routed Murph text number when available.

## Success criteria

- Signed-out users still see the hosted auth dialog before any contact app opens.
- Signed-in users with multiple connected channels see a polished dialog offering Text, Telegram, and/or Email options for the channels they actually have.
- Signed-in users with one connected channel go straight to that app. Users with no resolved connected channel fall back to a direct Telegram/Messages route without exposing raw account identifiers.
- The helper is covered by focused tests for multi-channel dialog, single-channel direct open, and fallback behavior.

## Scope

- In scope:
- `apps/web` experiment detail header/layout and results empty-state CTA behavior.
- A small browser-safe contact-option helper under hosted web source.
- Focused hosted-web tests for helper decisions and component wiring.
- Out of scope:
- Creating or persisting experiment runs.
- Changing hosted onboarding, billing, Privy provider setup, or message delivery backends.
- Fetching/decrypting new private contact state beyond the existing page-auth/routing read already used by Settings.

## Constraints

- Technical constraints:
- Use existing `AuthButton`, shadcn/base dialog/button primitives, Privy linked-account selectors, and existing Murph contact constants/patterns where practical.
- Do not add dependencies.
- Do not print or fixture real phone numbers, emails, Telegram ids, or secrets. Test data must stay synthetic.
- Product/process constraints:
- Keep language concise and experiment-oriented; avoid signup/outreach framing in provider-facing prompts or code comments.
- Preserve unrelated dirty-tree edits and active experiments-page work.

## Risks and mitigations

1. Risk: Contact routing could expose or misuse a user's own linked identifiers.
   Mitigation: Use linked accounts only to decide which option is available; contact hrefs target Murph channels, not the user's phone/email/Telegram id.
2. Risk: The start button could bypass auth while Privy is still loading.
   Mitigation: Keep the CTA wrapped in `AuthButton` and route only from its authenticated click path.

## Tasks

1. Add the contact-option helper and focused unit coverage.
2. Add the authenticated start CTA component and dialog.
3. Pass the existing routed Murph text number from the experiment layout when available.
4. Run focused app checks, required audit passes, and close/commit if safe.

## Decisions

- Prefer a connected single channel when exactly one is resolved.
- When no connected channel is resolved, use the Settings Murph text number when the authenticated member has one; otherwise open the Murph Telegram bot as the default fallback.

## Verification

- Completed:
- `pnpm exec vitest run apps/web/test/start-experiment-contact.test.ts apps/web/test/start-experiment-button.test.ts apps/web/test/experiment-detail-client-contract.test.tsx apps/web/test/results-tab-client.test.tsx apps/web/test/experiment-detail-private-run.test.tsx apps/web/test/experiment-header.test.ts --config apps/web/vitest.workspace.ts --no-coverage` passed.
- `pnpm --dir apps/web typecheck` passed.
- `pnpm --dir apps/web lint` passed.
- `git diff --check` passed.
- Browser proof: signed-out desktop and mobile experiment CTA clicks open the hosted auth dialog before any contact route opens.
- Required audit passes found privacy/routing gaps; repairs removed raw linked-account serialization, required a validated Murph SMS target before using Messages as a connected text channel, routed the Results empty-state CTA through the shared start button, and aligned direct Telegram opens with the dialog target behavior.
Completed: 2026-04-29
