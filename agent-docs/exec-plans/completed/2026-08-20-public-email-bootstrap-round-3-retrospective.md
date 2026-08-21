# Public email bootstrap round-3 retrospective

Status: completed
Created: 2026-08-20
Updated: 2026-08-20

## Trigger

ReviewGPT round 3 returned `RETROSPECTIVE_REQUIRED`. This was the mandatory
round-three scope gate, not a new tactical finding. The review confirmed that
both round-two production corrections are present and that neither repeats a
previously accepted mechanism.

## Original requirement

- Existing verified Murph members may start from the canonical public email
  address without letting a spoofable raw message authorize private assistant
  work.
- Authenticated guided actions that already know the current signed personal
  alias must preserve the prepared subject and body, so Murph can answer that
  initial outreach directly.
- Raw public-address mail remains a content-discarding, two-step bootstrap: Web
  sends a fixed continuation to the current verified inbox, and the member's
  reply through the private alias becomes the first assistant input.

## First-reviewed versus current shape

- First-reviewed head: `57f968521e85aa0c3404bfe20579ca80aa6f9f28`.
  Relative to its task base, it changed 52 files with 2,565 additions and 331
  deletions. It contained the complete original feature: bounded Cloudflare
  ingress, the signed callback, Web admission and provider handoff, the durable
  attempt record and migration, alias generation, retention/deletion, product
  surfaces, documentation, and proof.
- Current retrospective head: `37ef5e5681d945ddf4ab38492505afec868a9c30`.
  Relative to its current PR base, it changes 65 files with 3,419 additions and
  358 deletions. ReviewGPT classified 1,618 of those changed lines as authored
  production source, below the 2,000-line source-churn threshold.
- Two merge commits integrated advancing `main`. Their large first-to-current
  history is unrelated repository work and is not feature or review-driven
  growth; the current-base PR diff above excludes it.
- The first-to-current product requirement is unchanged. No later round added
  a new delivery channel, authentication authority, queue, scheduler, lease,
  retry worker, reconciliation lifecycle, or compatibility state.

## Review-driven growth and disposition

1. The preliminary coverage correction changed two test files with 18
   additions and one deletion. Retain it: it proves the privacy schema guard at
   the exact boundary and adds no production concept.
2. Specialist remediation changed 17 files with 378 additions and 41
   deletions. Retain it: authenticated guided actions now use the private alias
   without losing intent; provider-confirmed no-send outcomes have the bounded
   one-minute retry; bounded-stream and exact-cardinality tests close requested
   proof gaps; rendered states and durable docs describe the same design.
3. The two round-two final-gate corrections changed ten files with 513
   additions and 40 deletions. Only two production files changed: 17 additions
   and 12 deletions, a net five-line increase. The remaining change is unit,
   real-PostgreSQL, and durable-documentation proof. Retain it: live Privy email
   now owns alias preparation, and the global cap lock now sheds collisions
   without waiting.
4. From round two to round three, the current-base PR grew from 62 to 65 files
   and from 3,288 to 3,777 changed lines. ReviewGPT attributed the five-line
   authored-production increase to the two corrections; the rest is their
   requested regression evidence. No review addition is an independent runtime
   owner that can be deleted without removing production-faithful proof.

## Concepts and owners ledger

| Concept | Owner | Decision |
| --- | --- | --- |
| Bounded public header ingress | Cloudflare email Worker | Retain; it discards raw content before MIME parsing, storage, or runtime work. |
| Signed Worker-to-Web callback | Existing hosted-execution callback authentication | Retain; it carries only the normalized candidate address. |
| Bootstrap admission transaction | Web hosted-onboarding service | Retain; it remains the single authority for member/access rechecks, limits, and attempt creation. |
| Global hourly-cap lock | The same Web admission transaction | Narrow; use one transaction-scoped nonblocking advisory acquisition and silently shed collisions. |
| Member cooldown and daily cap | Member row plus bounded attempt reads | Retain; no second limiter or cache is introduced. |
| Short-lived attempt record | `hosted_email_public_bootstrap_attempt` | Retain; it owns provider idempotency, terminal ambiguity, exact caps, and two-day cleanup. |
| Verified-email authorization | Existing Web member email-authorization owner | Retain; the public sender remains only a blind-index candidate. |
| Personal reply capability | Existing member routing row and alias generation | Retain and narrow; fresh Privy identity prepares the capability and the member transaction rotates it with email authority. |
| Provider entry | Existing Resend plain-text delivery owner | Retain; the fixed continuation goes only to the current verified inbox with the current alias in `Reply-To`. |
| Retention and deletion | Existing hosted retention and account-deletion owners | Retain; the attempt record has no independent cleanup service. |
| Guided prepared intent | Existing authenticated Start Experiment and device-recovery surfaces | Retain; these one-step paths bypass the public bootstrap and target the signed alias. |

Removed review direction: the public address is not used as the intent-bearing
target for authenticated guided actions. No production owner was removed after
the first-reviewed head; the corrections narrowed which existing authority each
owner consumes.

## Architecture decision

Decision: explicitly justified continuation of the current PR.

- Deletion would remove the requested discoverable entry point for existing
  members.
- Reverting either review correction would restore a demonstrated private-alias
  revocation flaw or a shared database-pool exhaustion path.
- Further shrinking would remove the real-PostgreSQL evidence for those exact
  concurrency and capability boundaries without simplifying production.
- Splitting the Worker, callback, migration, alias rotation, and admission
  owner would create deploy states where the advertised route is unsafe or
  unavailable. They form one end-to-end safety outcome and already have an
  explicit migration-to-Web-to-Worker rollout order.
- A redesign around direct raw-message processing cannot prove mailbox control
  before model or tool work. A queue, challenge state machine, or retry service
  would add owners while preserving the same necessary second step.
- Silent nonblocking collision suppression is acceptable because raw public
  email is explicitly best-effort discovery, the visible recovery copy gives a
  safe resend path, and suppression discloses no membership state. The exact
  caps remain owned by the one admitted transaction.

This direction preserves the irreducible experience boundary: authenticated
private-alias actions remain one step and retain the user's original prepared
intent; unauthenticated raw public mail never becomes assistant input.

Any later remediation that introduces a new production owner or expands raw
public mail authority exceeds this decision and requires another retrospective.

Completed: 2026-08-20
