---
name: cardiometabolic-health
description: Use for glucose A1c CGM ApoB LDL triglycerides blood pressure home measurement and lifestyle cardiometabolic marker questions.
---

# Cardiometabolic Health

Owns lifestyle interpretation of glucose, A1c, CGM, lipids, ApoB, triglycerides, HDL, blood pressure, retest timing, and clinician handoffs for medication decisions.

Use this as Murph operating guidance, not as a consumer article. Ground the answer in the current conversation, vault context, and wearable data before recommending. Ask at most one missing question when the answer would materially change the next step. Keep clinician, safety, and existing skill handoffs intact.

## Research Guidance

Skill 1: cardiometabolic-health
1. Scope and ownership

Owns: glucose/A1c/fasting glucose/CGM interpretation, lipids including LDL-C, non-HDL-C, triglycerides, HDL-C, ApoB and Lp(a), and blood pressure interpretation for a lifestyle assistant. This skill decides what marker is most actionable, which lifestyle lever is most likely to move it, how soon to re-measure, and when "lifestyle-first" becomes incomplete without a clinician medication-risk conversation.

Does not own: prescribing or adjusting statins, antihypertensives, GLP-1s, metformin, insulin, thyroid meds, testosterone, diuretics, or supplements as treatment; diagnosing diabetes, hypertension, familial hypercholesterolemia, coronary disease, kidney disease, endocrine disease, or eating disorders; pregnancy/postpartum BP or glucose management; pediatric/adolescent cardiometabolic management; acute chest pain, stroke symptoms, hypertensive emergency, severe hypoglycemia, or pancreatitis symptoms.

Route boundaries:
For sleep apnea, insomnia, sleep debt, and "deep sleep" claims, route to sleep skill while noting BP/glucose relevance. For weight-loss planning, body-fat goals, muscle gain, or DEXA/body composition interpretation, route to body-composition/weight skill. For food logging mechanics, meal planning, or adherence workflows, route to food-journaling skill. For lab panels outside cardiometabolic markers, route to labs/clinician skill.

2. Discovery: what context changes the recommendation

Murph should first check the vault, lab history, wearable integrations, food journal, and conversation memory. Ask only the highest-ranked unanswered item, in one textable question.

Rank	Check first or ask	Highest-information item	Why it changes the advice	Typical answer implies
1	Check vault/labs first	Most recent A1c, fasting glucose, lipid panel, ApoB, Lp(a), BP readings, dates, fasting status, and current meds	Determines whether this is glucose-first, LDL/ApoB-first, TG-first, or BP-first; also decides lifestyle-only vs clinician conversation	A1c 5.8 with TG 230 -> insulin resistance/TG lever. LDL 185/ApoB high -> lipid-risk conversation. BP 145/92 average -> BP-med conversation plus lifestyle.
2	Check vault, then ask	Existing ASCVD, stroke/TIA, diabetes, CKD, pregnancy/postpartum, HIV, familial hypercholesterolemia, smoking, sleep apnea, or relevant meds	These move the user from "general lifestyle optimization" to higher-risk guideline pathways	Diabetes/CKD/ASCVD means lower LDL/BP thresholds and clinician co-management. Pregnancy/postpartum routes out.
3	Ask if BP involved	"Were those BP readings taken with an upper-arm cuff after 5 quiet minutes, feet flat, arm supported, and two readings 1 minute apart?"	Bad BP technique is one of the biggest false-signal sources	Single rushed wrist reading after coffee -> repeat protocol before advising. Seven-day upper-arm average -> actionable.
4	Check wearable/vault, then ask	Weight/waist trend and recent weight change	Weight loss meaningfully moves BP, TG, glucose, and sometimes ApoB; weight gain can explain worsening	Central weight gain + rising TG/A1c -> prioritize weight/waist, protein/fiber, activity, alcohol, sleep. Stable lean user with LDL high -> prioritize dietary fat pattern/ApoB risk.
5	Ask if diet unknown	"Which is the bigger pattern lately: high saturated fat, refined carbs/sugary drinks, low fiber, salty restaurant food, or alcohol?"	Each diet pattern maps to different markers	Butter/cheese/coconut oil -> LDL/ApoB. Sugary drinks/refined carbs/alcohol -> TG/glucose. Restaurant/processed food -> BP/sodium.
6	Check wearable, then ask	Weekly aerobic minutes, resistance training, steps, and sedentary time	Exercise has broad but marker-specific effects; wearable steps alone may miss resistance and intensity	Sedentary + high BP/glucose/TG -> exercise is high-yield. Already active -> diet/weight/sodium/alcohol may matter more.
7	Check wearable/vault first	Sleep duration/regularity, suspected sleep apnea, shift work, high stress	Sleep apnea and sleep debt can raise BP and glucose; lifestyle advice fails if this driver is unaddressed	Snoring + daytime sleepiness + high BP -> route to sleep/clinician for OSA while continuing BP basics.
8	Ask if lipid decision unclear	Family history of premature ASCVD, early high LDL, xanthomas, high Lp(a), South Asian/Filipino ancestry, early menopause, preeclampsia, gestational diabetes	These are risk enhancers that change urgency and clinician conversation	LDL 160 plus premature family history -> not "just try oatmeal"; needs risk discussion.
9	Ask if CGM involved	"Are you using CGM for diabetes/prediabetes care, or just curiosity/optimization?"	CGM evidence and interpretation are very different by baseline glycemia	Prediabetes -> CGM can guide targeted experiments. Normoglycemic/anxious -> time-limited use, avoid score chasing.
10	Ask if lab result surprising	Fasting status, recent illness, heavy exercise, alcohol in prior 24-72h, unusually high-fat/sugar meal, major weight loss phase	Especially changes triglycerides, fasting glucose, and sometimes LDL calculation	Nonfasting TG 420 after alcohol/high-fat meal -> repeat fasting before conclusions.
3. Lever -> outcome map with evidence tiers
Marker thresholds Murph must know

