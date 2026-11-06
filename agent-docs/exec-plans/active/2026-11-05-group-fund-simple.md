# Simplify the group funding page and remove sponsorship personalization

Status: active
Created: 2026-11-05
Updated: 2026-11-05

## Goal

The group funding page (`/groups/fund/<code>`) is what a person reaches when a
group chat runs out of Murph usage. Make it work well on a phone and remove the
"Personalize" feature from the page and from the backend.

Requested outcomes:

1. Remove Personalize entirely: page, Web backend, runner.
2. The dial turns only when the person drags its end, never from a scroll.
3. Moving the dial from $5 to $10 changes the amount shown and the amount
   authorized.
4. The rest of the page, including error and checkout-cancel states, is far
   simpler.

## Product UX plan

- **Outcome:** a person opens the link, sets an amount, pays, and is done, with
  no modal, no optional form, and no dead end.
- **Entry and promise:** a link from the group chat. Monthly is the default, a
  one-time gift is one tap away. Stripe Checkout is the only other surface.
- **Affected people:** first-time sponsor on a phone; person contributing to an
  already sponsored chat (one-time only); active, paused, and recovery-required
  sponsors; signed-out visitor; a payer with an open or failed checkout; a payer
  who cancels at Stripe; suspended member and inactive link (cancel-only).
- **Proof:** dial drag and scroll behavior in a real touch-emulated browser, the
  checkout request carrying the chosen cap, each state rendered at 390px and
  1280px on `/screenshots/groups`.
- **Done when:** the journeys above are replayed and the page reads as one
  simple flow in every state.

## Decisions

- **Personalize means all of it.** The collapsible holds three things: the
  message/poem/song request, the temporary running bit, and the "Credit it as"
  alias. All three go.
- **The Supporters list goes too.** With no alias, every row reads "Anonymous".
- **Billing does not change.** A monthly sponsorship stays capped auto-refill:
  an exact $5 charge at activation, then exact $5 refills up to the chosen
  maximum. The dial already sent the chosen cap to the server; only the button
  ignored it (it renders the fixed `usage_5_usd` offer) and the number updated
  only on release. The fix is that the dial updates live and the button states
  the chosen amount. The owner confirmed that charging $5 at a time stays.
  Charging the whole amount up front would be a billing change: no `$50` offer
  exists and the refill and recovery rules assume exact $5 purchases.
- **The page matches the app.** The owner picked the night design from the
  Paper review: the app's night ground, a Fraunces headline per state, a gold
  dial, one cream pill. It is the twin of the challenge invite link.
- **No notes under the button.** The owner removed them. Only controls sit there,
  such as `Give once instead`. The $5 charge is stated in the raise-limit drawer
  and at Stripe Checkout, not on the page.
- **The flow moves onto the page.** A full-height drawer currently opens over a
  nearly empty page. Group checkout renders inline, using the existing
  `useHostedUsageTopUpDialog` controller and reducer without changing their
  semantics. `HostedUsageTopUpDialog` keeps only personal and family scope.
- **Canceled or failed checkout returns to the normal page** with one sentence
  under the headline. There is no separate terminal screen.
- **The dial shows only while refills are running.** A paused or failed-payment
  sponsor resolves that first, then changes the limit.

## Plan review outcomes

ReviewGPT reviewed this plan on 2026-11-05. Each finding was checked against the
source before it was accepted.

| Finding | Outcome |
| --- | --- |
| `selectionConflict: "sponsorship"` also guards funding kind and the monthly cap | Accepted. `hostedGroupSponsorshipCheckoutSelectionMatchesTx` is a billing check and stays, with new direct tests. Only draft equality goes. |
| Removing the `creative-response` profiles breaks persisted work (14-day mailbox, restored runtime state) | Accepted. Readers keep recognizing the two values and route them to the existing terminal skip. Undelivered creative work is abandoned. |
| A frontend-first PR breaks recovery of a personalized purchase | Accepted. `assertHostedGroupSponsorshipRequestMatchesTx` returned a 409 when the draft was omitted, so draft equality is removed in the same revision as the UI. |
| Group checkout needs one stable controller | Accepted. One `GroupFundingCheckout`, with mode and amount as selection data. |
| Replace the limit-increase confirmation with an inline action | Rejected for now. It is explicit payer confirmation of a higher billing limit, with a tested uncertain-state path. Reworking it adds risk without fixing anything the owner raised. |
| Use the contract-migration lane for the table drop | Accepted. The lane runs automatically after each production deploy, so the drop stays in its own PR to keep a rollback window. |

