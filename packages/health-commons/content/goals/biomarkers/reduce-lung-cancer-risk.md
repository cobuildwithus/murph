---
schemaVersion: murph.commons.page.v1
entityType: goal_template
key: goal_template:reduce-lung-cancer-risk
slug: reduce-lung-cancer-risk
title: Lower My Risk of Lung Cancer
summary: Lower lung cancer risk by avoiding tobacco, testing for radon, reducing hazardous exposures, and using screening when eligible.
status: field-testing
quality: usable
aliases:
  - prevent lung cancer
  - reduce my lung cancer risk
categories:
  - goals
  - biomarkers
  - cancer-prevention
goal:
  category: biomarkers
  outcomeKind: function
  goalPhrase: lower my risk of lung cancer
  successSignals:
    - id: tobacco_exposure
      kind: behavior
      label: Smoking stops and secondhand smoke exposure is minimized
    - id: radon_and_workplace_exposure
      kind: milestone
      label: Home radon and relevant workplace hazards are assessed and mitigated
    - id: lung_screening
      kind: milestone
      label: Eligible screening is completed with appropriate follow-up
  evidenceSourceKeys:
    - source_artifact:dietaryguidelines-dietary-guidelines-for-americans-2025-2030-2026-01-01
  workflow:
    kind: general_plan
    ownerSkillIds:
      - substance-load
  startPrompt: Hey Murph, help me lower my risk of lung cancer.
  indexable: true
safety:
  cautionLevel: moderate
  stopIf:
    - Coughing blood, new severe breathlessness, chest pain, or unexplained persistent respiratory symptoms needs medical evaluation.
---

Tobacco smoke is the largest preventable cause of lung cancer. Quitting at any age lowers risk, and the benefit keeps building with time. The next practical risks are radon in homes, secondhand smoke, and certain workplace exposures. For people with a substantial smoking history, annual low-dose CT screening can lower the chance of dying from lung cancer by finding disease earlier.

No food, supplement, chest X-ray, or consumer breathing score can cancel out ongoing smoke exposure. Do the high-impact actions first, then keep them up for years.

## What to do

- **Stop smoking with support.** Counseling plus approved medication works better than willpower alone. Nicotine replacement, varenicline, or bupropion may fit, depending on health history and preference.
- **Keep trying after a lapse.** A lapse tells you about triggers and treatment strength; it is not proof that quitting is impossible. Adjust the plan quickly rather than waiting for a new year.
- **Avoid secondhand smoke.** Make the home and car smoke-free, and ask people to smoke outside, away from doors and windows.
- **Test your home for radon.** Radon is invisible and odorless, so testing is the only way to know the level. Use a qualified mitigation professional if the result is high, and retest after mitigation.
- **Review workplace exposures.** Asbestos, silica, diesel exhaust, arsenic, and other hazards can matter. Use ventilation and respiratory protection through a proper occupational-safety program.
- **Check screening eligibility.** In the United States, annual low-dose CT is recommended for many adults aged 50 to 80 with at least a 20 pack-year smoking history who currently smoke or quit within 15 years. Eligibility and coverage can change, so confirm current guidance.
- **Do not substitute a chest X-ray.** Routine chest X-ray is not the recommended lung-cancer screening test.
- **Support overall health.** Activity, a nutritious diet, vaccines, and management of lung disease help function, but they do not replace tobacco, radon, and screening actions.

## A simple plan

Write down current tobacco or vape use, prior quit attempts, cigarettes per day and years smoked, secondhand exposure, radon-test status, occupational hazards, and whether you meet low-dose CT criteria. Work out pack-years with a clinician if needed.

If you smoke, set a quit date within the next month and arrange both medication and counseling. Remove tobacco supplies, tell one supportive person, and plan responses to the three situations most linked to your smoking. Order a radon kit this week. If eligible for screening, schedule a shared decision-making visit and use an accredited program with reliable follow-up.

## How to know it is working

The strongest signal is staying smoke-free, with fewer lapses and better control of triggers. Completing radon mitigation, using workplace protection, and staying current with eligible low-dose CT are concrete milestones. Screening can catch disease earlier; it does not prevent cancer and is not permission to keep smoking.

## What to expect

Withdrawal usually peaks early and eases over weeks, while cue-driven cravings can recur. Lung-cancer risk falls after quitting but does not immediately match a never-smoker's. Screening may find benign nodules that need follow-up and can cause anxiety; an organized screening program helps manage this safely.

Keep the plan current after a move or job change. A new home needs its own radon test, and a new worksite may bring different dusts or fumes. If you remain eligible for annual low-dose CT, schedule the next scan when the current result is reviewed so the series does not quietly stop. If eligibility ends, confirm why rather than substituting informal chest imaging.

## If you get stuck

Strengthen the quit treatment: combine counseling with medication, adjust the dose or product, use a quitline, and identify alcohol or social triggers. If a partner smokes, make a shared smoke-free-home plan even if they are not ready to quit. If radon results are confusing, use your state radon program or EPA-qualified resources.

## A quick note

Vitamin or antioxidant supplements have not been shown to undo smoking risk, and beta-carotene supplements can be harmful in smokers. A new persistent cough, coughing blood, unexplained weight loss, or chest symptoms deserve evaluation outside a routine screening schedule.

## Sources

- [CDC: reducing lung cancer risk](https://www.cdc.gov/lung-cancer/prevention/index.html)
- [USPSTF: lung cancer screening](https://www.uspreventiveservicestaskforce.org/uspstf/recommendation/lung-cancer-screening)
- [U.S. Environmental Protection Agency: radon](https://www.epa.gov/radon)

## Related goals

[Lower My Risk of Heart Disease](/goals/reduce-heart-disease-risk) · [Lower My Risk of Stroke](/goals/reduce-stroke-risk)