Glucose/A1c. ADA diagnostic cutoffs: A1c normal <5.7%, prediabetes 5.7-6.4%, diabetes range >=6.5%; fasting plasma glucose normal <100 mg/dL, prediabetes 100-125, diabetes range >=126; 2-hour OGTT normal <140, prediabetes 140-199, diabetes range >=200. A1c reflects roughly the prior 2-3 months, while fasting glucose requires no calories except water for at least 8 hours. Prediabetes should generally be rechecked every 1-2 years, and lifestyle programs in people at risk can substantially reduce diabetes incidence.
American Diabetes Association

Blood pressure. AHA/ACC categories: normal <120/<80, elevated 120-129 and <80, stage 1 hypertension 130-139 or 80-89, stage 2 >=140 or >=90, severe >180 and/or >120, and hypertensive emergency when severe BP is accompanied by symptoms such as chest pain, shortness of breath, back pain, numbness, weakness, vision change, or difficulty speaking.
www.heart.org

When lifestyle-only stops being appropriate for BP. Lifestyle still matters, but Murph should explicitly recommend a clinician medication conversation for confirmed average BP >=140/90, or confirmed >=130/80 with clinical CVD, prior stroke, diabetes, CKD, or PREVENT 10-year CVD risk >=7.5%. For lower-risk stage 1 hypertension, the 2025 guidance supports medication if BP remains >=130/80 after 3-6 months of lifestyle work.
Target:BP

Lipids. The 2026 ACC/AHA dyslipidemia guideline restores LDL-C/non-HDL-C goals: LDL-C <100 mg/dL for borderline/intermediate primary-prevention risk, <70 mg/dL for high risk, and <55 mg/dL for very-high-risk secondary prevention. It recommends PREVENT risk estimation for adults 30-79, Lp(a) at least once in adulthood, and ApoB especially when TG >200, diabetes, low achieved LDL-C, or residual risk is suspected. Lifestyle minimally affects Lp(a), so high Lp(a) changes LDL-risk intensity rather than becoming a lifestyle target.
professional.heart.org

When lifestyle-only stops being appropriate for lipids. Murph should not say "just lifestyle" when LDL-C/ApoB is very high, LDL-C is >=160 mg/dL with strong family history/risk enhancers, suspected familial hypercholesterolemia, known ASCVD, diabetes/CKD/HIV, high PREVENT risk, or persistent triglycerides in severe ranges. The 2026 guideline says LDL-lowering therapy can be considered at borderline 10-year PREVENT risk 3% to <5% and should be considered at 5% to <10% after clinician-patient discussion.
professional.heart.org
+1

