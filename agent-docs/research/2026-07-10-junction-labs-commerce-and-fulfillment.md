# Junction labs commerce and fulfillment proposal

Status: point-in-time research and proposed plan
Research date: 2026-07-10
Implementation status: not approved or scheduled

## Purpose

This note preserves an earlier repo audit and external research pass on adding
cash-pay lab ordering to Murph through Junction and Stripe. It is a reference
for future product, commercial, legal, clinical, and implementation planning.

This is not a current product contract. Vendor capabilities, pricing, legal
requirements, state coverage, and repository seams must be revalidated before
implementation. No repository code was changed as part of the original
research.

This note also does not change Murph's current group-challenge product wedge or
establish lab commerce as a priority. Any future implementation proposal must
justify the work against the product strategy in force at that time.

## Executive recommendation

The proposed product is a Murph-owned Labs domain with two interfaces: the
assistant and the web app. Junction would handle clinical authorization and
fulfillment. Stripe would handle payment. Murph would own quotes, orders,
consent, and user-facing status, while canonical results would remain in
Murph's encrypted vault architecture.

The recommended first release is deliberately narrow:

- United States, adults only, and cash pay.
- Junction's physician network for order authorization and result review.
- Walk-in blood draws only.
- One common lipid panel as the first end-to-end vertical slice.
- One-time Stripe Checkout Sessions.
- A "no Murph markup" promise only after landed cost is contractually defined.
- Automatic structured-result import into the encrypted Murph vault.
- The assistant and website using the same ordering service and rules.
- At-home phlebotomy, kits, insurance, minors, and sensitive specialty tests
  deferred until each has its own clinical, legal, and operational design.

The main blockers are commercial and regulatory rather than technical. Murph
should not promise "all Junction tests at cost" until Junction confirms catalog
publication and resale rights, merchant-of-record structure, authoritative
landed cost, physician responsibilities, and state ordering boundaries in
writing.

## Vendor capability summary

The research found Junction to be an end-to-end clinical and logistics API,
not a documented consumer commerce platform.

### Junction appears to provide

- A team-specific catalog of approved tests and biomarkers. It describes what
  Murph's account can order, not every assay in each partner lab's catalog.
- Tests composed of panels, individual biomarkers, and permitted additions.
- Walk-in patient service centers, at-home phlebotomy, at-home kits, and beta
  on-site collection.
- ZIP-based coverage checks and service-center coordinates, distance, hours,
  capabilities, and laboratory identity.
- Quest appointment scheduling where supported. Other sites may be walk-in or
  require booking through the lab.
- Physician authorization and result review through Junction, a customer
  physician, or a hybrid model.
- Requisitions, preparation and collection instructions, operational email and
  SMS, appointments, cancellations, and redraws.
- Structured JSON and source PDFs for results, including numeric and text
  values, reference ranges, abnormal and critical flags, partial and final
  states, missing-result states, LOINC data, and source-panel information.
- Signed Svix webhooks and sandbox lifecycle simulation.

### Junction did not publicly document

The reviewed public material did not describe a patient-facing checkout,
card-collection, or payment-link API. Its billing modes instead described who
is billed:

- `client_bill`: Junction bills Murph.
- `patient_bill`: the laboratory bills the patient at its own list price.
- `patient_bill_passthrough`: a BioReference-specific arrangement that needs a
  written commercial and accounting definition.
- `commercial_insurance`: an insurance path with more limitations and
  complexity.

Unless Junction offers a private hosted checkout, the simplest proposed model
is for Murph to charge the patient through Stripe and create a `client_bill`
Junction order only after conclusive payment success.

## Proposed ownership and architecture

The existing Junction wearable integration should not own lab ordering.
`packages/device-syncd` is designed around wearable connections, tokens,
summaries, and time series. The smallest initial owner would be a server-only
Labs module in `apps/web`. Extract a package only after a real second consumer
proves the need.

```text
Murph assistant ----+
                    +--> Murph Labs service in apps/web
/labs web app -------+       |
                            +-- catalog, quotes, and locations
                            +-- order and appointment state
                            +-- Stripe Checkout
                            +-- Junction ordering
                                      |
                           Stripe and Junction webhooks
                                      |
                          durable receipts and reconciliation
                                      |
                             lab-result.ready pointer
                                      |
                             Murph hosted runtime
                                      |
                           Junction result importer
                                      |
                      canonical encrypted blood-test event
                                      |
                     biomarker trends and experiment comparison
```

