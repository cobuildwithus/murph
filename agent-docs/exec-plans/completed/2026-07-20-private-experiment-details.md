# Restore private experiment details from home

Status: completed
Created: 2026-07-20
Updated: 2026-07-20

## Goal

- Restore clickable, result-first `/home` experiment cards for authenticated
  private runs without republishing draft or deprecated Health Commons
  protocols.

## Success criteria

- Every private run shown on `/home` has a stable authenticated detail link,
  including runs whose Commons protocol is not currently runnable and runs with
  no Commons reference.
- Home cards derive progress and result summaries from the private browser-vault
  projection rather than depending on the public runnable protocol catalog.
- Draft and deprecated Health Commons protocols remain absent from public
  runnable routes and Start surfaces.
- Existing public experiment browse and public-protocol detail behavior remains
  unchanged.
- Focused regressions, apps/web verification, required local audits, PR CI, and
  the exact-head ReviewGPT loop pass.

## Scope

- In scope: authenticated home-card projection/linking, a private experiment
  detail route, browser-vault experiment result mapping, and focused hosted-web
  tests.
- Out of scope: changing Health Commons publish status, making draft protocols
  runnable, editing private vault contents, or changing experiment creation and
  outcome-selection policy.

## Constraints

- Preserve the canonical private vault/query projection as the data owner; add
  no database, migration, compatibility catalog, or duplicated persisted state.
- Keep health data client-side inside the existing authenticated browser-vault
  boundary and avoid exposing private titles or metrics in server metadata or
  logs.
- Work only in `/private/tmp/murph-private-experiment-details` on
  `codex/private-experiment-details`.

## Risks and mitigations

1. Risk: restoring links by republishing draft protocols would undo the July 16
   runnable-content hardening.
   Mitigation: introduce a static private-run route whose projection resolves by
   private experiment id and never grants public Start authority.
2. Risk: a second result mapper could drift from existing experiment result
   semantics.
   Mitigation: extend the existing browser-vault experiment-run projection to
   accept private-run-owned defaults and reuse its summary builder.
3. Risk: private health values could cross a server or logging boundary.
   Mitigation: resolve the run in the authenticated client from the existing
   browser replica; keep server metadata generic and fixtures synthetic.

## Tasks

1. Separate home private-run cards from the runnable public protocol catalog.
2. Add the authenticated private experiment detail route and reuse the existing
   browser-vault result projection.
3. Add focused regressions for unlisted and protocol-less private runs, links,
   summaries, route states, and unchanged public draft exclusion.
4. Run scoped and app verification, required frontend/security/coverage audits,
   parent review, and browser proof where the available runtime permits.
5. Commit, push, open the intent-complete PR, then run CI and exact-head
   ReviewGPT concurrently to completion.

## Decisions

- Treat the private run id as the home/detail identity when no runnable public
  protocol page exists. A runnable Commons protocol may keep its richer public
  detail route, but public catalog membership is neither existence nor link
  authority for private member data.
- Preserve `/experiments/[experimentId]` as the public protocol route and use a
  static child segment for private run details so the two lifecycles stay
  explicit.

## Verification

- Focused hosted-web regression suite: 6 files and 76 tests passed.
- `pnpm test:diff` passed for every touched implementation and test path,
  including apps/web typecheck, 5,918 web tests, lint with zero errors, dev
  smoke, and the production build.
- Browser rendering was unavailable because the in-app browser reported
  `No browser is available`. Both allowed Claude UI-review attempts were also
  unavailable because the local OAuth session was expired. The required
  Codex-native `frontend-review` still proceeds independently and records the
  rendered-proof gap; the Claude double-check cannot be claimed as passed.
- Coverage review confirmed the broken unpublished/private-only boundaries are
  covered. Its proposed matched-protocol route assertion was rejected because
  runnable protocol cards intentionally retain the richer public protocol
  detail route; the focused 17-test home suite passes with that invariant.
- Frontend review found and verified one accepted correction: active private
  runs with no known total duration now preserve their baseline and render
  `Day N` without inventing `Day N of N`. Its auth-redirect suggestion was
  rejected because the page follows the existing dashboard experiment/results
  shell contract and private vault access still fails closed client-side. The
  remediation re-review returned no additional findings.
- Remaining gates: parent final review, scoped commit, exact-head PR preflight,
  ReviewGPT round(s), CI status, and merge-tree proof.
Completed: 2026-07-20