Lifestyle lever map
Lever	Expected marker movement	Evidence tier	Time-to-effect	Applies most to	Murph operating line
Replace saturated/trans fats with unsaturated fats, nuts, seeds, fish, legumes, and whole grains; DASH/Mediterranean/Portfolio-style pattern	LDL/ApoB: moderate to large. Replacing saturated fat with PUFA lowers LDL-C roughly 10-16 mg/dL in RCT meta-analysis settings; DASH lowers LDL-C about 4-11 mg/dL depending comparison. TG: small unless refined carbs/alcohol also fall. HDL: not a target. BP: DASH lowers BP about 5/3 mmHg. A1c/glucose: small unless weight or carb quality changes.	Strong for LDL-C and BP; moderate for glucose/TG	4-12 weeks for LDL/ApoB; 1-4 weeks for BP	High LDL-C/ApoB, high BP, mixed cardiometabolic risk	"For LDL/ApoB, the replacement matters: swap butter/cheese/coconut oil/fatty processed meat toward olive oil, nuts, fish, legumes, oats-not refined carbs."
American College of Cardiology
+3
Johns Hopkins University
+3
ScienceDirect
+3

Dietary cholesterol moderation	LDL-C: smaller and variable; meta-regression estimates +2.7 to +5.5 mg/dL LDL-C per +100 mg/day dietary cholesterol depending baseline. Saturated fat usually matters more. ApoB: may move with LDL particle burden in responders. TG/BP/glucose: usually not primary.	Moderate	4-12 weeks	LDL/ApoB high plus high egg yolk/organ meat/shellfish intake, especially with high saturated fat	"Don't make eggs the whole story. If LDL/ApoB is high, first reduce saturated fat; then moderate high-cholesterol foods if intake is high or response is strong."
American Journal of Clinical Nutrition

5-10% weight loss / waist reduction when excess adiposity is present	TG: often large; 5-10% weight loss can lower TG about 20%. BP: about 1 mmHg systolic per kg lost in RCT meta-analysis. A1c/fasting glucose: moderate to large in prediabetes/T2D; Diabetes Prevention Program-style weight loss/activity reduced diabetes risk 58%. LDL/ApoB: modest; more improvement when visceral fat/TG/non-HDL are high. HDL: may rise modestly after weight stabilizes.	Strong for BP, TG, diabetes prevention; moderate for LDL/ApoB	8-24 weeks; BP can move sooner	Overweight/obesity, central adiposity, high TG, prediabetes, high BP	"Weight is the broadest lever when BP + TG + glucose are all off; it is not the only LDL lever."
AHA Journals
+2
American College of Cardiology
+2

Aerobic exercise + resistance training	BP: in hypertensive adults, exercise lowers about 7.5/4.4 mmHg. Prediabetes: A1c about -0.25%, fasting glucose about -6 mg/dL. T2D: A1c about -0.36% to -0.74% depending modality/dose. Lipids: small to moderate; in T2D meta-analysis LDL-C -7-12 mg/dL, TG -16-18 mg/dL, HDL +2-4 mg/dL.	Strong RCT/meta-analytic support	2-12 weeks; full habit effect 3-6 months	Sedentary users, high BP, prediabetes/T2D, high TG, low fitness	"Use exercise as a BP/glucose/TG lever first; do not promise huge LDL drops from exercise alone."
Nature
+2
ScienceDirect
+2

Fiber, especially viscous soluble fiber	LDL-C: small to moderate; 3-4 g/day oat beta-glucan lowers LDL-C about 6%, often ~5-10 mg/dL. A1c: in T2D, viscous soluble fiber reduces A1c about 0.3-0.5%. BP: small, about -1 to -2 systolic. TG/HDL: inconsistent or small.	Strong for LDL-C; moderate for glycemia/BP	4-12 weeks	High LDL/ApoB, constipation/low fiber diet, prediabetes/T2D	"Fiber is a real lever, but it is additive-not a substitute for addressing saturated fat, weight, activity, or meds when indicated."
ScienceDirect
+2
Frontiers
+2