Proposed durable ownership:

| Owner | Responsibility |
| --- | --- |
| `apps/web` and Postgres | Quotes, payment state, user-visible order status, appointments, cancellation and refund state, consent receipts, and opaque provider references. |
| Junction | Physician authorization, requisitions, lab routing, collection logistics, operational lifecycle, and source results. |
| Stripe | Payment, refund, and dispute truth. |
| Murph encrypted vault | Canonical results, retained source provenance and PDFs, biomarker history, and experiment anchors. |
| Cloudflare runner | Thin signed bridge and runtime execution, never product state. |

Payment, fulfillment, appointment, result-import, and refund state should stay
separate internally. The UI can project them into fewer member-facing labels.

## Existing repository foundation

The original audit found that the result side already exists in substantial
form:

- Blood tests are canonical `kind: "test"` events with a projected blood-test
  user-facing noun.
- The contract supports panels, collection and report dates, fasting status,
  numeric and text values, comparators, units, flags, and reference ranges.
- Results become metric points and feed the BrowserVault biomarker experience.
- Experiments support baseline and follow-up `lab_panel` measurements.
- The query layer compares anchored baseline and follow-up lab results.
- The authored psyllium-husk cholesterol protocol already calls for a baseline
  lipid panel and a repeat panel after 8–12 weeks.

Relevant seams observed during the audit:

- `packages/contracts/src/zod.ts`
- `packages/core/src/history/api.ts`
- `packages/query/src/health/blood-tests.ts`
- `packages/query/src/metrics/index.ts`
- `packages/query/src/experiments.ts`
- `packages/health-commons/content/protocols/psyllium-husk/psyllium-husk-for-cholesterol.md`

The missing system is commerce, fulfillment, and provider ingestion rather
than a second clinical-record model.

Provider imports should use the canonical batch import owner with a stable
Junction transaction external reference. Partial results, final results, and
redraw revisions should update one diagnostic journey instead of creating
duplicates.

Two result-model gaps were identified:

1. Preserve Junction's LOINC code, LOINC slug, provider marker ID, source
   markers, and missing-result status for each analyte.
2. Expand Murph's metric definitions. LDL-C, HDL-C, triglycerides, and ApoB
   already have useful bindings, while total cholesterol and non-HDL-C need
   equivalent canonical treatment. Unknown analytes can still be stored before
   every analyte has polished trend or experiment semantics.

## Proposed member experience

### Catalog and test detail

The proposed `/labs` catalog would be public only if Junction grants catalog
and price-publication rights. It would support search by test, biomarker,
common intent, and synonym; categories; a prominent ZIP input; draw-method,
lab, fasting, price, and turnaround filters; and cards with price, included
markers, preparation, sample method, and honest turnaround estimates.

In this proposal, "all tests" means every active test available to Murph's
Junction account that is legally and operationally orderable for the specific
person and location. Tests requiring counseling, unusual answers, particular
demographics, or physician review can remain discoverable while purchase stays
gated.

A proposed `/labs/[test]` page would show what the test measures, every marker,
lab and collection method, location-dependent availability, preparation,
turnaround range, exact quote, cancellation policy, clinical-provider identity,
and the limits of Murph's role. Copy should explain the test without presenting
Murph as diagnosing, prescribing, or replacing clinical review.

### Locations

After a ZIP is entered:

1. Call Junction Area Info.
2. Fetch patient service centers live or with only a short cache.
3. Render a list and map using provider coordinates.
4. Distinguish walk-in sites, Junction-bookable appointments, lab-site booking,
   and at-home availability.
5. Show distance, hours, lab, phone, supplied accessibility data, and a
   "last checked" time.

The UI must not imply that a site or slot is reserved until confirmation
exists. ZIP should be the default rather than browser GPS. Map requests should
contain no member, condition, test, or order identifiers.

### Orders

The proposed `/labs/orders` projection would keep member-facing state small:

- **Needs you:** complete intake, pay, book, or resolve an issue.
- **In progress:** requisition preparation, ready for collection, or sample
  processing.
- **Complete:** final results imported.
- **Cancelled or refunded.**

## Proposed assistant surface

The assistant should receive one typed product tool rather than generic access
to Junction. Proposed operations:

- `search`
- `locations`
- `quote`
- `start_checkout`
- `list_orders`
- `read_order`
- `cancel`
- `appointment_availability`
- `book_or_reschedule`

The assistant can compare orderable panels, explain included markers and
preparation, find nearby collection options, prepare a quote, and return a
first-party intake link.

It should not collect the patient's legal name, date of birth,
laboratory-required demographic fields, home address, telehealth consent, or
card fields in an SMS transcript. The first-party page should handle those
irreducible legal and private steps, then redirect to Stripe Checkout.
Conversation should still handle discovery, comparison, confirmation, status,
and experiment follow-up. Any intake link should continue an established,
user-requested conversation, use a recognizable first-party URL, and avoid a
broadcast-shaped or unsolicited link-drop flow.

Before a mutation, the member should explicitly agree to the exact panel,
included markers, price, collection method, preparation, and location. The
service should detect duplicate outstanding orders.

## Proposed payment and ordering flow

Use a fresh one-time Stripe Checkout Session tied to one authenticated,
expiring quote. A reusable Payment Link is not a suitable order identity. The
browser success redirect is not payment proof; webhook-backed fulfillment is
authoritative.

Proposed sequence:

1. Create a member-bound draft lab order.
2. Validate age, location, test status, lab account, collection method,
   required answers, preparation, and eligibility.
3. Collect required Murph and provider consent on a deterministic review page.
4. Re-fetch coverage and create an immutable, short-lived quote.
5. Create a one-time Stripe Checkout Session.
6. Put only an opaque order ID and flow discriminator in Stripe metadata.
7. Wait for `payment_status=paid`, including asynchronous success for delayed
   payment methods.
8. Record `paid_unfulfilled` without presenting the Junction order as ready.
9. Create or reuse the Junction user with a non-identifying client reference.
10. Create the Junction order with an idempotency key derived from the Murph
    order.
11. If Junction's response is ambiguous, query Junction before retrying.
12. Show "Paid—preparing your order" while bounded fulfillment retries run.
13. If fulfillment fails permanently, issue and clearly surface a full refund.
14. Reconcile Stripe payments, refunds, and disputes with Junction orders and
    invoices.

The existing Stripe webhook receipt and retry ideas may be reusable, but the
current handler was observed to assume subscription onboarding. A labs flow
needs an explicit discriminator and dispatcher before existing billing logic
runs.

Do not place test names, diagnoses, selected biomarkers, appointments, clinical
notes, or addresses in Stripe metadata, descriptions, URLs, support fields, or
statement descriptors. Stripe should receive an opaque order and generic
description. The authenticated Murph receipt can contain the itemized detail.

## Pricing proposal

A Junction catalog price may not equal landed cost. State modifiers, reflex
charges, ranged modifiers, physician review, home collection, kits, shipping,
redraws, cancellations, and account fees may change the final economics.

The proposed public promise is:

> No Murph markup. You pay our direct lab price, shown before checkout.

For an initial pilot, Murph could absorb Stripe fees. If that subsidy is not
acceptable, payments and legal review should approve one separately disclosed
processing amount rather than hiding it inside the test price.

New York and New Jersey need special review because the researched Junction
BioReference arrangement described no-markup pass-through pricing and patient
access to the underlying Junction price.

Before any "at cost" claim, build a per-order settlement report:

```text
customer amount
- refunded amount
- Junction lab, physician, and collection invoice
- payment cost absorbed by Murph
= Murph margin
```

The promised invariant is zero markup. The assistant should never calculate or
assert it from incomplete runtime data.

## Proposed result-import flow

When Junction sends an update:

1. Verify the raw Svix signature.
2. Store only a minimal deduplicated webhook receipt.
3. Return success quickly within Junction's documented webhook deadline.
4. Fetch the authoritative transaction or order asynchronously.
5. Update the Postgres order projection.
6. For final or critical results, append an encrypted `lab-result.ready`
   mailbox pointer.
7. Let the runtime fetch structured results through a signed, member-bound web
   proxy.
8. Let a pure Junction lab importer retain sanitized raw JSON and, if policy
   permits, the source PDF in the encrypted vault.
9. Map analytes by LOINC code, Junction LOINC slug, provider marker ID, then a
   provider slug or name fallback.
10. Apply the revision through the canonical batch import owner using the
    stable Junction transaction external reference.
