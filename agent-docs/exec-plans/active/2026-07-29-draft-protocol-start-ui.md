# Hide the bedtime-transition draft and simplify experiment start handoff

Status: active
Created: 2026-07-29
Updated: 2026-07-29

## Goal

- Remove the Standard, Tiny, And Fallback Bedtime Transition protocol from every
  public and runnable Health Commons surface by returning it to draft status.
- Make the experiment start dialog compact, legible, and centered on the
  selected protocol rather than on repeated chrome.
- Prefill channel drafts with the human-readable experiment name only while
  preserving exact Health Commons revisions in the private run created from
  the protocol resolved during onboarding.

## Success criteria

- The named bedtime-transition protocol is absent from generated public route,
  browse, index, and runnable artifacts.
- The start dialog shows the full protocol title without truncation at desktop
  and phone widths, uses compact channel rows, and remains keyboard-accessible.
- Text, Telegram, and email drafts contain only the concise start sentence and
  no protocol key or revision hash.
- Legacy structured protocol-reference messages remain supported by the
  assistant, but new public drafts no longer generate them.
- The production dialog is represented on the Components design-catalog tab
  and has redacted desktop and mobile proof.
- Focused Health Commons and web tests, web typecheck/lint, design proof, exact
  PR-head CI, and required reviews pass.

## Scope

- In scope:
  - Health Commons status for the named protocol and its focused content test.
  - Public start-draft construction and the protocol-reference props used only
    to generate those drafts.
  - Start-channel dialog layout, copy, responsive behavior, and component study.
  - Durable Health Commons and experiment-onboarding documentation for the
    name-first handoff and exact revision persistence.
- Out of scope:
  - Experiment run schema, outcome lineage, protocol hashing, or CLI compare-and-swap behavior.
  - Channel account routing, authentication, or outbound delivery.
  - A persisted server-side start-intent system.

## Constraints

- Technical constraints:
  - Reuse the existing channel resolver, native app links, dialog primitive,
    generated Health Commons filtering, and assistant protocol-discovery flow.
  - Do not add persisted state, dependencies, routes, services, or compatibility
    machinery.
  - Keep exact revisions on saved protocol-backed runs even though the visible
    draft no longer exposes hashes.
- Product/process constraints:
  - Preserve user review before send and do not add automatic messaging.
  - Keep the interaction compact, calm, and consistent with the warm-paper
    design system.
  - Use the guarded worktree/PR lane, design catalog proof, product review,
    preliminary ReviewGPT frontend/coverage review, Claude UI double-check,
    exact-head CI, and scoped plan-closing commit.

## Risks and mitigations

1. Risk: A name-only draft could resolve ambiguously.
   Mitigation: Keep the existing assistant protocol explore/list/show flow;
   require an exact protocol before planning and store the actual resolved
   revisions when the private run is created.
2. Risk: Removing hashes could accidentally remove saved-run lineage.
   Mitigation: Change only the public draft builder and its unused props; keep
   Health Commons revision generation and protocol-backed run creation intact.
3. Risk: Compacting the modal could hurt phone usability or focus behavior.
   Mitigation: Preserve the existing dialog primitive and full-width links,
   render the real component in the design catalog, and capture desktop/mobile
   browser evidence.

## Tasks

1. Change the named protocol to draft and update focused publishing assertions.
2. Remove revision metadata from public channel drafts and delete the now-unused
   frontend protocol-reference plumbing.
3. Restyle the start-channel dialog and update its design-catalog scenario.
4. Update the live product specs to describe name-first drafts and start-time
   exact revision capture.
5. Run focused tests, Health Commons verification, web typecheck/lint, browser
   proof, product review, preliminary ReviewGPT, Claude UI review, parent review,
   exact-head CI, and mergeability proof.
6. Close this plan with the final scoped commit once review remediation is done.

## Decisions

- Use `status: draft` rather than a separate hidden flag because draft status is
  already the canonical non-public, non-runnable publishing state.
- Keep the visible draft to one sentence. The assistant resolves the named
  protocol through the existing Health Commons discovery path; protocol-backed
  run creation remains the exact lineage owner.
