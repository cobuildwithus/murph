# Plain group report labels and PR completion

Status: active
Created: 2026-09-22
Updated: 2026-09-22

## Goal

- Render safe owner contact names directly in group reports, then prepare the
  complete stable-label fix for PR review and CI.

## Success criteria

- No unverified/contact-source suffix appears in report labels or scheduled replies.
- Profile precedence, membership/consent/phone checks, duplicate-name handling,
  stable pseudonyms, and shared-data preservation remain intact.

## Scope

- In scope: report presentation, cross-source collision proof, scheduled live
  assistant proof, documentation, changelog, and PR candidate preparation.
- Out of scope: loosening identity or consent checks, merging, and deployment.

## Constraints

- Use the existing displayName response field. No new state or protocol.
- The previous completed plan remains historical; this follow-up changes only
  how report contact names are presented.

## Risks and mitigations

1. A plain contact name can equal another participant's profile name.
   Mitigation: exercise the existing host disambiguator across both sources.

## Tasks

1. Remove the report suffix and add cross-source collision coverage.
2. Verify host output, scheduled replies, types, and rendered changelog.
3. Prepare the draft PR and stable candidate; record external review/CI in the PR.

## Decisions

- Product UX patch: contact-named people receive their plain name; duplicate
  names receive existing disambiguators; unknown names retain stable pseudonyms.
- Contact source uncertainty remains an internal matching concern, never
  membership, consent, or effect authority.

## Verification

- Focused shared-label/shared-read Web tests, Web and assistant typechecks,
  ESLint, real-Codex scheduled label journey, changelog rendering, complexity.
- PR completion additionally requires current-head CI and routed ReviewGPT.
