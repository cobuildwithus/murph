# Health Browser Playbook

Use this reference after the main `computer-use` skill. It provides starting
sites, material inputs, and common snags for frequent health-related browser
tasks. The main skill still controls authorization, sensitive data, handoff,
verification, and memory.

## Shared starting-site rules

- Existing relationship: start with the user's saved provider, portal, pharmacy,
  retailer, optical store, grocery service, or meal service.
- New clinical provider: start with the insurer's official directory when
  network status matters, then verify and book through the provider's official
  site or the scheduling service the provider links to.
- Prescription, records, insurance, and billing: use the official provider,
  health-system, insurer, pharmacy, or optical portal.
- Product facts: use the official manufacturer or current label as authority.
  Use a retailer or marketplace for availability, fulfillment, and checkout.
- Meals: prefer the user's saved service. Otherwise use the restaurant's
  official ordering site for menu truth and a reputable delivery aggregator
  only when the user values its delivery coverage or account convenience.
- Search results and marketplaces are discovery layers. Verify the official
  domain, exact target, seller, and final terms before entering personal data or
  committing.

### 1. Book an appointment with the user's existing dentist

- Start with the saved provider website or official patient portal.
- Resolve existing-versus-new patient, visit type, preferred clinician,
  location, date window, timezone, insurance use, and acceptable cost bounds.
- Watch for cleaning-only versus exam-plus-cleaning, multiple office locations,
  stale slots, deposits, cancellation rules, and portals that route existing
  patients differently from public booking.

### 2. Find and book a new or in-network dentist

- Start with the insurer's official directory when network status matters; use
  the practice's official site for current services and booking.
- Resolve specialty, distance, accessibility, new-patient status, date window,
  language or clinician preference, and whether a third-party scheduler is
  acceptable.
- Treat directory network status and cost as estimates. Verify that the exact
  office and clinician match, and do not submit a lead-generation form in place
  of a real appointment.

### 3. Reschedule or cancel an appointment

- Start from the official confirmation link, patient portal, or provider site.
- Resolve the exact appointment, acceptable replacement window, and whether the
  user authorizes cancellation if no replacement is available.
- Watch for duplicate bookings, cancellation or no-show fees, cutoff times, wait
  list changes, and ambiguous buttons that cancel an entire series. Verify the
  old state and the final new or canceled state.

### 4. Book primary care or an annual physical

- Start with the user's existing health-system portal or insurer directory, then
  the clinician's official scheduling flow.
- Resolve visit type, established-versus-new patient status, clinician,
  location, date window, insurance, and whether fasting or forms are merely
  site instructions rather than decisions Murph should make.
- Watch for "annual wellness," "preventive physical," and problem visits being
  different appointment types with different coverage.

### 5. Book a specialist or referral-based visit

- Start with the referral destination or health-system portal; use the insurer
  directory when network status is part of the request.
- Resolve specialty, named clinician, referral or authorization status,
  location, date window, and whether the user accepts another clinician within
  explicit bounds.
- Never invent a referral, diagnosis, authorization number, or reason for visit.
  Pause when the portal requires a document or clinical answer the user has not
  supplied.

### 6. Book therapy or behavioral-health care

- Start with an existing therapist portal, insurer directory, or the clinician's
  official site.
- Resolve in-person versus telehealth, location or licensed state, clinician
  preference, date window, insurance or self-pay bounds, and recurring versus
  one-time scheduling.
- Treat mental-health details as sensitive. Transmit only what the user
  authorized, avoid broad intake narratives when a minimal answer works, and
  verify recurring cadence before creating a series.

### 7. Find urgent care or book telehealth for a non-emergency need

- Apply Murph's health-safety guidance before browser work. Do not use ordinary
  scheduling when emergency care may be needed.
- Start with the user's health system, insurer, or a known official urgent-care
  or telehealth service.
- Resolve location or licensed state, earliest acceptable time, modality,
  insurance, and cost bounds. Watch for membership trials, recurring plans,
  unsupported conditions, age restrictions, and estimated rather than
  guaranteed wait times.

### 8. Schedule a lab or blood draw

- Start with the ordering health system or the official lab provider named on
  the order.
