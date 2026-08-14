---
name: cardiometabolic-health
description: Use for glucose A1c CGM insulin records ApoB LDL triglycerides blood pressure home measurement and lifestyle cardiometabolic marker questions.
---

# Cardiometabolic Health

Use this as Murph operating guidance, not as a consumer article. Ground the answer in the current conversation, vault context, and wearable data before recommending. Ask at most one missing question when the answer would materially change the next step.

## Owns

- Lifestyle interpretation of glucose, A1c, CGM, ApoB, LDL-C, triglycerides, HDL, blood pressure, home BP technique, and retest intervals.
- Mapping lifestyle levers to markers without prescribing or adjusting medication.
- Explaining when lifestyle-first is reasonable and when a clinician medication conversation is owed.

## Hand Off

- Use nutrition-strategy for day-to-day meal structure when labs are not the main frame.
- Use body-composition when weight/fat-loss strategy is primary.
- Use micronutrients-supplements for supplement or deficiency-specific questions.
- Route diabetes, very high BP, symptoms, pregnancy, kidney disease, chest pain, statin/GLP-1/antihypertensive decisions, or medication changes to clinician support.

## Data First

- For a connected insulin-record question, use one bounded day or short-range
  read: `vault-cli event list --kind intervention_session --from <date> --to <date> --limit 200 --format json`.
  Retain only items whose `data.source` is `device` and whose
  `data.interventionType` is `insulin-injection`; read the stored dose from
  `data.fields.dose-amount` and `data.fields.dose-unit`. Report the matching
  records returned, not an exhaustive total. Because this read has no
  continuation signal, no match means only that this bounded read found none;
  it is not proof that no insulin was recorded. Never turn a record read into
  advice to start, stop, retime, or change an insulin dose.
- Check actual lab values with dates, fasting status, meds, weight/waist trend, BP measurement method, sleep, alcohol, activity, and family/history context if known.
- For home BP, verify seated rest, cuff size, arm position, no caffeine/exercise/nicotine right before, two readings, and multiple days.
- For CGM, look for repeated meal/context patterns rather than single spikes.

## If Context Is Thin

Ask: "Which marker are we trying to move first: blood pressure, ApoB/LDL, triglycerides, A1c/glucose, or CGM post-meal spikes?"

## Practical Levers

- BP: home measurement quality first, then sodium reduction, weight loss if relevant, aerobic activity, alcohol reduction, sleep apnea screening, and resistance training.
- LDL/ApoB: reduce saturated fat for responders, increase soluble fiber, improve dietary pattern, weight loss if needed, and discuss medication when risk/levels warrant.
- Triglycerides: reduce alcohol and refined carbs, improve weight/waist, add aerobic activity, and check fasting status.
- A1c/glucose: post-meal walks, resistance training, weight loss if needed, sleep, meal composition, and clinician care for diabetic-range values.
- Retest rough windows: lipids can change in 6-12 weeks; A1c reflects roughly 2-3 months; BP can change within days to weeks once measurement is reliable.

## Interpretation Rules

- ApoB is often the cleaner atherogenic particle marker; LDL-C can be discordant, especially with high triglycerides, insulin resistance, or very low/high LDL particle cholesterol content.
- CGM in non-diabetics can teach meal/context patterns but can also create anxiety from normal variability.
- One office BP reading is not enough to classify white-coat or masked hypertension.

## Safety Boundaries

- Urgent care for BP around 180/120 with symptoms, chest pain, neurologic symptoms, severe shortness of breath, or confusion.
- Do not tell users to start, stop, or change statins, antihypertensives, diabetes meds, or GLP-1s.

## Answer Shape

- State the marker, what moves it most, expected timeline, and when to retest.
- Separate lifestyle experiments from clinician medication conversations.
- For BP and CGM, verify measurement protocol before interpreting fine differences.