A second pass reviewed the night rebuild on 2026-11-05 and found six regressions, all
accepted and fixed with tests: Cancel hidden while a payment settles, a confirmed
recovery hiding a deferred limit, three focus or announcement losses, and a retry
that could not work in a tab with no request identity. It found no wrong-charge or
double-payment path.

Final ReviewGPT round 1 found that a raised limit was compared with this month's
limit rather than the one the payer last chose, so undoing a scheduled decrease read
as `Lower limit` and skipped confirmation. Accepted and fixed: every real increase
now confirms, and names next month when that is all it changes. It also found the
form's draft builder dead after the dialog deletion. Accepted and deleted.

Round 2 found that the next-month wording understated a limit between the scheduled
and current ones: the server applies it now unless it is below what is committed, so
this month's limit can drop too. Accepted. Billing is unchanged and the drawer states
that effect.

## Backend removal

Removal happens in three revisions so no running version sees a shape it cannot
read.

### PR 1: UI and recovery seam (Web, auto-deployed on merge)

- The page stops collecting and sending personalization.
- The checkout parser ignores a `sponsorship` key from an older tab.
- Recovery stops comparing drafts. The billing selection check stays.
- Moment rows are still written, always with no draft. This keeps the current
  production Web a valid rollback target, because its recovery requires a row.
- This revision is the rollback floor for PR 2: it recovers a purchase without
  reading a moment row or digest.

### PR 2: delete the feature (Web on merge, runner on the manual Cloudflare deploy)

Web:

- Delete draft parsing, sealing, digests, the creative notification, the running
  bit read, the supporters read, and the experience policy.
- Stop writing and reading `HostedGroupSponsorshipMoment`. Growth metrics derive
  "group sponsorship" from the purchase target.
- `hosted-mailbox/fetch` stops attaching `groupRunningBit`.
- The private recovery notice stays.

Runner:

- Remove `groupRunningBit` from `hosted-execution`, `assistant-runtime`, and
  `assistant-engine`. The mailbox parser already ignores unknown fields, so a
  rolled-back Web sending the field stays harmless.
- Remove the creative prompts, turn profiles, and song requirement, keeping
  reader compatibility so retired work is skipped, not parsed or executed.

### PR 3: drop the table (contract-migration lane, after PR 2 is live)

A migration under `apps/web/prisma/contract-migrations` drops
`hosted_group_sponsorship_moment`, which also deletes the stored personalization.
The drop sets a hard rollback floor at PR 2, so it stays separate.

The parser's tolerance for the `sponsorship` key is a separate window: dropping
the table says nothing about old tabs. Remove it once PR 1 has been live for
seven days.

## Constraints

- Hold Web copy to plain language and no em dashes.
- Keep the reducer, request-identity, and payment-recovery rules intact. A
  retry must never create a second payment.
- Keep `/design` and `/screenshots/groups` current.
- Billing behavior, caps, and Stripe prices do not change.

## Risks and mitigations

1. Risk: a tab opened before deploy posts `sponsorship` and the strict body
   allowlist rejects it.
   Mitigation: the parser ignores the key until PR 1 has been live seven days.
2. Risk: a checkout started before deploy carries a stored draft.
   Mitigation: draft equality is gone, so a retry resumes the same purchase.
   In PR 1 its stored creative request is still delivered on settlement. After
   PR 2 it is skipped. No charge changes.
3. Risk: canceling at Stripe lands on a page rendered while the purchase was
   still open, so the amount choices are missing.
   Mitigation: the server always passes the amount choices, and the client
   decides what to show from the purchase state.
4. Risk: a running bit active at deploy stops early.
   Mitigation: accepted, it lasts at most three days and is non-essential.

## Tasks

1. Build the handle-only dial and the inline checkout (frontend).
2. Restyle every state: sign-in, unavailable, canceled, failed, confirming,
   confirmed, management, recovery.
3. Update the design study, proof spec, and tests.
4. Land the recovery seam with the UI (PR 1).
5. Delete the feature in a stacked branch (PR 2).
6. Replay journeys, review, PRs.
7. Drop the table (PR 3) after PR 2 is live.

## Verification

- Commands to run: focused Vitest for the page, dialog, management card, and
  store; `pnpm --dir apps/web typecheck`; `pnpm test:diff` for touched packages;
  the group fund design-proof Playwright spec at 390px and 1280px.
- Expected outcomes: a touch scroll over the dial leaves the amount unchanged,
  dragging the handle changes it live, and the checkout payload carries the
  chosen `monthlyCapMinor`.
