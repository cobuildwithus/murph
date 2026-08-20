# Public email bootstrap

Status: active
Created: 2026-08-20
Updated: 2026-08-20

## Goal

- Let an existing Murph member begin an email conversation through the fixed
  public Murph mailbox without treating a spoofable first message as member
  authority.
- Route the member into the existing private reply-alias path with the least
  possible extra friction.

## Success criteria

- The fixed public route handles a candidate before raw MIME parsing, body or
  attachment persistence, mailbox append, model execution, tools, or runtime
  wake.
- Web resolves only a canonical blinded verified-email lookup, rechecks active
  and unsuspended membership, and owns the transactional bootstrap claim.
- The fixed bootstrap goes only to the member's current verified email and puts
  the current personal Murph alias in `Reply-To`.
- Duplicate provider delivery, cooldown, member daily limits, and a global
  ceiling cannot create duplicate or unbounded sends.
- Authenticated website actions that already know the member's private alias
  preserve the prepared request as the first assistant turn instead of routing
  that intent through the public bootstrap.
- Existing signed personal aliases continue to process ordinary member replies.
- Focused tests, typechecks, required ReviewGPT gates, exact-head CI, and parent
  review pass.

## Product UX plan

### Outcome and promise

- Entry: an existing member sends an email to the advertised public mailbox.
- Promise: Murph safely recognizes that the address may belong to a member and
  sends a private continuation to the verified inbox.
- Limitation: the unverified original message is discarded and cannot be acted
  on; the member replies from the verified continuation and restates the
  request.

### Affected people

- An active existing member with a current verified email receives one concise
  continuation whose Reply-To is their personal Murph alias.
- A member already using the personal alias sees no behavior change.
- A suspended, deleted, unverified, unknown, or mismatched sender receives no
  account-existence disclosure and cannot start assistant work.
- A spoofing sender cannot make Murph expose data, run tools, preserve their
  message, or deliver a reply to the spoofed address outside the current
  verified-email owner.
- Duplicate and abusive traffic converges through deterministic claims and
  bounded limits rather than producing repeated email.

### Proof path

- Exercise successful bootstrap, unknown/ineligible sender, provider replay,
  cooldown/day/global limiting, address change, alias revocation, callback
  failure, and the early no-persistence/no-model boundary.
- Replay the existing signed-alias flow to prove current members remain intact.

## Scope

- In scope: Cloudflare fixed-public ingress, Web-owned bootstrap callback and
  persistence, personal alias provisioning/revocation, cleanup/retention,
  durable architecture/security/reliability docs, and focused tests.
- Out of scope: accepting the original public message as authority, persisting
  its content, group-route redesign, deployment, or production mutation.

## Constraints

- Reply eligibility and SMTP headers are not authentication authority.
- Store only secret-derived lookup material needed for resolution; never store
  raw public-message content or unverified sender identity as member truth.
- Reuse current hosted-email transport, signing, routing, and Web transaction
  owners. Add no independent queue or scheduler.
- Web must deploy before the Worker begins calling the additive bootstrap
  callback; rollback the Worker first.

## Tasks

1. [completed] Recover and inspect the ReviewGPT-authored patch.
2. [completed] Apply the patch in the isolated task worktree and inspect every
   changed trust boundary.
3. [completed] Run focused tests, typechecks, migration checks, and Product UX
   walkthrough; resolve failures.
4. [in_progress] Create the candidate commit/PR and run the required specialist and
   final ReviewGPT gates with exact-head CI.
5. [pending] Resolve findings, close the plan, and prove current-base
   mergeability.

Pull request: #2083

## Decisions

- Do not use Cloudflare `message.reply()` for the first public message. It
  cannot provide the Web-owned transactional authorization, current-address
  reread, and idempotency boundary required before a member request is accepted.
- Prefer a private continuation sent to the current verified address with the
  personal alias in Reply-To. The original message is intentionally not quoted,
  retained, or processed.
- Authenticated Start Experiment and device-recovery actions keep their
  prepared intent on the current signed alias, so Murph can answer the first
  email directly. A public-address fallback contains only the fixed bootstrap
  request and explains the follow-up step.