11. Acknowledge the canonical event ID back to the web owner.
12. Refresh BrowserVault and attach the result to the experiment measurement
    anchor.

Partial results may not produce ordinary order-update webhooks, while critical
results can arrive before the final report. The importer should support
revisions. The first release can show final results plus immediate
critical-result handling rather than every routine partial result.

Junction's physician path remains authoritative for critical results. Murph
should import and surface them promptly but must not become the sole urgent
result handler or imply that the assistant replaces clinical follow-up.

## Minimal proposed persistence

Avoid building a general lab platform before one end-to-end order works.
Initial conceptual records:

- `HostedLabOrder`: member, immutable quote, separate payment, fulfillment,
  appointment, import, and refund states, encrypted patient and provider
  references, preparation snapshot, experiment link, and timestamps.
- `HostedLabProviderOrder`: upstream Junction orders associated with one
  user-visible transaction, because redraws and replacements can create more
  than one provider order.
- `HostedLabWebhookReceipt`: event dedupe, claim and retry state, and a
  sanitized failure code.
- Existing hosted consent records, with required order-specific consent facts
  snapshotted on the order.

Fetch catalogs and locations live with bounded caching. Do not create a durable
catalog database until a proven need such as SEO, offline browsing, provider
latency, or curated search requires it. Persist only the offering and price
snapshot used for a transaction.

Any new store must be covered by account export, deletion, retention, privacy
inventory, and health-data tracking rules.

## Psyllium and cholesterol example

The existing psyllium-husk protocol is a useful first vertical slice:

1. Murph recognizes the existing cholesterol protocol.
2. It reviews known cholesterol results and active medications instead of
   asking for data it already has.
3. It asks for ZIP and preferred draw method.
4. It compares lipid panels and identifies LDL-C, HDL-C, triglycerides, total
   cholesterol, non-HDL-C, and ApoB availability.
5. It recommends consistent lab, method, collection conditions, and fasting
   status without making a diagnosis.
6. It prepares the baseline quote and private intake link.
7. The result imports into the baseline measurement anchor.
8. The experiment saves an 84-day follow-up as a planned measurement.
9. Near the end, Murph asks whether to prepare a new follow-up quote.
10. The follow-up imports against the same biomarker identities and the
    experiment analysis compares the two.

Do not charge for and place the follow-up order three months early. Location,
pricing, health context, and consent can change. Save the measurement plan and
re-quote near the intended window.

## Phased rollout proposal

### Phase 0: commercial and clinical contract

- Confirm seller and merchant of record.
- Confirm catalog publication, resale, and white-label rights.
- Define the authoritative all-in price and lock period.
- Confirm physician and critical-result ownership.
- Complete BAA, DPA, security, and subprocessor review.
- Obtain Stripe approval for the disclosed lab and telehealth model.
- Define cancellation credits, refunds, redraws, and failed collections.
- Establish state eligibility and test restrictions.

### Phase 1: one sandbox vertical slice

- One walk-in lipid panel.
- One ZIP and patient service center result.
- One quote and test-mode checkout.
- One idempotent Junction order.
- Normal, abnormal, critical, partial, missing-result, cancellation, and
  duplicate-webhook simulations.
- Automatic canonical result import.
- Assistant search, checkout, and status.
- A minimal orders page.

### Phase 2: production walk-in pilot

- Common adult cash-pay panels.
- Order history and requisition/preparation experience.
- Live location list and map.
- Cancellation and refund support.
- Final and critical result handling.
- Reconciliation and support tooling.
- Junction's white-labeled operational communications as an initial safety
  net, if contractually available and product-appropriate.

### Phase 3: reviewed walk-in catalog

- All active, reviewed, team-authorized tests.
- Search synonyms and authored categories.
- Rich test pages.
- Quest appointment booking where supported.
- Better cross-lab LOINC normalization.
- Expanded Murph biomarker definitions.
- Price and invoice settlement reporting.

### Phase 4: additional modalities

Add each independently:

- At-home phlebotomy.
- Kits and shipping.
- Specialty, genetic, cancer, reproductive, and STI tests.
- Insurance.
- HSA and FSA optimization.
- Minors and proxies.

Each adds distinct consent, logistics, refund, privacy, or clinical
obligations.

## Launch gates

Before public ordering, require:

- Written merchant-of-record structure.
- Explicit white-label, resale, catalog, and price-publication rights.
- Stripe approval for the exact disclosed business model.
- A contractual definition of all-in cost and refund credits.
- A defined Junction physician model and abnormal/critical follow-up service
  level.
- BAA, DPA, subprocessor, and security review.
- State direct-access testing and physician-licensure review.
- Privacy review covering HIPAA status, the FTC Health Breach Notification
  Rule, and applicable state consumer-health laws.
- No ad pixels, session replay, or unrestricted third-party analytics on lab
  search, order, payment-return, or result pages.
- Tested payment-without-order recovery and full-refund behavior.
- Tested duplicate, delayed, missing, and out-of-order webhooks.
- Account export, deletion, and retention coverage.
- Critical-result drills proving Murph does not delay the physician path.

## Questions for Junction

1. Can Junction or a lab partner be merchant of record through a private hosted
   checkout?
2. What does `patient_bill_passthrough` mean contractually, technically, and
   financially?
3. May Murph publish and resell every active test available to its team?
4. Which field is the authoritative all-in price, and how long is it locked?
5. What charges can appear after ordering, including reflex, physician,
   collection, shipping, redraw, cancellation, no-show, or state fees?
6. Who issues required self-pay estimates and itemized receipts?
7. Which physician model should Murph use, and who owns abnormal and critical
   follow-up?
8. Which tests or states require extra counseling, consent, demographic data,
   diagnoses, or ask-at-order-entry answers?
9. What are the requisition, webhook, result, support, and critical-contact
   service levels?
10. How do redraws, replacements, cancellations, and credits settle?
11. What catalog and location caching and public-display rights does Murph
    receive?
12. Will Junction sign a BAA, DPA, and security addendum covering retention,
    deletion, subprocessors, breaches, analytics, advertising, and model
    training?
13. Can production-like orders be fully simulated without billable live
    fulfillment?
14. What is the authoritative current state and modality coverage?

## Sources consulted in the original research

These links record the source set used for the 2026-07-10 research pass. Check
them again before relying on them for implementation or launch.

### Junction

- [Test catalog](https://docs.junction.com/api-reference/lab-testing/tests-paginated)
- [Ordering workflow](https://docs.junction.com/lab/workflow/ordering)
- [Testing modalities](https://docs.junction.com/lab/overview/testing-modalities)
- [Area Info API](https://docs.junction.com/api-reference/lab-testing/area-info)
- [PSC Info API](https://docs.junction.com/api-reference/lab-testing/psc-info)
- [Locations and appointments](https://docs.junction.com/lab/overview/locations)
- [Physician models](https://docs.junction.com/lab/overview/physicians)
- [Result formats](https://docs.junction.com/lab/results/result-formats)
- [Critical results](https://docs.junction.com/lab/results/critical-results)
- [Webhook verification](https://docs.junction.com/webhooks/introduction)
- [Webhook retry policy](https://docs.junction.com/webhooks/retry-policy)
- [Sandbox](https://docs.junction.com/lab/overview/sandbox)
- [Billing types](https://support.junction.com/articles/7563195327-billing-types)
- [Biomarker pricing fields](https://docs.junction.com/api-reference/lab-testing/biomarkers)
- [New York and New Jersey guidance](https://www.junction.com/post/lab-testing-new-york-new-jersey)

### Payments and regulation

- [Stripe Checkout](https://docs.stripe.com/payments/checkout)
- [Stripe Checkout fulfillment](https://docs.stripe.com/checkout/fulfillment)
- [Stripe pricing](https://stripe.com/pricing)
- [Stripe restricted businesses](https://stripe.com/legal/restricted-businesses)
- [CMS direct-access testing guidance](https://www.cms.gov/regulations-and-guidance/legislation/clia/downloads/direct_access_testing_dat-pdf.pdf)
- [FTC Health Breach Notification Rule update](https://www.ftc.gov/news-events/news/press-releases/2024/04/ftc-finalizes-changes-health-breach-notification-rule)

## Revisit checklist

When this work is reconsidered:

1. Revalidate all vendor and regulatory claims.
2. Resolve the Junction and Stripe launch gates before a public price or
   catalog promise.
3. Re-audit current repo seams and durable-state owners.
4. Write an approved product spec for the selected vertical slice.
5. Start with the single lipid-panel sandbox path and prove payment,
   fulfillment, result import, critical-result handling, recovery, and refund
   behavior before broadening the catalog.
