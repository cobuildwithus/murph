# Use the real logo and center auth email codes

Status: completed
Created: 2026-09-10
Updated: 2026-09-10

## Goal

Use the canonical Murph logo in the auth email, center its code vertically and preserve easy text selection.

## Scope and decisions

- Export the existing public logo.svg at 3x as a small PNG on the email background. Embed it using Resend's inline attachment support; no remote image request or runtime conversion.
- Keep the code as one contiguous text node, with no inserted spaces or grouping marks. Use an email-compatible table cell with middle alignment and a readable numeric font.
- Product UX effort: Patch. Inspect narrow phone and desktop inbox layouts and the image-blocked fallback.
- Preserve auth protocol, session, expiry, plain-text fallback, sender authority, timeout and error behavior.
- The earlier completed email plan remains immutable; this record owns the requested visual follow-up.

## Tasks

1. Completed: canonical logo export and inline attachment through the existing sender.
2. Completed: rendered centering and double-click selection; focused tests and typecheck.
3. Completed: reviewed the follow-up candidate for the existing PR without changing migration heads.

## Verification

- Passed: 19 focused tests across auth request boundaries and shared Resend delivery, including the inline PNG's MIME fields and signature.
- Passed: Web typecheck, focused ESLint and `pnpm complexity:diff --base 75dc362ab6c5f31be8c369d9386478c6c07d4861`; no hotspots above 20.
- Passed: real-template Chromium rendering at 320, 390 and 1280 pixels. No overflow; the 96px panel's rendered digit ink is centered within one pixel. Double-click selects exactly the six digits at all widths. The code remains readable with images blocked.
- Inspected phone and desktop screenshots and opened them for visual review.
- Sent one authorized revision preview through actual application delivery. Provider accepted HTTP 200 and confirmed delivered; no auth session was created.
- Product UX result: Ready. No change to login or session behavior.
- PR-level CI and final review remain merge gates; the initial candidate's checks do not qualify this revision.
Completed: 2026-09-10