- A confirmed Resend no-send result may retry after a one-minute backoff while
  still counting toward the three-attempt daily and 100-attempt hourly caps.
  Sent, sending, claimed, and ambiguous outcomes retain the 15-minute cooldown.
- Cloudflare's inbound Worker contract does not expose a trusted sender-auth
  verdict before application work. Its reply eligibility check happens at
  provider send time and therefore cannot authorize earlier model or tool work.
- Alias cryptography is prepared before the member transaction. The locked
  transaction revalidates the prepared generation and verified-email blind
  index, then atomically rotates or clears the stored capability.
- The additive migration leaves legacy alias generations nullable and treats
  null as generation zero, keeping the predeploy path expand-only.
- Interactive email authentication prepares alias rotation from Privy's fresh
  live identity rather than the bearer snapshot. A stale A/live B rebind
  therefore revokes A's old reply capability in the same transaction that
  stores B, while A/A or B/B agreement keeps the generation stable.
- The global hourly-cap advisory lock is nonblocking. A collision is silently
  suppressed before the member lock or attempt read, preventing public bursts
  from filling the shared Web pool while the admitted winner waits on a member
  row.

## Product UX walkthrough

Result: Ready.

- Active existing member: the advertised address opens in the same mail-app and
  webmail entry points, and the fixed continuation arrives at the current
  verified inbox with the current private reply alias.
- Authenticated guided action: Start Experiment and device-recovery email
  actions target the signed private alias with their prepared request, allowing
  Murph to answer that initial outreach without a fixed bootstrap response.
- Public fallback: the visible recovery copy explains the private-reply step,
  expected few-minute wait, and resend recovery without putting device or
  experiment intent into the unauthenticated public message.
- Existing alias user: signed-alias replies retain the current direct path.
- Unknown, inactive, suspended, deleted, mismatched, or limited sender: the
  public route accepts and drops without an account-existence signal.
- Address rotation: the old alias stops resolving atomically; a missing alias
  is restored only at the current generation.
- Exclusion: the original public message cannot be a first assistant turn until
  the ingress platform exposes trustworthy sender authority before processing.

## Verification

- Cloudflare focused hosted-email ingress and route proof: 5 files, 81 tests
  passed.
- Review remediation proof: 7 Web files, 156 tests passed; 2 Cloudflare files,
  31 tests passed; the broader Cloudflare node suite passed 2,601 tests with 2
  skips.
- Redacted production-component Playwright captures were inspected at desktop
  and phone viewports for the Start Experiment private-alias chooser and the
  public device-recovery fallback. The local Cloudflare Images uploader could
  not publish them because its optional credential was unavailable; the local
  images remain in the ignored ReviewGPT evidence packet.
- Web bootstrap, callback, alias rotation, Privy onboarding, settings,
  retention, deletion, migration, delivery, and contact-surface proof: 16
  files, 505 tests passed.
- Hosted-execution package: 49 files, 543 tests passed.
- Runtime-state package: 29 files, 214 tests passed.
- Cloudflare, Web, hosted-execution, and runtime-state typechecks passed.
- Prisma schema validation passed.
- Changed Web TypeScript/TSX ESLint passed with zero warnings.
- `git diff --check` passed.
- Preliminary ReviewGPT Product UX and coverage lenses returned substantive
  findings plus an unusable-evidence verdict. Accepted findings were resolved
  by preserving guided-action intent, adding status-aware retry, adding the
  requested bounded-stream/cardinality coverage, and supplying rendered proof.
- Final cross-cutting ReviewGPT security/reliability review.
- ReviewGPT round 2 found stale-bearer alias preparation and blocking global
  lock contention. Both findings were reproduced and fixed. Focused unit proof
  passed 92 tests with one gated PostgreSQL test skipped; isolated real
  PostgreSQL proofs passed alias rotation/stability and an eight-collision pool
  contention replay with no advisory waiters.
- Required exact-head CI and current-base merge-tree proof.