Sodium reduction / restaurant and processed-food reduction	BP: moderate to large in responders. A trial reducing sodium by ~4,000 mg/day showed systolic BP about 6 mmHg lower than usual diet and 7-8 mmHg lower than high-sodium diet within one week. Lipids/glucose: no meaningful direct effect.	Strong for BP	Days to 4 weeks	Elevated BP/stage 1-2 HTN, older adults, salt-sensitive users, high restaurant/processed food intake	"Sodium is a BP lever, not a cholesterol lever. The fastest test is a 1-2 week low-sodium experiment with home BP averages."
American Heart Association

Alcohol reduction	BP: meaningful mainly above ~2 drinks/day; strongest in heavy intake-about -5.5/-4.0 mmHg when >=6 drinks/day is cut roughly in half. TG: can improve substantially if alcohol is driving high TG. HDL: may fall; that is not a reason to keep drinking. A1c/glucose: mixed; alcohol can worsen sleep, weight, TG, and overnight glucose stability.	Strong for BP in heavier drinkers; moderate for TG	1-4 weeks	High BP, high TG, poor sleep/recovery, weight gain, regular alcohol	"If alcohol is >2 drinks/day or clustered on weekends, it is a BP/TG/sleep lever. Do not frame alcohol as heart-protective."
PubMed
+1

CGM-guided meal experiments	Mean glucose: may improve in prediabetes or dysglycemia; evidence is weaker in healthy normoglycemic users. A1c: possible if baseline dysglycemia and behavior changes persist. Weight/BMI: CGM alone has not shown reliable BMI reduction. LDL/BP: no direct effect.	Moderate/early for prediabetes behavior change; weak for healthy users; long-term outcomes unknown	10-14 days for pattern learning; 3 months for A1c	Prediabetes, suspected post-meal dysglycemia, specific food experiments	"CGM is biofeedback, not a diagnosis. Use it to compare repeatable meals and behaviors, not to fear every spike."
Springer Nature Link
+1

Common cholesterol supplements: OTC fish oil, garlic, cinnamon, turmeric, red yeast rice, plant sterols as generic supplements	LDL-C: in SPORT, these did not lower LDL-C more than placebo, while low-dose rosuvastatin did. TG: OTC fish oil may lower TG at high doses but is not equivalent to prescription EPA and can confuse LDL/AF risk discussions. BP/A1c: not primary.	Popular but unsupported for LDL-C; some products have safety/quality issues	Do not use as primary plan	Users asking "natural statin alternative"	"Do not use supplements to delay a medication conversation. Food-based fiber is different; unregulated cholesterol supplements are not a statin substitute."
American Heart Association
+1
ApoB vs LDL-C: operating rules

LDL-C is the cholesterol mass inside LDL particles and remains a core guideline target. ApoB is closer to the number of atherogenic particles because each LDL, VLDL remnant, IDL, and Lp(a) particle carries ApoB. When LDL-C and ApoB agree, Murph can keep the explanation simple. When they disagree, ApoB is especially useful in high triglycerides, diabetes, metabolic syndrome/central adiposity, CKM syndrome, known CVD, or low achieved LDL-C; the 2026 guideline specifically calls out TG >200, diabetes, low LDL-C <70, and residual-risk settings.
professional.heart.org
+1

Discordance handling:

ApoB high, LDL-C "normal": do not reassure based on LDL-C alone. The user may have many cholesterol-poor atherogenic particles, common with insulin resistance/high TG.

LDL-C high, ApoB less high: risk may be less particle-dense, but LDL-C still matters and guideline targets still apply.

High Lp(a): do not promise lifestyle will lower it. Use it as a risk enhancer that makes LDL-C/ApoB/BP/smoking control more important.

Murph should never say: "Your HDL is high, so LDL/ApoB doesn't matter."

Saturated fat and dietary cholesterol: honest framing

The practical hierarchy is: eliminate trans fats; reduce saturated fat when LDL-C/ApoB is high; replace saturated fat with unsaturated fats or high-fiber whole foods; avoid replacing saturated fat with refined starch/sugar. Replacing saturated fat with refined carbohydrates does not reliably reduce coronary risk, while replacement with unsaturated fats or whole grains is the evidence-based move. Current dietary guidance still uses saturated fat <10% of calories as a population target; AHA analyses also emphasize replacement quality, not just lowering fat.
American College of Cardiology
+2
professional.heart.org
+2

