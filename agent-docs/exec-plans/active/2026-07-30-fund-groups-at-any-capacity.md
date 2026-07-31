# fund-groups-at-any-capacity

Status: active
Created: 2026-07-30
Updated: 2026-07-30

## Goal

- Let an eligible participant open the group funding surface and explicitly
  start monthly sponsorship or make a one-time contribution regardless of the
  chat's current capacity.

## Success criteria

- Unsponsored active groups expose a funding URL at healthy, low, and exhausted
  capacity.
- An explicit group-funding request may use that returned URL independently of
  low-capacity urgency, including for an already sponsored room's additional
  one-time contribution.
- The funding page offers monthly sponsorship at every valid capacity.
- Monthly activation retains the existing explicit exact-$5 purchase,
  authenticated payer, one-sponsor, fixed-cap, and webhook-grant contracts.
- Automatic refills remain admitted only at low or exhausted capacity.
- Focused service, page, and group-tool projection tests cover the corrected
  behavior, and the real production components remain represented in the
  design catalog.

## Scope

- In scope:
  - Group funding-link projection.
  - Monthly activation eligibility and funding-page presentation.
  - Hosted assistant follow-up policy for explicit funding requests.
  - Durable architecture/product documentation and focused regression tests.
- Out of scope:
  - Refill admission, refill dispatch, Stripe reconciliation, credit balances,
    one-time offer amounts, or multi-sponsor behavior.

## Constraints

- Technical constraints:
  - Keep `HostedUsageCreditEntry` as the only balance owner and
    `HostedUsageCreditPurchase` as the only purchase owner.
  - Preserve authenticated server-owned payer, beneficiary, offer, and cap
    authority.
  - Do not weaken the low/exhausted automatic-refill gate.
- Product/process constraints:
  - Treat capacity as urgency, not purchase eligibility.
  - Keep the room free of payer, cap, charge, depletion, and refill detail.
  - Reuse the existing funding page, dialogs, Stripe paths, and design study
    without a new state owner or abstraction.

## Risks and mitigations

1. Risk: Removing the wrong capacity check could permit unnecessary automatic
   charges.
   Mitigation: Remove capacity coupling only from explicit activation and link
   presentation; retain the refill admission check and its tests unchanged.
2. Risk: A stale assistant projection could still hide the funding link.
   Mitigation: Project the URL independently from `fundingNeeded`, teach the
   hosted low-usage skill that the boolean controls urgency only, and cover a
   healthy unsponsored group directly.
3. Risk: A direct link could widen financial authority.
   Mitigation: Keep the existing app-session, target revalidation, server-owned
   offer/cap, explicit action, and Stripe reconciliation boundaries unchanged.

## Tasks

1. Separate funding availability from capacity urgency in the group status
   projection.
2. Remove the healthy-capacity gate from explicit monthly activation while
   retaining group-target and active-runtime validation.
3. Present the existing monthly sponsorship dialog for every valid unsponsored
   group and align the design study and durable docs.
4. Update assistant follow-up policy so an explicit funding request may use a
   returned link at any capacity without creating an unsolicited funding nudge.
5. Add focused projection, page, purchase-service, and assistant-policy
   regressions.
6. Run focused tests, typecheck, browser proof, required reviews, and exact-head
   PR checks.

## Decisions

- Capacity state controls automatic refill timing and urgency messaging only.
- A monthly sponsorship activation remains an immediate exact-$5 purchase, so
  the newly added credit is useful even when included capacity is currently
  healthy and carries forward if unused.
- No new endpoint, model, table, queue, balance, or payment primitive is needed.
- A request that explicitly selects funding, sponsorship, contribution, paying
  to add usage, or the funding link reads only current group usage. A generic
  request to get or add more usage or keep the room going remains an
  all-options request and reads both current funding and referral availability.
- Product purpose revalidation after preliminary remediation: the irreducible
  purpose is to let a participant fund the room when they choose without a
  false depletion claim or referral detour. Reusing the current group read,
  funding page, and payment flows is the smallest complete experience. The
  healthy page now states that the room has enough Murph time while keeping
  monthly sponsorship primary and one-time contribution secondary.

## Verification

- Commands to run:
  - Focused hosted-Web Vitest files for group status, funding page, purchase
    service, and refill admission.
  - Focused assistant-skill and hosted-execution parser regressions.
  - Hosted-Web typecheck and frontend-design-proof.
  - Desktop and mobile design-catalog browser proof.
  - Required preliminary specialist, final ReviewGPT, Claude UI, and exact-head
    GitHub Actions gates.
- Expected outcomes:
  - Healthy unsponsored groups expose and can use the monthly sponsorship path.
  - Low/exhausted automatic refill behavior is unchanged.
- Results:
  - Preliminary ReviewGPT returned three accepted findings: restore truthful
    healthy-state context, separate direct funding intent from broad
    funding-and-referral options, and add real Codex coverage for healthy and
    already-sponsored explicit funding. All three are resolved without a
    patch artifact.
  - Focused hosted-Web verification passed: six files and 216 tests, including
    page, projection, purchase, refill, notification, and notice behavior.
  - Assistant prompt/skill verification passed: three files and 94 tests.
    Assistant Engine and hosted-Web typechecks passed.
  - Hosted execution parser verification passed: 63 tests and package
    typecheck.
  - The opt-in real Codex scenario passed against the linked development
    provider for both healthy unsponsored funding and an already-sponsored
    additional contribution. Each path called only `read_usage`, returned the
    first-party URL, and omitted referrals, depletion pressure, and private
    billing facts.
  - Fresh Chromium catalog proof renders the complete healthy production
    action stack at 1440x1000 and 390x844, plus the unchanged desktop dialog
    and mobile drawer. The shared `GroupUsageFundingActions` composition keeps
    production and catalog presentation aligned and removes a sentence that
    repeated the one-time button label.
  - Claude Fable UI review first identified the incomplete catalog action-stack
    proof. Its post-remediation recheck returned `NO FINDINGS` and confirmed
    the shared production/catalog composition, hierarchy, and responsive
    evidence.
  - Final ReviewGPT round 1 found that a generic request to get or add more
    group usage could be misclassified as a direct paid request and omit an
    available earned path. The accepted correction reserves the one-read route
    for explicit funding selection, restores generic get/add-more-usage wording
    to the two-read all-options route, and removes the disambiguating
    every-option sentence from the real Codex regression. The corrected live
    scenario passed.
  - Complete initial Responses request measurement used pinned real Codex App
    Server, `gpt-5.6-terra` code mode, representative direct/group Linq turns,
    and `gpt-tokenizer` 3.4.0 `o200k_base`. It counted the full canonical JSON
    request body, including messages, eager tools, deferred metadata, generated
    guidance, and fixed fields, while excluding HTTP headers identically:
    direct stayed 122,504 bytes / 26,939 tokens; group changed from 109,273
    bytes / 24,055 tokens to 109,430 bytes / 24,091 tokens, or +157 bytes
    (+0.144%) and +36 tokens (+0.150%), entirely from group instructions.
