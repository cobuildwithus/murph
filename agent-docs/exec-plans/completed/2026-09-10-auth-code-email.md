# Polish sign-in code email

Status: completed
Created: 2026-09-10
Updated: 2026-09-10

## Goal

- Make the sign-in code easy to find and copy in a restrained Murph email.

## Success criteria

- HTML and text carry the same six-digit code, including a leading zero.
- Existing plain-text senders and sanitized failure behavior remain intact.
- Inspect desktop and phone rendering; deliver an authorized inbox preview.

## Scope

- In scope: auth email template, optional HTML in the existing delivery owner, focused proof.
- Out of scope: session behavior, SMS configuration, auth cutover, other email templates.

## Constraints

- Inline email-compatible styles, system fonts, no image dependency, no new package.
- Keep migration candidates unchanged; this is a separate follow-up PR.

## Risks and mitigations

1. Shared sender regression: prove existing plain-text payloads and error handling.
2. Unsafe markup: validate the only interpolation as exactly six ASCII digits.

## Tasks

1. Completed: added the template and connected multipart delivery.
2. Completed: focused tests, typecheck, lint, complexity and rendered inspection.
3. Completed: sent an authorized preview and reviewed the candidate for a scoped PR.

## Decisions

- Product UX effort: Patch. Members retrieve a code from a phone or desktop inbox in daylight; light warm neutrals and a high-contrast code support a quick glance.
- The code panel is the only contained element. Use email-compatible hex colors and inline styles instead of unsupported modern color syntax.
- No image generation is needed for a typography-only transactional email.
- Preserve the current subject and plain-text copy. Auth protocol and expiry ownership do not change.

## Verification

- Passed: `pnpm exec vitest run --config apps/web/vitest.workspace.ts --no-coverage apps/web/test/better-auth-request-boundaries.test.ts apps/web/test/hosted-resend-plain-text-email.test.ts` (19 tests).
- Passed: `pnpm --dir apps/web typecheck` and focused ESLint across the five authored TypeScript files.
- Passed: `pnpm complexity:diff --base HEAD`; no changed hotspot above 20.
- Chromium render at 320, 390 and 1280 pixels: no horizontal overflow, code present, no images; phone and desktop screenshots inspected.
- Actual application delivery sent one authorized HTML/text preview. Provider returned HTTP 200 and reported sent; recipient rendering remains external confirmation.
- Product UX result: Ready for candidate review. Plain text, leading-zero code, invalid-code rejection and sanitized provider errors remain covered.
- Required exact-head CI and final ReviewGPT remain PR merge gates. This record does not claim production deployment or auth cutover.
Completed: 2026-09-10
