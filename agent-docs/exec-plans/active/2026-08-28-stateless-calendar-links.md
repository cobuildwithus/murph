# Stateless calendar links

Status: active
Created: 2026-08-28
Updated: 2026-08-28

## Goal

- Let Murph prepare an explicit appointment as a first-party calendar link that
  opens a clear Web review surface and hands one standards-compliant `.ics`
  event to Apple Calendar for the member's final confirmation.

## Success criteria

- In a private direct Linq/iMessage conversation, Murph can create one terminal
  `https://www.withmurph.ai/calendar/<payload>` link from an explicit title,
  start, end, and UTC offset without claiming the event was already added.
- The bounded payload is self-contained and stateless. It creates no database,
  signing, expiry, generated-file persistence, approval, or special outbox path.
- The Web page validates and displays the event, exposes one obvious calendar
  action, attempts the handoff once, and retains a button fallback.
- The calendar resource emits valid UTF-8 iCalendar with UTC timestamps, CRLF,
  text escaping, and 75-octet line folding.
- The Messages preview is generic and does not expose event details.
- Invalid or oversized links fail clearly, and desktop browsers can download the
  same calendar resource.
- Focused tests, responsive browser proof, a real-Codex assistant journey,
  exact-head CI, and the requested ReviewGPT loop resolve with no accepted
  finding outstanding.

## Scope

- In scope: one shared compact event envelope, one assistant link tool, one Web
  page, one calendar resource route, one generic OG image, an existing `/design`
  representation, focused tests, assistant journey proof, and changelog copy.
- Out of scope: direct calendar writes, accounts, OAuth, CalDAV, attendees,
  recurrence, alarms, database state, revocation, expiry, signatures, short-link
  services, group conversations, and attachment delivery.

## Constraints

- Technical constraints: reuse the existing unsigned base64url response-card
  precedent and the normal terminal-link delivery path; keep public URL length
  within the existing 2,048-character provider bound; accept event URLs only
  when HTTPS; keep validation at the URL and calendar-format boundaries.
- Product/process constraints: this is a Product UX Feature. Plan the direct
  iPhone happy path, missing-detail clarification, invalid-link recovery, and
  desktop fallback; preserve Apple's confirmation as the only add boundary;
  keep the implementation smaller and more composable than the supplied
  attachment patch; use the isolated worktree/PR workflow and complete both
  required ReviewGPT stages because the user explicitly requested the loop.

## Risks and mitigations

1. Risk: a long notes field produces a URL Messages cannot preview reliably.
   Mitigation: one envelope-size check against the existing provider URL limit;
   return a clear tool error instead of adding storage or compression machinery.
2. Risk: Messages or Safari does not launch the calendar resource automatically.
   Mitigation: attempt the handoff once per payload and keep the same resource
   behind a visible button; do not add runtime state or browser-specific forks.
3. Risk: generated calendar bytes encode a different instant or malformed text.
   Mitigation: require offset-bearing timestamps, reject reversed intervals, and
   cover the pure serializer with focused tests.

## Tasks

1. Add the compact shared event envelope and focused contract tests.
2. Add the Web review page, generic metadata image, calendar resource, and
   reviewer-openable design representation.
3. Add the direct-message assistant link tool and deterministic/live journey
   proof without changing the ordinary reply or outbox architecture.
4. Add the member-visible changelog entry and finish the Product UX walkthrough.
5. Run focused checks and browser proof, commit, push, and open the draft PR.
6. Run the preliminary specialist and final ReviewGPT loops with CI, remediate
   accepted findings, complete the parent review, and close the plan.

## Decisions

- The URL payload is intentionally unsigned because it carries no authority and
  the member confirms the only external effect in Apple Calendar.
- The calendar bytes are served from a resource route under the calendar URL,
  not an `/api` namespace.
- Event details stay out of Open Graph metadata so lock-screen and rich-link
  previews reveal only the action.

## Verification

- Commands to run: focused contract, Web route/component, assistant tool, and
  dynamic-catalog tests; owner typechecks; `git diff --check`; privacy scan;
  responsive design proof through the repository Playwright lane; one focused
  real-Codex journey; required exact-head GitHub checks; preliminary specialist
  ReviewGPT; final ReviewGPT rounds; current-base merge-tree proof.
- Expected outcomes: all focused checks pass, rendered happy/invalid states are
  usable on phone and desktop, the real reply is accurate and ends in the link,
  CI is green, and both ReviewGPT stages have no unresolved accepted finding.