- Resolve exact order or test, location, date window, fasting instructions as
  written, insurance, and whether an appointment is required.
- Never choose or alter tests. Watch for self-pay versus insurance flows,
  duplicate orders, order expiration, specimen timing, and locations that do
  not perform the requested collection.

### 9. Schedule imaging or a diagnostic procedure

- Start with the ordering provider's referral flow or the official imaging
  center or health-system portal.
- Resolve exact ordered study, body region only as written, contrast only as
  ordered, location, date window, authorization, and insurance.
- Never infer protocol details. Watch for prior authorization, prep
  instructions, implant or pregnancy screening questions, deposits, and
  separate facility versus radiologist billing.

### 10. Book a vaccination or pharmacy clinic appointment

- Start with the user's pharmacy, health system, or public-health provider's
  official scheduling page.
- Resolve the exact vaccine requested, age eligibility, location, date window,
  insurance, and whether multiple vaccines were explicitly requested.
- Do not recommend or substitute a vaccine in the browser flow. Watch for
  pharmacy account mismatches, consent forms, dose-series questions, and
  appointment confirmation versus wait-list registration.

### 11. Book an eye exam

- Start with the user's existing optometrist or ophthalmology portal; otherwise
  use the insurer directory and official practice site.
- Resolve routine vision exam versus medical eye visit, contact-lens fitting,
  clinician, location, date window, and insurance.
- Watch for separate exam and fitting fees, dilation options, retail-store
  marketing, and booking a glasses-only exam when contact-lens renewal is the
  actual goal.

### 12. Order or reorder contact lenses

- Start with the user's prior optical retailer or order history, then an
  authorized retailer the user prefers.
- Match each eye exactly: brand, product line, power, base curve, diameter,
  cylinder, axis, add power, color, and box count as applicable. Confirm
  prescription validity and the prescriber-verification path.
- Never substitute brands or parameters. Watch for per-box versus per-eye
  quantity, rebate conditions, subscription defaults, hidden exam upsells,
  prescription upload or verification, seller authorization, and delivery date.

### 13. Order glasses or optical accessories

- Start with the user's saved optical retailer or an authorized retailer.
- Resolve frame, size, color, lens prescription source, lens type and coatings
  already chosen by the user, quantity, budget, and delivery.
- Do not choose clinical lens parameters. Watch for pupil-distance entry,
  duplicate lens upgrades, nonreturnable custom orders, virtual-try-on privacy,
  and separate frame versus complete-pair prices.

### 14. Submit a prescription refill request or manage a pharmacy order

- Start with the official pharmacy or health-system portal tied to the current
  prescription.
- Resolve the exact medication and prescription, pharmacy location or delivery,
  quantity already prescribed, refill status, insurance, and whether the user
  asked only to request the refill or also authorize payment/delivery.
- Never change drug, dose, frequency, quantity, prescriber, or substitution
  preference. Watch for no-refill-left messages, transfer flows, prior
  authorization, controlled-substance restrictions, and auto-refill enrollment.

### 15. Buy an OTC medicine or first-aid product

- Start with a known pharmacy or retailer; use the official manufacturer label
  to verify the exact product when names are similar.
- Resolve active ingredient, strength, formulation, count, age-specific version,
  exact user-selected product, seller, quantity, and budget.
- Do not choose treatment or dosing in the shopping flow. Watch for duplicate
  active ingredients, lookalike formulations, age gates, marketplace sellers,
  subscriptions, and multipacks that change the requested quantity.

### 16. Make a first-time supplement purchase

- Start with the official brand page for current formula and label evidence.
  Use the brand store, a known authorized retailer, or a reputable marketplace
  according to the user's preference.
- Resolve exact brand, product, formula, flavor or form, serving, bottle count,
  seller, one-time versus subscription, budget, and delivery.
- Amazon is useful when the user prefers its fulfillment, but verify sold-by and
  fulfilled-by details and compare direct purchase when authenticity, returns,
  subscription discount, or total cost materially differs. Do not select a
  supplement or dose as part of browser execution.

### 17. Reorder or replenish an existing supplement regimen

- Start with the user's saved product, prior exact order, or current regimen,
  then the preferred retailer.