Dietary cholesterol is not irrelevant, but it is usually a smaller lever than saturated fat and total dietary pattern. For LDL/ApoB-high users eating many eggs plus butter/cheese/bacon, first fix the saturated-fat matrix; then test whether reducing egg yolks or other high-cholesterol foods adds LDL/ApoB improvement.

4. Wearable-data interpretation
What consumer devices measure well vs poorly

Labs are not wearable metrics. WHOOP, Apple Watch, Garmin, and Oura do not measure LDL-C, ApoB, Lp(a), triglycerides, A1c, or fasting plasma glucose. They can provide context-activity, sleep duration, resting heart rate, HRV, sometimes weight via connected scales-but lab markers require blood testing.

CGM measures interstitial glucose, not blood glucose. CGMs estimate glucose in interstitial fluid every few minutes, usually over 7-15 sensor days, and show trends, time-in-range-style metrics, and meal responses. Interstitial glucose lags blood glucose, especially during rapid changes after meals or exercise; Endotext describes typical lag around 5-10 minutes and warns that readings can deviate during rapid changes.
Hopkins Guides
+1

CGM in non-diabetics: useful signal is repeated pattern, not a single spike. Signal includes repeated large post-meal excursions after the same meal, glucose staying elevated for 2-3+ hours, high overnight/fasting patterns, dawn effect, and clear improvements from meal order, protein/fiber, walking after meals, alcohol reduction, sleep, or portion changes. Noise includes compression lows during sleep, first-day sensor weirdness, dehydration/adhesive issues, medication interferences, interstitial lag, and isolated spikes after normal mixed meals. CGM cannot diagnose prediabetes or diabetes; diagnosis still uses lab A1c, plasma glucose, or OGTT.
VCU Health
+1

BP wearables: an upper-arm validated cuff is the measurement standard. The Apple Watch hypertension notification feature is a screening/notification feature, not a BP measurement; it analyzes photoplethysmography over time. WHOOP-style wrist BP estimates and Oura/Samsung-style cuffless trends should be treated as prompts to verify with a validated cuff, not as diagnostic BP values. Garmin's Index BPM is a separate upper-arm cuff device, not a watch-only measurement; Garmin lists BP accuracy around +/-3 mmHg or +/-2% when used correctly. The 2025 hypertension guideline materials note that more studies are still needed for cuffless/wearable BP monitors.
AHA Journals
+2
Garmin
+2

Home BP protocol: the thing most people do wrong

The common failure is treating a single rushed reading as truth. Proper home BP: validated upper-arm cuff, correct cuff size, bare arm, no caffeine/smoking/exercise for 30 minutes, empty bladder, sit with back supported and feet flat, rest quietly 5 minutes, arm supported at heart level, no talking or phone use, take two readings one minute apart, and record them. For a reliable average, use at least 3 days and preferably 7 days; AHA's home BP log says two morning and two evening readings for 3 days minimum and 7 days preferred before an appointment.
www.heart.org
+1

White-coat vs masked patterns:
White-coat hypertension means office high but out-of-office normal. Masked hypertension means office normal but home/ambulatory high. Masked hypertension is easy to miss and carries more risk than white-coat patterns; USPSTF notes ABPM is the strongest confirmation method, with HBPM useful when ABPM is not available.
U.S. Preventive Services Task Force

Noise bands and minimum data

Home BP: day-to-day swings of 5-10+ mmHg are common. Do not call a trend from one reading. Use a 3-7 day average, same protocol, same cuff.

CGM: in normoglycemic users, differences around 10 mg/dL can be sensor noise, timing, lag, or normal physiology. Use 10-14 days or repeated meal experiments.

Lipids: LDL-C/non-HDL/ApoB need blood tests and are best judged after 4-12 weeks of stable behavior. Triglycerides are noisier and sensitive to fasting status, alcohol, recent carbohydrate/fat intake, illness, and weight change.

A1c: judge over ~3 months, not daily.

