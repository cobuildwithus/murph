# Enrich signup notifications with coarse location, local time, and source

Status: active
Created: 2026-08-20
Updated: 2026-08-21

## Goal

- Replace opaque member and provider identifiers in the internal signup email
  with a concise activation summary: coarse signup location when Vercel supplies
  it, signup time in the member's local time zone, and the signup surface.
- Preserve the existing once-per-member, post-activation Resend owner and keep
  signup context private, encrypted, bounded, and short-lived.

## Success criteria

- Website and native companion authentication capture a closed V1 signup
  context containing only server time, a closed surface, normalized IANA time
  zone, and normalized coarse city/region/country headers.
- The context is encrypted with the existing member Web control root, first
  writer wins while the notification remains pending, reads stop disclosing it
  after 24 hours, the existing hourly retention owner clears overdue rows, and
  the attempt claim clears it atomically before provider entry.
- The email omits member ID and Stripe event metadata, uses a location-aware
  subject when possible, explicitly labels network location as approximate, and
  renders the signup date/time in the captured local time zone.
- Context-free activation paths still send a truthful fallback notification.
- Focused Web tests, typecheck, migration/schema checks, required ReviewGPT
  gates, and exact-head CI pass on a pushed PR.

## Scope

- In scope: authenticated Web and companion signup-context capture; encrypted
  pending storage and bounded retention; notification formatting/consumption;
  the additive schema migration; focused tests; current architecture,
  security, and Web owner docs.
- Out of scope: precise coordinates or postal code, analytics, permanent
  location history, member-visible mail, notification recipient changes, and
  changes to activation or billing authority.

## Constraints

- Technical constraints: no provider/KMS work inside database transactions;
  reuse prepared control roots; preserve canonical access checks, durable
  per-member claiming, plain-text Resend delivery, and sanitized logs.
- Product/process constraints: coarse IP location is advisory display data,
  never identity or authorization; no changelog item; use the worktree/PR lane
  and exact pushed-head completion reviews.

## Product UX walkthrough

- Internal recipient: gets a concise notice with no opaque IDs. Captured Web or
  companion context says `Signed up via`; an exact context-free activation path
  says `Activated via`; a batch path with no per-member provenance omits the
  source. Network location is visibly approximate in both subject and body.
- Member represented by the notice: has no IP address, coordinates, or postal
  data retained or emailed. The bounded network projection is encrypted only
  while the one-shot notice is pending, then the database clears it before
  provider egress even if an older application runner performs the claim.

## Risks and mitigations

1. Risk: IP-derived location is personal and can be absent or inaccurate.
   Mitigation: capture only bounded coarse fields, call the network projection
   approximate, encrypt before persistence, omit missing values, and clear the
   ciphertext at the durable attempt claim.
2. Risk: mixed deploy versions observe the new column.
   Mitigation: use one nullable additive column plus a database-owned clear
   trigger; old Web ignores the column, and even an old attempt-only claim
   clears pending ciphertext before the row update completes.
3. Risk: an activation mechanism can be mistaken for the member's signup path.
   Mitigation: distinguish captured signup surface from fallback activation
   surface and omit the source for multi-member billing activation without
   exact member-level provenance.
4. Risk: notification enrichment moves work onto activation transactions.
   Mitigation: use the already-prepared local encryption root inside the auth
   transaction; all email reads, claim, formatting, and provider work remain in
   the existing post-commit task.
5. Risk: a member who never activates, or a pre-claim read failure after
   activation, can leave the encrypted projection without an attempt claim.
   Mitigation: persist a 24-hour expiry beside the ciphertext, refuse to decrypt
   at or after expiry, and reuse the existing hourly retention sweep with a
   partial expiry index, bounded batches, and `SKIP LOCKED` claims.
6. Risk: optional context decryption can fail before the durable attempt claim
   and suppress the context-free notice.
   Mitigation: degrade only the optional context projection to `null`, retain
   the trusted member creation time, and continue through the existing fallback
   formatter, attempt claim, and provider path.

## Tasks

1. Add the closed request-context codec and focused normalization tests.
2. Add encrypted first-write/consume storage and an additive migration.
3. Capture context at Web and companion authenticated signup boundaries.
4. Render local time, source, and coarse location in the existing email while
   removing member and Stripe identifiers.
5. Update owner docs, run focused verification, inspect the final diff, and
   complete the PR review/CI loop.

## Decisions

- Keep activation, not account-row creation, as signup-notification authority.
- Store one encrypted pending blob on `hosted_member`; no new service, queue,
  or permanent analytics owner is introduced.
- Preserve request context for the normal immediate-activation window because
  it is required for the requested local-time/location notice, but cap that
  projection at 24 hours. Reuse the existing hourly hosted-retention owner with
  one expiry timestamp and one partial index; do not add another cron, queue,
  or lifecycle service.
- Use Vercel's documented city, country-region, and country request headers;
  do not retain latitude, longitude, IP address, postal code, or provider
  payloads.

## Round-three retrospective

- The final privacy review correctly found that attempt-trigger cleanup alone
  did not terminate context for never-activated members or failures before the
  claim. That invalidated the earlier assumption that no lifetime owner was
  necessary.
- The product outcome still requires a short pre-activation handoff so the
  eventual notice can report the actual signup request rather than activation
  fallback. The smallest bounded correction is therefore one 24-hour expiry on
  the same row plus the repository's existing hourly retention owner. This
  adds no independent process or durable history and also retires any malformed
  context that is missing its expiry.

## Recovered round-four findings

- The accepted exact-head round completed after PR #2112 had already merged,
  but its waiter did not persist the response. An exact-thread export recovered
  `ROUND_OUTCOME: FINDINGS` for the merged `fe9c0c0829` head.
- Accepted product failure: an unreadable live encrypted context threw before
  the durable attempt claim, so the outer best-effort wrapper could permanently
  lose the one-shot notice. The correction reuses the existing `context: null`
  fallback and adds no retry owner or state.
- Accepted simplification: the final migration no longer needs the
  review-induced repository-wide SQL statement lexer. Restore the bounded
  whole-file migration guard and delete the lexer-only regression. Retain the
  existing Frog entry because its synthetic cross-statement false positive is
  still a reproducible tooling limitation even though this migration no longer
  needs a parser fix.
- Because the reviewed head was already merged, land both corrections in a
  dedicated follow-up PR from current `main` and run that PR's ordinary
  specialist/final ReviewGPT and CI gates with a new immutable baseline.

## Verification

- Commands to run: focused Vitest slices for request context, member store,
  Privy/companion handoff, Starter/Stripe notification scheduling, and email
  formatting; Web prepared typecheck; Prisma format/validation and migration
  guards; `git diff --check` and identifier scan.
- Expected outcomes: all focused commands pass, the generated Prisma client
  reflects both nullable context columns, the PostgreSQL trigger proof clears
  both fields, no private identifiers enter the diff, and exact-head required
  CI plus ReviewGPT report no unresolved finding.