- Match the exact formula, size, serving, flavor or form, quantity, and seller.
  Estimate supply only from the known regimen and label; do not alter the
  regimen.
- Watch for formula revisions, changed bottle size, bundle substitutions,
  autoship defaults, stale prior-order links, changed sellers, and duplicate
  replenishment already in transit.

### 18. Order health equipment or medical supplies

- Start with the supplier tied to the user's existing device or prescription;
  otherwise use the manufacturer or an authorized retailer.
- Resolve exact model, compatibility, size, quantity, prescription or
  eligibility requirement, seller, returnability, and delivery.
- Never infer a device specification. Watch for accessory-versus-device
  confusion, model-year incompatibility, recurring supply programs, insurance
  versus cash pricing, nonreturnable hygienic items, and regulated-product
  verification.

### 19. Order groceries for a nutrition plan

- Start with the user's saved grocery service or preferred store.
- Resolve the shopping list, quantities, brands where material, budget,
  delivery or pickup window, substitution policy, dietary constraints, and
  address.
- Preserve allergies and exclusions exactly. Watch for unit-price versus item
  price, weight-variable produce or meat, unavailable items, default
  substitutions, service fees, tip, minimum order, and duplicate pantry items.

### 20. Order prepared meals or a meal-kit plan

- Start with the user's saved meal service; otherwise inspect official menus and
  plan terms before checkout.
- Resolve meals, servings, delivery date, dietary requirements, budget, and
  whether the user wants a one-time order or an ongoing plan.
- Watch for plans that auto-renew, skip deadlines, minimum weekly counts,
  introductory pricing, shipping, cross-contact disclaimers, calorie values per
  serving versus per package, and add-ons preselected in the cart.

### 21. Order restaurant delivery or pickup

- Prefer the restaurant's official menu for item truth, then use the user's
  preferred official ordering flow or delivery aggregator.
- Resolve exact items, modifications, portions, allergies, delivery versus
  pickup, address, timing, budget, substitutions, and tip bounds.
- Watch for duplicate menus, unavailable modifiers, cross-contact warnings,
  default utensils or marketing opt-ins, surge or service fees, minimums,
  estimated arrival, and aggregator-created substitute restaurants.

### 22. Book physical therapy, rehabilitation, or a user-chosen wellness visit

- Start with the referred or existing clinic's official portal. For a new
  clinical provider, use the insurer directory when network status matters.
- Resolve service type, referral requirement, clinician, location, date window,
  insurance or self-pay bounds, and whether a recurring series is authorized.
- Do not turn a general wellness service into a medical recommendation. Watch
  for evaluation versus follow-up visit types, package sales, recurring series,
  cancellation fees, and forms requesting unnecessary detail.

### 23. Use an insurance portal or check benefits and network information

- Start with the insurer's official member portal.
- Resolve the exact member or plan, benefit category, date of service, provider
  or facility, and whether the user wants information only or an authorized
  submission.
- Treat network status, coverage, deductible, and cost estimates as
  site-reported and potentially incomplete. Never guess member identifiers.
  Watch for family-member account selection, stale directories, separate
  facility and clinician status, and forms that submit an appeal or claim rather
  than merely estimate.

### 24. Complete intake forms or request records, referrals, or results

- Start with the official provider or health-system portal.
- Resolve the exact form or request, recipient, date range, purpose, delivery
  method, deadline, and which sensitive fields the user authorizes Murph to
  transmit.
- Use the minimum necessary information. Never invent clinical history,
  signatures, consent, identity details, or recipient data. Watch for broad
  releases, recurring authorization, fees, upload requirements, proxy/family
  accounts, and submit buttons that cannot be undone.

### 25. Pay a medical bill or retrieve a receipt

- Start with the official provider, facility, lab, pharmacy, or insurer billing
  portal reached from a trusted statement or saved account.
- Resolve the exact account and bill, amount, due date, payment amount, masked
  payment method, and whether the user asked to pay in full, a specific amount,
  or only retrieve a receipt.
- Verify domain and account before payment. Watch for lookalike payment sites,
  facility-versus-clinician bills, duplicate payments, convenience fees,
  payment-plan enrollment, autopay defaults, collections language, and a click
  that schedules rather than immediately posts the payment.