RHR/HRV/sleep from wearables: useful for stress/recovery context, not direct cardiometabolic diagnosis. Use 2-4 week baselines, not one-night HRV.

5. Myths and failure modes

Myth: "A glucose spike over 140 means I'm diabetic."
Say instead: "A single CGM spike is not diagnostic. Let's look at repeated post-meal patterns, fasting/overnight glucose, and lab A1c or fasting glucose."

Myth: "My HDL is high, so LDL/ApoB doesn't matter."
Say instead: "HDL is not a shield. LDL-C, non-HDL-C, ApoB, BP, diabetes risk, smoking, and family history still drive risk decisions."

Myth: "ApoB replaces LDL for everyone."
Say instead: "ApoB is most useful when LDL-C may underestimate particle risk-high TG, diabetes/prediabetes, central adiposity, CKM, or low LDL on therapy."

Myth: "Butter, coconut oil, or tallow are heart-healthy because they're natural."
Say instead: "Natural does not mean LDL-neutral. For LDL/ApoB, replacing saturated fat with unsaturated fat or high-fiber whole foods is the evidence-based move."

Myth: "Dietary cholesterol is the only thing that matters."
Say instead: "Dietary cholesterol can matter, but saturated fat and the replacement food usually matter more."

Myth: "Supplements are safer than statins and work just as well."
Say instead: "Most popular cholesterol supplements do not lower LDL reliably versus placebo and can delay proven care. Bring medication questions to a clinician; Murph can help with lifestyle foundations."

Myth: "One high BP reading means hypertension."
Say instead: "One reading is a snapshot. Repeat with correct technique and average several days."

Myth: "My watch says my BP is fine."
Say instead: "Watch trends can be useful prompts, but diagnosis and medication decisions need a validated cuff or ambulatory monitor."

Failure mode: too many changes at once.
Murph should pick the dominant marker and one lever for 2-4 weeks: sodium for BP, saturated fat/fiber for LDL/ApoB, alcohol/refined carbs/weight for TG, post-meal walk/fiber/protein/weight for glucose.

Failure mode: quitting before time-to-effect.
BP and CGM can change in days to weeks; LDL/ApoB usually needs 4-12 weeks; A1c needs about 3 months.

Failure mode: chasing scores instead of outcomes.
Murph should redirect from daily CGM/BP panic to averaged patterns, symptoms, and lab-confirmed change.

6. Safety and escalation lines

Urgent/emergency routing

BP >180 systolic and/or >120 diastolic with chest pain, shortness of breath, back pain, numbness, weakness, vision change, confusion, or trouble speaking -> emergency services now.

BP >180 and/or >120 without symptoms -> repeat after resting; if still severe, contact clinician urgently. Do not exercise, sauna, or "sweat it out."

Stroke or heart attack symptoms at any BP -> emergency services.

Severe abdominal pain with very high triglycerides or known hypertriglyceridemia -> urgent care/ER for pancreatitis concern.

CGM/fingerstick very high with vomiting, dehydration, confusion, deep breathing, or severe weakness -> urgent care/ER.

Low glucose symptoms with confusion, fainting, seizure, or inability to self-treat -> emergency care.

Clinician handoff, not necessarily emergency

A1c >=6.5%, fasting glucose >=126, or OGTT >=200: do not diagnose; say this is in the diabetes range and needs clinician confirmation/evaluation.

A1c 5.7-6.4 or fasting glucose 100-125: prediabetes range; lifestyle is appropriate, but clinician follow-up matters.

Confirmed average BP >=140/90, or >=130/80 with diabetes, CKD, CVD, prior stroke, or elevated PREVENT risk: medication conversation owed.

Persistent stage 1 BP after 3-6 months of good lifestyle work: medication conversation owed.

LDL-C >=190, LDL-C >=160 with strong risk enhancers/family history, very high ApoB, or suspected familial hypercholesterolemia: clinician lipid evaluation.

Triglycerides >=500: clinician follow-up soon; >=1000: prompt treatment discussion because pancreatitis prevention may require medication. The 2026 guideline specifically highlights TG >=1000 mg/dL for pancreatitis-prevention therapies.
professional.heart.org

Populations where standard advice can be wrong

Pregnancy/postpartum or trying to conceive: route to clinician; BP, glucose, and lipid medication rules differ.

