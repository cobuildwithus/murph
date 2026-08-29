# Stateless calendar links

Status: completed
Created: 2026-08-28
Updated: 2026-08-29

## Goal

- Let Murph prepare an explicit appointment as a first-party calendar link that
  opens a clear Web review surface and hands one standards-compliant `.ics`
  event to the member's calendar app for final confirmation.

## Success criteria

- In a private direct Linq text conversation, Murph can create one terminal
  `https://www.withmurph.ai/calendar/<payload>` link from an explicit title,
  start, end, and UTC offset without claiming the event was already added.
- The bounded payload is self-contained and stateless. It creates no database,
  signing, expiry, generated-file persistence, approval, or special outbox path.
- The Web page validates and displays the event, exposes one obvious calendar
  action, attempts the handoff once, and retains a button fallback.
- The calendar resource emits valid UTF-8 iCalendar with UTC timestamps, CRLF,
  text escaping, and 75-octet line folding.
- Message previews are generic and do not expose event details.
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
  phone happy path, missing-detail clarification, invalid-link recovery, and
  desktop fallback; preserve calendar-app confirmation as the only add boundary;
  keep the implementation smaller and more composable than the supplied
  attachment patch; use the isolated worktree/PR workflow and complete both
  required ReviewGPT stages because the user explicitly requested the loop.

## Risks and mitigations

1. Risk: a long notes field produces a URL a messaging app cannot preview
   reliably. Mitigation: one envelope-size check against the existing provider
   URL limit; return a clear tool error instead of adding storage or compression
   machinery.
2. Risk: a mobile browser does not launch the calendar resource automatically.
   Mitigation: attempt the handoff once per payload and keep the same resource
   behind a visible button; do not add runtime state or browser-specific forks.
3. Risk: generated calendar bytes encode a different instant or malformed text.
   Mitigation: require offset-bearing timestamps, reject reversed intervals, and
   cover the pure serializer with focused tests.
4. Risk: contract-valid unbroken text overflows a narrow phone viewport.
   Mitigation: allow wrapping at the title, event-fact, and notes boundaries and
   inspect a maximum-length synthetic event at the narrow viewport.

## Tasks

1. Add the compact shared event envelope and focused contract tests.
2. Add the Web review page, generic metadata image, calendar resource, and
   reviewer-openable design representation.
3. Add the direct-message assistant link tool and deterministic/live journey
   proof without changing the ordinary reply or outbox architecture.
4. Add the member-visible changelog entry and finish the Product UX walkthrough.
5. Run focused checks and browser proof, commit, push, and open the draft PR.
6. Remediate the accepted narrow-phone and production-planner evidence findings
   without narrowing direct Linq service support or redesigning the URL format.
7. Run the final ReviewGPT loop with CI, complete the parent review, and close
   the plan.

## Decisions

- The URL payload is intentionally unsigned because it carries no authority and
  the member confirms the only external effect in their calendar app.
- The calendar bytes are served from a resource route under the calendar URL,
  not an `/api` namespace.
- Event details stay out of Open Graph metadata so lock-screen and rich-link
  previews reveal only the action.
- Calendar-link admission intentionally follows direct Linq text routing rather
  than a provider service-name check; SMS and RCS recipients can use the same
  standards-based `.ics` handoff when their phone supports it.
- The existing bounded stateless URL design remains unchanged.
- The runtime, rather than the model, owns the exact opaque URL suffix because a
  real-Codex journey proved that model copying can alter a payload character.
  Murph's semantic reply remains model-authored so verified appointment-reminder
  results are preserved beside the link. This remains turn-local and adds no
  state or service.
- The focused compound-action live journey exposes the existing automation
  schema eagerly in its test harness to isolate reminder-plus-link composition;
  production retains deferred automation discovery, whose planner and routing
  boundaries have separate deterministic and live proof.
- A confirmed same-turn live-follow-up race remains unchanged by explicit
  product choice; this task does not add context invalidation for an
  undelivered calendar link after a newer correction or cancellation.

## Product UX walkthrough

- Direct text happy path: the production planner admits the tool after an
  accepted direct Linq input; the real-Codex reply preserves one verified
  one-shot appointment reminder and is followed by the exact calendar URL,
  with no claim that the event was added.
- Missing details: the existing tool instructions still ask for all missing
  title/time/offset details together before constructing a link.
- Narrow phone: the title, fact values, and notes can wrap maximum-length
  unbroken contract-valid text; local 320/390/1280 browser proof passes, and the
  primary action uses the regular rounded button treatment with its arrow.
- Invalid and desktop paths: the unchanged recovery surface and downloadable
  `.ics` fallback remain available, with calendar-app-neutral confirmation copy.

## Verification

- Commands to run: focused contract, Web route/component, assistant tool, and
  production turn-planning tests; owner typechecks; `git diff --check`; privacy
  scan; responsive design proof through the repository Playwright lane; one
  focused real-Codex journey; required exact-head GitHub checks; preliminary
  specialist ReviewGPT; final ReviewGPT rounds; current-base merge-tree proof.
- Expected outcomes: all focused checks pass, rendered happy/invalid states are
  usable on phone and desktop, the real reply is accurate and ends in the link,
  CI is green, and both ReviewGPT stages have no unresolved accepted finding.
- Current results: assistant calendar/planner/scripted tests pass (8); Web
  calendar tests pass (6); assistant and Web typechecks pass; scoped Web lint
  passes; `git diff --check` and the identifier scan pass; the focused
  real-Codex compound reminder-and-link journey passes on `gpt-5.6-terra` at
  medium reasoning with one accepted reminder save, a Ready UX verdict, and the
  exact runtime-owned URL suffix. Local 320/390/1280 browser proof passes for
  the review page, including the rounded primary action. Required exact-head
  GitHub checks pass. The official final full-snapshot ReviewGPT gate selected
  GPT-5.6 Sol, completed in roughly 40 minutes, and returned
  `ROUND_OUTCOME: PASS` with no qualifying findings; its canonical attestation
  path accepted the UI selection plus the backend model slug under the
  repository's bounded `MODEL_CONFIRMATION: UNKNOWN` fallback. Exact-head
  deployed proof remains required after merge.
Completed: 2026-08-29
