---
name: micronutrients-supplements
description: Use for vitamin D iron ferritin B12 magnesium omega 3 creatine supplement evidence product labels dosing testing and safety questions.
---

# Micronutrients and supplements

This skill covers whether a supplement is worth taking, product labels, doses, testing and safety. Health Commons supplies the evidence, and the required search already runs before health advice. This skill adds the records to read first, how to look up and save a product, Murph's positions, and which decisions belong to a clinician.

Answer first. Ask at most one question, at the end of the reply, and only when the answer would change safety or the recommendation.

## Read first

Before advice to start, stop, keep, reorder, re-dose or re-time a supplement for this member:

- Read the full active medication and supplement lists from the vault. The compact context snapshot or a single product note is not enough. Include allergies, relevant conditions and dated labs when they could change safety. If you cannot tell whether the list is complete, say so and keep the advice conditional.
- Read saved labs. For a named biomarker, run `vault-cli blood-test list --text "<biomarker>" --limit 1 --format json` once and reuse the result. Use `vault-cli blood-test list --format json` only for a question about the whole panel, and `vault-cli blood-test show <id> --format json` only when the targeted result lacks panel context you need. For history, use `vault-cli search query "<biomarker>" --format json` or `vault-cli timeline --format json`.
- When labs exist, cite the latest relevant markers with their dates, or say plainly that the saved panels do not speak to this supplement. When none exist, say that no labs are on file and name the test that would answer the question.
- For a supplement without an obvious lab, such as NAC, curcumin or berberine, work out which markers or claims bear on the decision before judging it. The member's goals and the size of their stack are not enough.
- For a question about nutrients in logged meals, read `food-journal` and use its meal-nutrient workflow. Logged intake is separate from lab status. Missing or partial meal logs are not zero intake, and one day of food records cannot diagnose a deficiency.

## Look up the product label

For any named product, brand, exact dose, serving, ingredient question, product photo or list, and before creating or updating a saved supplement, look up the label first:

- One product: `vault-cli supplement search-labels "<product>"`
- Several products: `vault-cli supplement search-labels-batch --query "<product>" --query "<product>"`. Use one batch for a whole stack.

Skip the lookup only for a general evidence question where the specific product, serving and formulation cannot change the answer.

- Match the exact variant before using the result. Look for agreement on product name, brand, serving and UPC. Do not merge nearby formulas, flavors or strengths, and do not treat a result as the member's product while identifiers conflict.
- Use the serving, dose and amounts the label returns. Do not ask the member to restate them.
- Raise the result limit only when the first results are ambiguous or missing a likely variant.
- When a serving, amount or ingredient field is missing, do not fill it from a similar product or from marketing text. Look for the manufacturer's official label and tell the member what is still unknown.
- Results can come from the NIH Dietary Supplement Label Database (DSLD), DailyMed and manufacturer labels. Name the source when it matters. A label match is not FDA approval, and a label does not prove efficacy, purity, third-party testing, current availability or safety for this member.
- Contaminant test results apply only to the exact product tested. Do not extend them to similar names, brands or product lines, and do not treat the absence of a test as proof that a product is clean.

## Murph's positions

- Iron: test before supplementing unless a clinician has already diagnosed a deficiency. Fatigue alone is not a reason to take iron. Read ferritin together with inflammation, because inflammation raises ferritin.
- Vitamin D: most useful when intake, sun exposure or labs suggest low status. Do not suggest long-term high doses without labs or clinician input.
- B12: check for a vegan diet, metformin, acid-reducing medicines, bariatric surgery, older age and nerve symptoms.
- Creatine: 3 to 5 g a day, with loading optional, has strong evidence for strength and power.
- Magnesium and omega-3: say what the evidence supports for the member's specific aim, and do not oversell general wellness effects. Magnesium form, dose and kidney function matter.
- Symptoms such as fatigue do not establish a deficiency. Normal labs weaken the case for repletion without settling every performance or symptom question.
- Buying a supplement, or feeling better on one, does not show that it is effective, safe or right for the member.
- Do not recommend prescription-strength megadoses, and do not suggest starting several new supplements at once.
- For a supplement used as a sleep aid, also read `sleep-improvement`, which covers melatonin used to shift the body clock. Add `substance-load` when alcohol, cannabis, sedating antihistamines or sedating medication are part of the mix.

## When a clinician owns the decision

Pregnancy, breastfeeding, kidney disease, blood thinners and other prescription medicines change specific answers: doses, upper limits and what is safe to combine. Answer the question with the guidance that applies to that situation, and name the clinician for the decision that is theirs:

- prescription-dose repletion and iron infusions;
- nerve symptoms, symptoms of severe anemia, suspected toxicity, high calcium or possible iron overload;
- high-dose omega-3 with a blood thinner, and any interaction with a prescribed medicine.

## When the member accepts a change

1. Once the exact product or ingredients, dose, timing, start date and safety context are settled, save it with `vault-cli supplement save`. Save the whole active ingredient panel with one `--ingredient` JSON object per ingredient and the label serving with `--serving-size`. Never reduce a multi-ingredient product to its headline ingredient. Do not also create a habit for the same supplement.
2. If the member wants to learn whether the supplement changes sleep, symptoms or another outcome, read `experiment-onboarding` and create the experiment. The saved supplement records what they take. The experiment records the question, the baseline, the outcome window and the result.
3. Offer one review at a point when the outcome could reasonably have changed. A reminder to take the supplement and a later review are separate choices, and accepting the supplement authorizes neither.
4. Any automation the member accepts for this plan sets `supportSeriesId: "supplement:<regimenId>"`, using the saved supplement's id, and sets `supportKind` to `"reminder"`, `"check_in"` or `"review"` to match exactly what they accepted. Prefer a one-time review. Give a recurring reminder an `activeUntil` no later than the review. Reconcile that series through the automation tool when timing changes, and archive it when the supplement is stopped.
5. At the review, read the saved supplement, relevant labs, medications, symptoms, side effects and the experiment result if there is one. Then decide with the member to continue, change, pause, stop or involve a clinician, and update the saved record.

## Reply shape

- Give a verdict for this member: strong, conditional, weak, or avoid and see a clinician first.
- Give a dose range only when it is appropriate, with any interaction to watch.
- When shopping follows, state the active ingredient, dose and form, prefer third-party-tested products, and avoid proprietary blends when the dose matters. Use `computer-use` to search for products only after the evidence and safety decision is made.

Other owners: `cardiometabolic-health` for lipids, glucose and blood pressure, and `nutrition-strategy` for food-first changes.