Adolescents: pediatric thresholds and family-based care; route.

Older adults/frail users/fall risk/orthostatic symptoms: BP targets and weight-loss advice must be individualized.

Eating-disorder history: avoid calorie targets, weight-loss pressure, CGM obsession, or restrictive food rules; route to appropriate care.

Diabetes on insulin/sulfonylureas: exercise, fasting, alcohol reduction, and carb changes can cause hypoglycemia; no dosing advice.

SGLT2 inhibitors, CKD, heart failure, diuretics, ACE inhibitors/ARBs, anticoagulants: sodium/potassium/fluid/fasting advice may be unsafe without clinician context.

Anemia, hemoglobin variants, CKD, pregnancy, recent blood loss/transfusion: A1c may mislead; route for lab interpretation.

Alcohol dependence: do not advise abrupt cessation without medical support.

Never do

Do not diagnose from one wearable or lab value. Do not prescribe, dose, start, stop, or adjust medications. Do not recommend extreme fasting, dehydration, saunas, laxatives, or supplement stacks for cardiometabolic markers. Do not tell users to ignore clinician-recommended medication because lifestyle may help.

7. Realistic timelines and re-measurement
Marker / signal	Minimum useful measurement	Recheck after intervention	"Working" looks like	"Not working" looks like
Home BP	3 days minimum, 7 days preferred; two readings AM and PM, one minute apart	Sodium/alcohol changes: 1-2 weeks. Exercise/DASH/weight: 4-12 weeks. Low-risk stage 1 medication decision: 3-6 months.	Average drops >=5 mmHg systolic or category improves	Still >=130/80 after 3-6 months, or >=140/90 confirmed sooner -> clinician medication conversation
LDL-C / non-HDL-C / ApoB	Blood test; note fasting status and weight stability	4-12 weeks after sustained diet/fiber/weight/activity change; same interval used after lipid therapy changes	LDL-C down ~5-15 mg/dL from diet/fiber changes; ApoB/non-HDL trend down	No meaningful change after verified adherence, LDL/ApoB still high-risk, or risk enhancers present -> clinician conversation
Triglycerides	Prefer fasting if prior TG high or nonfasting value surprising	2-8 weeks after alcohol/refined-carb/weight changes; repeat fasting if nonfasting TG high	TG down 20% is realistic with weight loss/alcohol/refined-carb improvements when those are drivers	TG >=500 persists, or >=1000 at any point -> clinician; severe abdominal pain -> urgent
A1c	Lab A1c; interpret with conditions that affect red blood cells	About 3 months	Prediabetes: -0.2 to -0.3% is meaningful; T2D: -0.5% is meaningful	A1c rising or diabetes-range result -> clinician confirmation/treatment discussion
Fasting glucose	True 8+ hour fast, water only	2-12 weeks; sooner than A1c	Lower fasting average, especially with weight/sleep/activity changes	Repeated fasting >=126 or symptoms -> clinician
CGM	10-14 day wear; ignore single events	Re-test specific meal/exercise/sleep experiments within days; compare repeat meals	Lower repeated post-meal peak, shorter time elevated, better overnight/fasting pattern	Persistent high fasting/overnight patterns or frequent large excursions -> lab confirmation/clinician, not more CGM anxiety
Activity/sleep wearable context	2-4 week same-device baseline	Weekly trend review	More active minutes, lower resting HR over weeks, improved sleep regularity	No adherence improvement or symptoms suggest OSA/stress/med issue -> route to adjacent skill/clinician
Fasting-for-labs practicalities

A1c does not require fasting. Fasting glucose requires at least 8 hours with no calories except water. Lipid panels may be fasting or nonfasting depending on the clinical question; AHA says the clinician may order either. For practical Murph interpretation: if triglycerides have been normal, nonfasting lipids are often usable; if triglycerides are high, the result is surprising, the user had alcohol or a very fatty/sugary meal, or LDL-C is being calculated near a decision threshold, repeat with an 8-12 hour fast and no alcohol for 24-72 hours. Nonfasting triglycerides >400 mg/dL commonly warrant fasting repeat, while some guidance uses lower follow-up thresholds when TG are >200.
www.heart.org
+2
PMC
+2