- Redesign the existing component in place rather than adding a second dialog or
  channel-picker abstraction.

## Verification

- Commands to run:
  - `pnpm --dir packages/health-commons verify`
  - Focused Vitest for the start-contact, start-button, experiment projection,
    and Health Commons publishing tests touched by the change.
  - `pnpm --dir apps/web typecheck`
  - `pnpm --dir apps/web lint`
  - `pnpm test:frontend-design-proof`
  - Browser checks of `/design?tab=components` at desktop and phone widths.
  - Required product-experience, preliminary specialist, Claude UI, parent,
    exact-head CI, and mergeability gates.
- Expected outcomes:
  - No public artifact resolves the draft protocol.
  - No generated start URL contains a protocol key or SHA-256 revision.
  - The dialog is fully readable and operable at both captured viewports.

### Evidence recorded

- `pnpm --dir packages/health-commons verify`: passed, 19 files and 92 tests.
- Focused web Vitest: passed, 3 files and 22 tests.
- Focused assistant-engine Vitest: passed, 1 file and 16 tests.
- Focused Health Commons publishing/content Vitest: passed, 2 files and 6
  tests.
- `pnpm --dir apps/web typecheck`: passed.
- `pnpm --dir apps/web lint`: passed with no errors; task-scoped lint passed
  without warnings.
- `pnpm test:frontend-design-proof`: passed, 10 tests.
- The real dialog rendered on `/design?tab=components` at 1440x1000 and
  390x844. The full title, three channel rows, and review reminder are visible
  without dialog scrolling at both sizes.
- Hosted design proof:
  - Desktop:
    `https://imagedelivery.net/TDuhqfLDl0Fb8RGwGw6mYw/0e2f347e-9811-46ec-4061-b54cc3a55100/public`
  - Mobile:
    `https://imagedelivery.net/TDuhqfLDl0Fb8RGwGw6mYw/5ae2189b-e3fc-4667-cd21-5d971851b900/public`
- Claude Fable UI double-check was attempted after the final rendered state and
  stopped at explicit usage-credit exhaustion, as required.
- Product-experience review: `NO FINDINGS`. It accepted the chooser as the
  smallest complete experience and the rendered evidence as sufficient. The
  remaining evidence gap is that the name-first assistant handoff is specified
  and instruction-tested rather than exercised through a production-faithful
  dry-run plus real-start scenario.
- Preliminary specialist ReviewGPT: `SPECIALIST_OUTCOME: FINDINGS`.
  - Accepted prompt finding: an exact named protocol could compete with a
    discovery `starterCandidate` or generic same-family preference. The skill
    now makes one unique exact title/alias match authoritative, requires
    clarification otherwise, forbids substitution without explicit agreement,
    and scopes mismatch recovery separately for name-first and legacy inputs.
  - Accepted frontend finding: compact links had a low-contrast focus ring.
    Restored the semantic focus border/ring and proved a focused Telegram row
    is visible and unclipped at both viewports.
  - Accepted coverage finding: added opt-in real-Codex probes using the existing
    harness and a deterministic fake `vault-cli` for exact-match-over-starter,
    identical revision flags on dry-run/real start, and no real or unpinned
    retry after a mismatch. The live `gpt-5.6-terra` lane cannot run locally
    because neither approved provider key is configured; the test parses and
    the package typecheck passes.
  - Patch artifact: none.
- Focused-state design proof:
  - Desktop:
    `https://imagedelivery.net/TDuhqfLDl0Fb8RGwGw6mYw/b46a448b-e204-4196-74eb-44afaa6b7300/public`
  - Mobile:
    `https://imagedelivery.net/TDuhqfLDl0Fb8RGwGw6mYw/495131e4-8ca2-4f5d-898d-013aa4663e00/public`
- Fresh product experience re-review after accepted specialist changes:
  `NO FINDINGS`. The reviewer confirmed the exact-match precedence,
  mismatch recovery, visible focus treatment, and compact chooser preserve the
  smallest complete experience. The live real-Codex lane remains an evidence
  gap because no approved provider credential is configured. The opt-in probe
  was tightened after the review to use the actual public name-only sentence
  without an extra instruction rejecting the competing starter candidate.
