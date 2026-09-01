import { defineComparisons } from "../types";

export const NUTRITION_COMPARISONS = defineComparisons([
  {
    category: "nutrition",
    chooseCompetitor:
      "Choose MyFitnessPal when fast food entry, barcode scanning, calorie targets, and a mature exercise ecosystem are the main job.",
    chooseMurph:
      "Choose Murph when the question is no longer only what you ate, but what matters, what fits, and what to do next. Murph can remember relevant context and help carry the resulting plan forward.",
    competitor: {
      clinicalRole:
        "A general wellness tracker. It does not diagnose conditions, prescribe treatment, or replace a clinician or dietitian.",
      followThrough:
        "Goals, diary feedback, streaks, reminders, fasting tools, and meal planning on the Premium tiers.",
      format:
        "A structured food and exercise diary with dashboards, goals, and optional meal-planning tools.",
      hardware:
        "No proprietary hardware is required. Supported wearables and smart scales can contribute activity, sleep, or weight data.",
      inputs:
        "Manual search, barcode, saved meals, recipes, photo, voice, weight, exercise, and supported health-platform data.",
      insightStyle:
        "Daily calorie and nutrient totals, goal progress, food patterns, and subscription-level reports.",
      platforms:
        "Web, iOS, and Android, with support for Apple Health, Health Connect, Fitbit, Garmin, Samsung Health, Withings, and other services.",
      pricing:
        "US pricing checked August 30, 2026: free tier; Premium $19.99 monthly or $79.99 yearly; Premium+ $24.99 monthly or $99.99 yearly. Offers can vary.",
      primaryJob:
        "Log food and exercise against calorie, weight, and macro goals.",
    },
    competitorEvidence: {
      clinicalRole: [1],
      followThrough: [2],
      format: [2],
      hardware: [3],
      inputs: [2, 3],
      insightStyle: [2],
      platforms: [2, 3],
      pricing: [1],
      primaryJob: [2],
    },
    faqs: [
      {
        answer:
          "MyFitnessPal has a free tier for basic food, weight, exercise, and progress tracking. Barcode scanning and several advanced logging and analysis tools require Premium in the United States.",
        question: "Is MyFitnessPal free to use?",
      },
      {
        answer:
          "MyFitnessPal connects with many health platforms and devices. Exact fields and availability depend on the operating system, country, device, and partner connection.",
        question: "What health data can MyFitnessPal collect?",
      },
      {
        answer:
          "Not if you want a precise calorie or macro diary. MyFitnessPal owns that job. Murph becomes useful when the log raises a wider question about sleep, training, symptoms, goals, or a realistic next step. Neither product replaces medical nutrition care.",
        question: "Would Murph replace my MyFitnessPal food diary?",
      },
    ],
    headline: "When a food diary needs a next step",
    lastVerified: "2026-08-31",
    metaDescription:
      "MyFitnessPal owns calorie and macro logging. Murph is a personal health assistant that connects the diary with wider context and carries the next step forward.",
    name: "MyFitnessPal",
    quickComparison: [
      {
        capability: "Searchable food database",
        evidence: "inputs",
        murph: "yes",
        competitor: "yes",
      },
      {
        capability: "Barcode food logging",
        evidence: "inputs",
        murph: "no",
        competitor: "limited",
      },
      {
        capability: "Calorie and macro diary",
        evidence: "primaryJob",
        murph: "yes",
        competitor: "yes",
      },
      {
        capability: "Cross domain health context",
        evidence: "inputs",
        murph: "yes",
        competitor: "limited",
      },
      {
        capability: "Cross topic plan support",
        evidence: "followThrough",
        murph: "yes",
        competitor: "limited",
      },
      {
        capability: "Works in iMessage or Telegram",
        evidence: "format",
        murph: "yes",
        competitor: "no",
      },
      {
        capability: "Handles health errands",
        evidence: "followThrough",
        murph: "yes",
        competitor: "no",
      },
      {
        capability: "Tests what works for you",
        evidence: "followThrough",
        murph: "yes",
        competitor: "no",
      },
      {
        capability: "Free start without a card",
        evidence: "pricing",
        murph: "yes",
        competitor: "yes",
      },
      {
        capability: "Open source option",
        evidence: "platforms",
        murph: "yes",
        competitor: "no",
      },
    ],
    relationship: "alternative",
    slug: "myfitnesspal",
    sources: [
      {
        label: "MyFitnessPal membership pricing tiers",
        url: "https://blog.myfitnesspal.com/myfitnesspal-membership-pricing-tiers/",
      },
      {
        label: "MyFitnessPal Premium features",
        url: "https://support.myfitnesspal.com/hc/en-us/articles/360032625951-MyFitnessPal-Premium-features",
      },
      {
        label: "MyFitnessPal compatible products and apps",
        url: "https://support.myfitnesspal.com/hc/en-us/articles/360032274232-What-kind-of-products-and-apps-work-with-MyFitnessPal",
      },
    ],
    tradeoffs: [
      "The free tier is useful, but barcode scanning and many deeper tools sit behind a subscription in the United States.",
      "A large database increases convenience while making it important to verify user-submitted foods and automated estimates.",
      "Its core workflow is a diary. That is efficient for totals and targets, but it is a different job from discussing a pattern across health domains and deciding how much attention it deserves. Murph covers the wider discussion but offers no searchable food database, barcode scanner, or calorie ledger.",
    ],
  },
  {
    category: "nutrition",
    chooseCompetitor:
      "Choose Cronometer when verified food records, detailed nutrient targets, biometrics, and exportable nutrition reports are the priority.",
    chooseMurph:
      "Choose Murph when a nutrient chart is the start of the question rather than the end. It can keep the relevant health history in the conversation, help weigh tradeoffs, and support a plan without requiring food tracking to become the whole project.",
    competitor: {
      clinicalRole:
        "The consumer app is a wellness tracker, not diagnosis or treatment. Cronometer also sells separate professional products for practices.",
      followThrough:
        "Targets, diary groups, fasting, food suggestions, charts, reports, and Crono Coach AI on Gold.",
      format:
        "A precise nutrition diary with nutrient dashboards, biometrics, notes, trends, and reports.",
      hardware:
        "No proprietary device is required. It can receive supported data from wearables, scales, glucose devices, and health platforms.",
      inputs:
        "Food search, barcode, recipes, exercise, biometrics, notes, photos on Gold, and supported device data.",
      insightStyle:
        "Nutrient adequacy, energy balance, biomarker charts, correlations, and detailed reports from curated food data.",
      platforms:
        "Web, iOS, and Android, with integrations including Apple Health, Health Connect, Garmin, Fitbit, WHOOP, Oura, Dexcom, Withings, and Keto-Mojo.",
      pricing:
        "US pricing checked August 30, 2026: Basic is free; Gold is $10.99 monthly or $59.99 yearly. Taxes and regional offers may differ.",
      primaryJob:
        "Measure energy, macro, micronutrient, exercise, and biometric intake or progress in detail.",
    },
    competitorEvidence: {
      clinicalRole: [4, 5],
      followThrough: [1],
      format: [1],
      hardware: [2, 3],
      inputs: [1, 3],
      insightStyle: [1],
      platforms: [2, 3],
      pricing: [1],
      primaryJob: [1],
    },
    faqs: [
      {
        answer:
          "Cronometer tracks far more than calories and macros, including a broad set of vitamins, minerals, fatty acids, amino acids, and other compounds when the selected food record contains them. Its official pages use slightly different nutrient counts, so coverage should be judged food by food.",
        question: "How detailed is Cronometer's nutrient tracking?",
      },
      {
        answer:
          "Cronometer supports many devices and platforms, but every connector has its own data directions and limits. For example, activity energy may be imported where raw step totals are not.",
        question: "Does Cronometer import wearable data?",
      },
      {
        answer:
          "Cronometer remains the better nutrient ledger, and Murph should not blur or recreate that precision. Murph adds value when you want to discuss a possible gap beside symptoms, labs, routines, preferences, and burden, then decide whether anything is worth changing. Neither consumer product is clinical nutrition care.",
        question: "What would Murph add to Cronometer?",
      },
    ],
    headline: "Detailed nutrient tracking or a wider health decision",
    lastVerified: "2026-08-31",
    metaDescription:
      "Cronometer supplies the detailed nutrient ledger. Murph, a personal health assistant, helps decide what its numbers mean in context and what is worth changing.",
    name: "Cronometer",
    quickComparison: [
      {
        capability: "Detailed nutrient accounting",
        evidence: "primaryJob",
        murph: "connected",
        competitor: "yes",
      },
      {
        capability: "Curated food records",
        evidence: "insightStyle",
        murph: "limited",
        competitor: "yes",
      },
      {
        capability: "Nutrition reports",
        evidence: "insightStyle",
        murph: "yes",
        competitor: "limited",
      },
      {
        capability: "Cross domain health context",
        evidence: "inputs",
        murph: "yes",
        competitor: "limited",
      },
      {
        capability: "Conversational plan support",
        evidence: "followThrough",
        murph: "yes",
        competitor: "limited",
      },
      {
        capability: "Handles health errands",
        evidence: "followThrough",
        murph: "yes",
        competitor: "no",
      },
      {
        capability: "Tests what works for you",
        evidence: "insightStyle",
        murph: "yes",
        competitor: "limited",
      },
      {
        capability: "Free start without a card",
        evidence: "pricing",
        murph: "yes",
        competitor: "yes",
      },
      {
        capability: "Open source option",
        evidence: "platforms",
        murph: "yes",
        competitor: "no",
      },
      {
        capability: "Optional group support",
        evidence: "followThrough",
        murph: "yes",
        competitor: "limited",
      },
    ],
    relationship: "alternative",
    slug: "cronometer",
    sources: [
      {
        label: "Cronometer Gold",
        url: "https://cronometer.com/gold/index.html",
      },
      {
        label: "Cronometer device sync",
        url: "https://cronometer.com/features/sync-devices.html",
      },
      {
        label: "Cronometer integrations overview",
        url: "https://support.cronometer.com/hc/en-us/articles/360018579072-Devices-Integration-Overview",
      },
      {
        label: "Cronometer Pro",
        url: "https://cronometer.com/pro/",
      },
      {
        label: "Cronometer terms and medical scope",
        url: "https://cronometer.com/terms/",
      },
    ],
    tradeoffs: [
      "The depth is valuable for nutrient-focused users but can be more detail than a simple weight-loss diary needs.",
      "Nutrient completeness varies with the underlying food record, even when the app supports the field. Cronometer's ledger precision has no Murph equivalent: Murph does not calculate comprehensive nutrient totals or generate comparable nutrition reports.",
      "Device connectors differ in the data they read and write, so a listed integration does not mean full parity or settle how the resulting pattern should be interpreted.",
    ],
  },
  {
    category: "nutrition",
    chooseCompetitor:
      "Choose MacroFactor when you want expenditure estimates and weekly calorie or macro adjustments based on consistent intake and weight data.",
    chooseMurph:
      "Choose Murph when the real question includes sleep, symptoms, training, records, stress, preferences, or whether the tracking burden is still worthwhile. It can help shape and revisit the plan, but it is not an adaptive calorie algorithm.",
    competitor: {
      clinicalRole:
        "A self-guided nutrition and fitness app, not a clinician, registered dietitian, diagnosis service, or prescription program.",
      followThrough:
        "Weekly program check-ins, adaptive targets, progress trends, and adherence-neutral coaching language.",
      format:
        "A paid mobile food logger paired with an algorithmic calorie and macro program.",
      hardware:
        "No proprietary hardware is required. Connected health platforms can pass weight and nutrition data, including data from compatible scales.",
      inputs:
        "Logged food, calories, macros, scale weight, goals, recipes, and selected Apple Health or Health Connect data.",
      insightStyle:
        "Estimated energy expenditure, smoothed weight trend, rate of change, and weekly target adjustments.",
      platforms:
        "iOS and Android, with Apple Health and Health Connect. It does not depend on activity-calorie estimates from wearables.",
      pricing:
        "US pricing checked August 30, 2026: $11.99 monthly, $47.99 for six months, or $71.99 yearly. A Nutrition and Workouts bundle is $89.99 yearly for eligible new users.",
      primaryJob:
        "Adapt calorie and macro targets from logged intake and changes in body weight.",
    },
    competitorEvidence: {
      clinicalRole: [1],
      followThrough: [1],
      format: [1],
      hardware: [3, 4],
      inputs: [1, 4],
      insightStyle: [1],
      platforms: [1, 4],
      pricing: [2],
      primaryJob: [1],
    },
    faqs: [
      {
        answer:
          "MacroFactor estimates energy expenditure from the relationship between logged intake and weight change. It then proposes weekly calorie and macro updates without treating missed targets as a moral failure.",
        question: "How does MacroFactor adjust a nutrition plan?",
      },
      {
        answer:
          "No. MacroFactor intentionally bases its core expenditure model on food and weight data rather than changing targets from a watch's daily calorie estimate.",
        question: "Does MacroFactor use wearable calorie burn in its algorithm?",
      },
      {
        answer:
          "MacroFactor turns consistent food and weight data into a focused body-composition program. Murph adds a persistent conversation around the parts that model does not own, such as competing health goals, symptoms, training context, practical burden, and follow-through. Murph does not replace the expenditure model or a human clinician.",
        question: "When would Murph add something to MacroFactor?",
      },
    ],
    headline: "Adaptive macro targets or broader health context",
    lastVerified: "2026-08-31",
    metaDescription:
      "MacroFactor adapts calorie and macro targets from logged data. Murph is the broader personal health assistant for decisions across health; it does not reproduce that algorithm.",
    name: "MacroFactor",
    quickComparison: [
      {
        capability: "Adaptive calorie targets",
        evidence: "primaryJob",
        murph: "limited",
        competitor: "yes",
      },
      {
        capability: "Energy expenditure estimates",
        evidence: "insightStyle",
        murph: "connected",
        competitor: "yes",
      },
      {
        capability: "Adaptive diet program check ins",
        evidence: "followThrough",
        murph: "limited",
        competitor: "yes",
      },
      {
        capability: "Cross domain health context",
        evidence: "inputs",
        murph: "yes",
        competitor: "limited",
      },
      {
        capability: "Open ended health conversation",
        evidence: "format",
        murph: "yes",
        competitor: "no",
      },
      {
        capability: "Handles health errands",
        evidence: "followThrough",
        murph: "yes",
        competitor: "no",
      },
      {
        capability: "Tests what works for you",
        evidence: "followThrough",
        murph: "yes",
        competitor: "limited",
      },
      {
        capability: "Free start without a card",
        evidence: "pricing",
        murph: "yes",
        competitor: "limited",
      },
      {
        capability: "Open source option",
        evidence: "platforms",
        murph: "yes",
        competitor: "no",
      },
      {
        capability: "Optional group support",
        evidence: "followThrough",
        murph: "yes",
        competitor: "no",
      },
    ],
    relationship: "alternative",
    slug: "macrofactor",
    sources: [
      {
        label: "MacroFactor product overview",
        url: "https://macrofactor.com/macrofactor/",
      },
      {
        label: "MacroFactor pricing",
        url: "https://macrofactor.com/workouts/price/",
      },
      {
        label: "MacroFactor integrations",
        url: "https://help.macrofactorapp.com/en/articles/102-integrations",
      },
      {
        label: "MacroFactor Apple Health and Health Connect",
        url: "https://help.macrofactorapp.com/en/articles/65-connect-health-connect-or-apple-health",
      },
    ],
    tradeoffs: [
      "The adaptive model becomes more useful when food and weight are logged consistently and accurately.",
      "There is no lasting free tier after the trial.",
      "The app deliberately does not turn daily wearable calorie estimates into changing food targets, which reduces one noisy input but also keeps the core program intentionally narrow. Murph can discuss that tradeoff, but it does not estimate expenditure or issue adaptive weekly calorie and macro targets.",
    ],
  },
  {
    category: "nutrition",
    chooseCompetitor:
      "Choose Noom when a structured weight curriculum, food-color system, daily lessons, and optional Noom Med evaluation match your goal.",
    chooseMurph:
      "Choose Murph when you would rather start with your actual question and let relevant nutrition, sleep, training, records, and constraints shape the answer. It can remember the thread and help you follow through without placing you in a fixed daily curriculum.",
    competitor: {
      clinicalRole:
        "Noom Weight is a wellness program. Noom Med is a separate clinician-led service that may prescribe medication after evaluation where available.",
      followThrough:
        "Daily lessons, weight and meal routines, habit prompts, Welli AI, optional coaching, and medication-program follow-up on eligible Med plans.",
      format:
        "A structured mobile behavior-change program, with separate telehealth plans for eligible medical weight care.",
      hardware:
        "No proprietary hardware is required. Phones, scales, wearables, and supported health services can supply steps or weight.",
      inputs:
        "Food by search, photo, or voice, calorie and color categories, weight, steps, habits, lessons, and optional clinical intake.",
      insightStyle:
        "Psychology-informed education, calorie guidance, habit feedback, progress views, and clinical monitoring on Med plans.",
      platforms:
        "iOS and Android. Health and device connections vary by operating system, and account history does not freely migrate across mobile platforms.",
      pricing:
        "US Noom Weight pricing checked August 30, 2026 ranges from $70 for one month to $209 for twelve months before discounts. Noom Med lists initial charges from $39 to $149 and later advertised rates from $99 to $299 monthly, often billed quarterly; medication inclusion varies.",
      primaryJob:
        "Guide weight change through a structured behavior program, with optional separate access to medical obesity care.",
    },
    competitorEvidence: {
      clinicalRole: [1, 2],
      followThrough: [2],
      format: [2],
      hardware: [3],
      inputs: [2, 3],
      insightStyle: [2],
      platforms: [3],
      pricing: [1, 2],
      primaryJob: [1, 2],
    },
    faqs: [
      {
        answer:
          "Noom Weight uses psychology-informed lessons, meal logging, calorie guidance, and habit tools. Coaching availability depends on the plan and should not be confused with licensed medical care.",
        question: "What kind of coaching does Noom Weight provide?",
      },
      {
        answer:
          "Noom Weight does not include medication. Noom Med offers separate plans in which a licensed clinician can evaluate eligibility, but drug cost, insurance coverage, state availability, and plan inclusions vary.",
        question: "Does a Noom subscription include weight-loss medication?",
      },
      {
        answer:
          "No. Noom's curriculum, food-color system, and Noom Med clinicians are distinct services. Murph fits when you want a flexible conversation that can remember relevant context and move across health topics. It cannot prescribe, and it should not override a clinician-led plan.",
        question: "Would Murph replace Noom's program or Noom Med?",
      },
    ],
    headline: "A weight curriculum, clinical care, or a wider conversation",
    lastVerified: "2026-08-31",
    metaDescription:
      "Noom provides a weight curriculum and optional medical care. As a personal health assistant, Murph supports wider non-clinical questions beyond the program.",
    name: "Noom",
    quickComparison: [
      {
        capability: "Structured daily curriculum",
        evidence: "format",
        murph: "limited",
        competitor: "yes",
      },
      {
        capability: "Food color guidance",
        evidence: "inputs",
        murph: "no",
        competitor: "yes",
      },
      {
        capability: "Clinician led medication care",
        evidence: "clinicalRole",
        murph: "no",
        competitor: "limited",
      },
      {
        capability: "Open ended health questions",
        evidence: "format",
        murph: "yes",
        competitor: "limited",
      },
      {
        capability: "Cross domain health context",
        evidence: "inputs",
        murph: "yes",
        competitor: "limited",
      },
      {
        capability: "Handles health errands",
        evidence: "followThrough",
        murph: "yes",
        competitor: "no",
      },
      {
        capability: "Tests what works for you",
        evidence: "followThrough",
        murph: "yes",
        competitor: "no",
      },
      {
        capability: "Free start without a card",
        evidence: "pricing",
        murph: "yes",
        competitor: "no",
      },
      {
        capability: "Open source option",
        evidence: "platforms",
        murph: "yes",
        competitor: "no",
      },
      {
        capability: "Reminders and check ins",
        evidence: "followThrough",
        murph: "yes",
        competitor: "yes",
      },
    ],
    relationship: "alternative",
    slug: "noom",
    sources: [
      {
        label: "Noom Weight plan pricing",
        url: "https://www.noom.com/support/faqs/subscription-and-billing/2025/10/noom-plan-pricing-and-what-to-expect/",
      },
      {
        label: "Noom Med pricing",
        url: "https://www.noom.com/med/pricing/",
      },
      {
        label: "Noom Android app connections",
        url: "https://www.noom.com/support/faqs/troubleshooting/syncing-and-compatibility/2025/10/syncing-noom-with-apps-on-android/",
      },
    ],
    tradeoffs: [
      "The lesson-led format supplies real structure but keeps the member inside a weight-focused curriculum rather than making any health question the organizing center. Murph leaves that curriculum behind, but it offers no equivalent lesson sequence, dedicated human coaching program, or prescribing clinic.",
      "Weight and Med prices, renewal terms, state availability, and medication inclusion require careful checkout review.",
      "Compounded medications are not FDA approved or reviewed for safety, effectiveness, or quality in the same way as approved drugs.",
    ],
  },
  {
    aliases: ["WW"],
    category: "nutrition",
    chooseCompetitor:
      "Choose Weight Watchers when Points, recipe planning, peer community, workshops, or its Clinic pathway are central to the experience you want.",
    chooseMurph:
      "Choose Murph when food or weight matters but needs to sit beside symptoms, sleep, training, records, preferences, or another health goal. Murph can remember those connections and support the chosen next step without assigning Points.",
    competitor: {
      clinicalRole:
        "Core memberships are wellness programs. Weight Watchers Clinic is a separate medical service with clinician evaluation and prescription authority where eligible.",
      followThrough:
        "Points budgets, recipes, community, workshops, coaching, activity and sleep goals, and GLP-1 Success support on eligible plans.",
      format:
        "A membership app built around Points, with optional live community formats and a separate telehealth clinic.",
      hardware:
        "No proprietary hardware is required. Activity and health connections can contribute data where supported.",
      inputs:
        "Food and Points, macros, weight, activity, sleep, body scans, goals, community activity, and optional medical intake.",
      insightStyle:
        "Points guidance, progress summaries, meal planning, community reinforcement, and clinical follow-up through Clinic plans.",
      platforms:
        "iOS, Android, and web. Exact activity-device compatibility should be confirmed for the member's current app and region.",
      pricing:
        "US pricing checked August 30, 2026 is promotional and dynamic. The site advertises membership from $12 monthly. Med+ advertises $25 for month one, then $74 monthly on a twelve-month term or $84 monthly on six months; GLP-1 medication is extra.",
      primaryJob:
        "Support weight management through Points, recipes, community, coaching, and optional clinical care.",
    },
    competitorEvidence: {
      clinicalRole: [1, 3],
      followThrough: [1, 2],
      format: [1],
      hardware: [1, 2],
      inputs: [1, 2],
      insightStyle: [1, 2],
      platforms: [1],
      pricing: [1],
      primaryJob: [1],
    },
    faqs: [
      {
        answer:
          "The consumer program converts foods into a Points budget and pairs tracking with recipes, goals, and community features. The exact plan determines whether workshops or additional coaching are included.",
        question: "What is the main Weight Watchers approach?",
      },
      {
        answer:
          "No. Med+ includes access to the Clinic program, but the advertised membership price does not include GLP-1 medication. Coverage, cash price, eligibility, and available drugs depend on the member's clinical and insurance situation.",
        question: "Does Weight Watchers Med+ include GLP-1 medication?",
      },
      {
        answer:
          "No. Murph has no Points system, workshop network, peer community, or prescribing clinic. Its value is a private, ongoing conversation that can connect nutrition to other health threads and help carry a practical plan forward. Clinic decisions remain with Weight Watchers clinicians.",
        question: "Would Murph replace Points, workshops, or Weight Watchers Clinic?",
      },
    ],
    headline: "Points, community, and the health context around weight",
    lastVerified: "2026-08-31",
    metaDescription:
      "Weight Watchers brings Points, community, workshops, and a clinic. Murph works as a personal health assistant; it has none of those program tools.",
    name: "Weight Watchers",
    quickComparison: [
      {
        capability: "Points based food guidance",
        evidence: "insightStyle",
        murph: "no",
        competitor: "yes",
      },
      {
        capability: "Peer community",
        evidence: "followThrough",
        murph: "limited",
        competitor: "yes",
      },
      {
        capability: "Live workshops",
        evidence: "followThrough",
        murph: "no",
        competitor: "limited",
      },
      {
        capability: "Clinical medication care",
        evidence: "clinicalRole",
        murph: "no",
        competitor: "limited",
      },
      {
        capability: "Cross domain health context",
        evidence: "inputs",
        murph: "yes",
        competitor: "limited",
      },
      {
        capability: "Works in iMessage or Telegram",
        evidence: "format",
        murph: "yes",
        competitor: "limited",
      },
      {
        capability: "Handles health errands",
        evidence: "followThrough",
        murph: "yes",
        competitor: "no",
      },
      {
        capability: "Tests what works for you",
        evidence: "followThrough",
        murph: "yes",
        competitor: "no",
      },
      {
        capability: "Free start without a card",
        evidence: "pricing",
        murph: "yes",
        competitor: "no",
      },
      {
        capability: "Open source option",
        evidence: "platforms",
        murph: "yes",
        competitor: "no",
      },
    ],
    relationship: "alternative",
    slug: "weight-watchers",
    sources: [
      {
        label: "Weight Watchers plans",
        url: "https://www.weightwatchers.com/us/plans",
      },
      {
        label: "Weight Watchers GLP-1 program",
        url: "https://www.weightwatchers.com/us/how-it-works/glp-1-program",
      },
      {
        label: "Weight Watchers weight-loss medication",
        url: "https://www.weightwatchers.com/us/weight-loss-medication",
      },
      {
        label: "Weight Watchers registered dietitians",
        url: "https://www.weightwatchers.com/us/registered-dietitians",
      },
    ],
    tradeoffs: [
      "Points simplify food decisions and make the program easier to use, but they intentionally abstract some nutritional detail and keep weight management at the center.",
      "Promotional pricing, commitment length, renewal rates, workshop access, and Clinic costs can be difficult to compare from one headline price.",
      "The consumer program and the licensed Clinic have different roles and should not be treated as one level of care. Murph has no Points system, recipe program, workshop or peer network, or obesity-medicine clinic.",
    ],
  },
  {
    category: "nutrition",
    chooseCompetitor:
      "Choose Lose It! when calorie budgeting, a large food database, barcode or camera entry, and weight-loss tracking are the core tasks.",
    chooseMurph:
      "Choose Murph when you want to ask why a pattern matters, weigh it against symptoms, sleep, training, records, or preferences, and keep a realistic plan moving. It will not replace Lose It!'s food database or barcode workflow.",
    competitor: {
      clinicalRole:
        "A general wellness and weight-tracking product. Medication logging does not make it a prescribing or clinical-monitoring service.",
      followThrough:
        "Goals, reminders, challenges, community, fasting, meal planning, future logging, and trend reports depending on tier.",
      format:
        "A calorie-budget app with a food diary, weight charts, goals, and optional premium analysis.",
      hardware:
        "No proprietary hardware is required. Supported wearables and scales can supply activity or weight data.",
      inputs:
        "Food search, barcode, photo, voice, recipes, weight, exercise, water, sleep, body metrics, and medication logs.",
      insightStyle:
        "Calorie budget progress, macro and nutrient totals, weight trends, meal patterns, and goal reports.",
      platforms:
        "iOS, Android, and web, with connections including Apple Health, Health Connect, Fitbit, Garmin, and Withings. Legacy Google Fit connections may continue but cannot be newly connected or reconnected.",
      pricing:
        "US pricing checked August 30, 2026: Basic is free; Premium is $79.99 yearly; Lifetime is $299.99 from Basic or $229.99 for active Premium members. Personalized promotions vary.",
      primaryJob:
        "Create and track a personalized calorie budget for weight change.",
    },
    competitorEvidence: {
      clinicalRole: [3],
      followThrough: [1, 3],
      format: [3],
      hardware: [3],
      inputs: [1, 3],
      insightStyle: [3],
      platforms: [2, 3],
      pricing: [1],
      primaryJob: [1],
    },
    faqs: [
      {
        answer:
          "The free tier includes a calorie budget and core food, weight, and exercise logging. Premium adds advanced entry methods, nutrients, planning, fasting, more health metrics, and broader integrations.",
        question: "What is included in Lose It!'s free plan?",
      },
      {
        answer:
          "Lose It! Premium can record supported GLP-1 medications, doses, injection locations, schedules, and modeled medication levels alongside nutrition goals. That personal log is not a prescription, dose recommendation, or replacement for clinical monitoring.",
        question: "Can Lose It! track GLP-1 medication?",
      },
      {
        answer:
          "Not for a structured calorie budget, barcode log, or weight diary; Lose It! is purpose-built for those jobs. Murph becomes the better fit when you need a conversation about what the numbers mean and a plan that can account for the rest of your health. Neither product provides prescribing or clinical monitoring.",
        question: "Would Murph replace Lose It!'s calorie tracker?",
      },
    ],
    headline: "A calorie diary or a question-first health assistant",
    lastVerified: "2026-08-31",
    metaDescription:
      "Lose It! is a focused calorie and weight diary. Murph, the personal health assistant, starts with the wider question and remembers the resulting plan.",
    name: "Lose It!",
    quickComparison: [
      {
        capability: "Calorie budgeting",
        evidence: "primaryJob",
        murph: "limited",
        competitor: "yes",
      },
      {
        capability: "Barcode food logging",
        evidence: "inputs",
        murph: "no",
        competitor: "yes",
      },
      {
        capability: "Food and weight diary",
        evidence: "format",
        murph: "yes",
        competitor: "yes",
      },
      {
        capability: "Medication logging",
        evidence: "inputs",
        murph: "yes",
        competitor: "limited",
      },
      {
        capability: "Cross domain health context",
        evidence: "inputs",
        murph: "yes",
        competitor: "limited",
      },
      {
        capability: "Works in iMessage or Telegram",
        evidence: "format",
        murph: "yes",
        competitor: "no",
      },
      {
        capability: "Handles health errands",
        evidence: "followThrough",
        murph: "yes",
        competitor: "no",
      },
      {
        capability: "Tests what works for you",
        evidence: "followThrough",
        murph: "yes",
        competitor: "no",
      },
      {
        capability: "Free start without a card",
        evidence: "pricing",
        murph: "yes",
        competitor: "yes",
      },
      {
        capability: "Optional group support",
        evidence: "followThrough",
        murph: "yes",
        competitor: "yes",
      },
    ],
    relationship: "alternative",
    slug: "lose-it",
    sources: [
      {
        label: "Lose It! membership tiers and pricing",
        url: "https://loseit.zendesk.com/hc/en-us/articles/51906523474708-Lose-It-Membership-Tiers-Pricing",
      },
      {
        label: "Lose It! Premium features",
        url: "https://loseit.zendesk.com/hc/en-us/articles/47345136549652-What-is-Lose-It-Premium",
      },
      {
        label: "Lose It! App Store listing",
        url: "https://apps.apple.com/us/app/lose-it-calorie-counter/id297368629",
      },
    ],
    tradeoffs: [
      "Premium is sold primarily as an annual commitment, while Lifetime pricing depends on current membership state.",
      "Photo and voice results are estimates and need review before they become useful nutrition data. Murph has no comparable searchable food database, barcode capture, or built-in calorie budget.",
      "Medication features organize self-reported use but do not provide clinical dosing or safety decisions, and the diary does not make medication the right lens for every health question.",
    ],
  },
  {
    category: "nutrition",
    chooseCompetitor:
      "Choose Foodnoms when an Apple-first, privacy-conscious calorie and macro tracker with Siri, Shortcuts, and Health support is the main need.",
    chooseMurph:
      "Choose Murph when you want relevant meals, symptoms, training, sleep, records, and preferences to inform one conversation, then want help carrying the chosen next step forward. It is not an Apple-native food database.",
    competitor: {
      clinicalRole:
        "A consumer wellness tracker. It does not provide medical nutrition therapy, diagnosis, prescribing, or human clinical coaching.",
      followThrough:
        "Goals, reminders, fasting, favorites, trends, top-food analysis, and AI-assisted logging on Plus.",
      format:
        "A privacy-focused native Apple food diary with a free core and optional Plus subscription.",
      hardware:
        "An Apple device is required. No separate Foodnoms hardware is needed, and compatible scales can pass weight through Apple Health.",
      inputs:
        "Manual food search, barcode, foods, meals, recipes, text, photo, voice, Siri, weight, active energy, and Apple Health data.",
      insightStyle:
        "Calories, macros, extended nutrients, energy calibration, trends, charts, and foods contributing most to a target.",
      platforms:
        "iPhone, iPad, Mac, and Apple Watch, with iCloud, Apple Health, Siri, and Shortcuts. Current releases require recent Apple operating systems.",
      pricing:
        "Pricing checked August 30, 2026 varies by storefront and account. The US App Store exposes individual tiers from $5.99 monthly or $39.99 yearly and family tiers from $9.99 monthly or $69.99 yearly, alongside other active storefront price points.",
      primaryJob:
        "Track calories, macros, nutrients, recipes, fasting, and weight in the Apple ecosystem.",
    },
    competitorEvidence: {
      clinicalRole: [1],
      followThrough: [2],
      format: [1, 2],
      hardware: [1, 2],
      inputs: [1, 2],
      insightStyle: [1, 2],
      platforms: [1, 3],
      pricing: [3],
      primaryJob: [1, 2],
    },
    faqs: [
      {
        answer:
          "No. Foodnoms is designed for Apple's ecosystem, including iPhone, iPad, Mac, Apple Watch, iCloud, Siri, Shortcuts, and Apple Health. It does not offer an Android or full web equivalent.",
        question: "Is Foodnoms available on Android?",
      },
      {
        answer:
          "Foodnoms keeps core calorie and macro logging free. Plus adds AI photo and text logging, more nutrients, fasting, recipe import, deeper charts, and related convenience features. Siri and Shortcuts voice tools are documented separately.",
        question: "What does Foodnoms Plus add?",
      },
      {
        answer:
          "Foodnoms is the better tool for a precise Apple-native food diary, including Siri, Shortcuts, and Health workflows. Murph adds a persistent health conversation around what the log means and what action fits. You do not need to abandon Foodnoms if the diary remains useful, and no direct connection is implied.",
        question: "What would Murph add to Foodnoms?",
      },
    ],
    headline: "Apple-native nutrition logging or broader follow-through",
    lastVerified: "2026-08-31",
    metaDescription:
      "Foodnoms is an Apple-native nutrition diary. As a personal health assistant, Murph handles questions beyond the log; it is not a barcode or nutrient-tracking app.",
    name: "Foodnoms",
    quickComparison: [
      {
        capability: "Apple ecosystem food diary",
        evidence: "platforms",
        murph: "no",
        competitor: "yes",
      },
      {
        capability: "Barcode food logging",
        evidence: "inputs",
        murph: "no",
        competitor: "yes",
      },
      {
        capability: "Voice and automation logging",
        evidence: "inputs",
        murph: "limited",
        competitor: "yes",
      },
      {
        capability: "Detailed nutrient totals",
        evidence: "insightStyle",
        murph: "yes",
        competitor: "limited",
      },
      {
        capability: "Cross domain health context",
        evidence: "inputs",
        murph: "yes",
        competitor: "limited",
      },
      {
        capability: "Works in iMessage or Telegram",
        evidence: "format",
        murph: "yes",
        competitor: "no",
      },
      {
        capability: "Handles health errands",
        evidence: "followThrough",
        murph: "yes",
        competitor: "no",
      },
      {
        capability: "Tests what works for you",
        evidence: "insightStyle",
        murph: "yes",
        competitor: "limited",
      },
      {
        capability: "Open source option",
        evidence: "platforms",
        murph: "yes",
        competitor: "no",
      },
      {
        capability: "Reminders and check ins",
        evidence: "followThrough",
        murph: "yes",
        competitor: "yes",
      },
    ],
    relationship: "alternative",
    slug: "foodnoms",
    sources: [
      {
        label: "Foodnoms product overview",
        url: "https://foodnoms.com/",
      },
      {
        label: "Foodnoms Plus",
        url: "https://foodnoms.com/plus",
      },
      {
        label: "Foodnoms App Store listing",
        url: "https://apps.apple.com/us/app/nutrition-tracker-foodnoms/id1479461686",
      },
    ],
    tradeoffs: [
      "The native experience is a benefit for Apple households and a hard platform limit for Android users. Murph does not provide Foodnoms' native diary, barcode workflow, or detailed nutrition totals on either platform.",
      "AI meal estimates improve speed but still require the person to check portions and ingredients.",
      "The official storefront exposes several active price points, so the in-app checkout is the reliable account-specific price; Plus still buys a better diary rather than a broader health relationship.",
    ],
  },
  {
    category: "nutrition",
    chooseCompetitor:
      "Choose MyNetDiary when you want a full food, exercise, weight, fasting, or glucose log with useful free features and optional AI analysis.",
    chooseMurph:
      "Choose Murph when food, weight, or a medication log needs to be understood beside other questions, records, symptoms, goals, and constraints. Murph can remember that context and support a plan, but it is not a replacement nutrient database.",
    competitor: {
      clinicalRole:
        "A wellness tracker and self-management aid. Its GLP-1 Companion logs medication and side effects but does not prescribe or manage treatment.",
      followThrough:
        "Goals, reminders, AutoPilot adjustments, fasting, meal plans, community, AI Coach, and GLP-1 Companion depending on tier.",
      format:
        "An ad-free freemium food and health diary with Premium and AI-led Premium Plus layers.",
      hardware:
        "No proprietary device is required. Compatible watches, scales, and fitness platforms can contribute activity, weight, or health data.",
      inputs:
        "Food search, barcode, voice, meal scan, recipes, weight, exercise, water, glucose, medications, fasting, and supported device data.",
      insightStyle:
        "Calories, macros, up to 108 nutrients, diet analysis, charts, forecasts, AI suggestions, and medication-support trends.",
      platforms:
        "Web, iOS, Android, Apple Watch, and Wear OS, with Apple Health, Health Connect, Fitbit, Garmin, and Withings support.",
      pricing:
        "US pricing checked August 30, 2026: Premium is $8.99 monthly or $59.99 yearly. Premium Plus pricing varies by storefront; an official listing shows a $14.99 purchase without a clearly labeled duration, so verify in checkout.",
      primaryJob:
        "Track food, weight, activity, and related health measures against personalized diet goals.",
    },
    competitorEvidence: {
      clinicalRole: [2],
      followThrough: [1, 2],
      format: [2],
      hardware: [2],
      inputs: [1, 2],
      insightStyle: [2],
      platforms: [2],
      pricing: [3, 4],
      primaryJob: [2],
    },
    faqs: [
      {
        answer:
          "The free app includes core calorie, macro, food, exercise, water, weight, barcode, voice, and community features without advertising. Premium adds meal scanning, diet plans, fasting, more measurements, reports, and wearable connections.",
        question: "How much can I do with MyNetDiary for free?",
      },
      {
        answer:
          "MyNetDiary's Premium Plus AI Coach already discusses diet history and suggests meals, while the tracker covers many nutrition jobs well. Murph differs in scope: the conversation can begin anywhere in your health, draw on relevant authorized context beyond nutrition, and turn a decision into action across topics. There is no direct MyNetDiary connection, and neither AI replaces clinical medication care.",
        question: "Why add Murph to a full-featured tracker?",
      },
      {
        answer:
          "It can log dose history, reminders, medication adherence, protein, fiber, hydration, symptoms, nutrition targets, and progress. It does not decide eligibility, write prescriptions, or replace the clinician managing the medication.",
        question: "What does MyNetDiary's GLP-1 Companion do?",
      },
    ],
    headline: "A detailed nutrition dashboard or a wider health thread",
    lastVerified: "2026-08-31",
    metaDescription:
      "MyNetDiary combines nutrition, weight and medication logs with an AI Coach. Murph acts as a personal health assistant across wider context and follow-through.",
    name: "MyNetDiary",
    quickComparison: [
      {
        capability: "Ad free food diary",
        evidence: "format",
        murph: "yes",
        competitor: "yes",
      },
      {
        capability: "Barcode and voice logging",
        evidence: "inputs",
        murph: "limited",
        competitor: "yes",
      },
      {
        capability: "Detailed nutrient tracking",
        evidence: "insightStyle",
        murph: "yes",
        competitor: "yes",
      },
      {
        capability: "Medication companion",
        evidence: "followThrough",
        murph: "yes",
        competitor: "limited",
      },
      {
        capability: "Cross domain health context",
        evidence: "inputs",
        murph: "yes",
        competitor: "limited",
      },
      {
        capability: "Works in iMessage or Telegram",
        evidence: "format",
        murph: "yes",
        competitor: "limited",
      },
      {
        capability: "Handles health errands",
        evidence: "followThrough",
        murph: "yes",
        competitor: "no",
      },
      {
        capability: "Tests what works for you",
        evidence: "followThrough",
        murph: "yes",
        competitor: "limited",
      },
      {
        capability: "Open source option",
        evidence: "platforms",
        murph: "yes",
        competitor: "no",
      },
      {
        capability: "Optional group support",
        evidence: "followThrough",
        murph: "yes",
        competitor: "yes",
      },
    ],
    relationship: "alternative",
    slug: "my-net-diary",
    sources: [
      {
        label: "MyNetDiary product overview",
        url: "https://www.mynetdiary.com/",
      },
      {
        label: "MyNetDiary company and feature overview",
        url: "https://www.mynetdiary.com/about.html",
      },
      {
        label: "MyNetDiary App Store listing",
        url: "https://apps.apple.com/us/app/calorie-counter-mynetdiary/id287529757",
      },
      {
        label: "MyNetDiary Premium pricing comparison",
        url: "https://www.mynetdiary.com/switch-from-myfitnesspal.html",
      },
    ],
    tradeoffs: [
      "The large feature set can take more setup than a minimal food diary. Murph asks for less structured logging, but it cannot replace MyNetDiary's food, weight, medication, and nutrient ledger.",
      "Premium Plus pricing is not presented consistently enough for one durable public list price.",
      "Medication logs, reminders, and adherence charts are useful organizational tools, but they are not treatment instructions or a substitute for interpreting the wider health picture.",
    ],
  },
  {
    category: "nutrition",
    chooseCompetitor:
      "Choose Lifesum when visual meal feedback, recipes, preset eating plans, water, fasting, and wearable-fed activity are the desired daily workflow.",
    chooseMurph:
      "Choose Murph when a meal score or packaged plan cannot account for the full decision. It can keep symptoms, training, sleep, records, preferences, and ordinary life in the conversation, then help revisit what you chose.",
    competitor: {
      clinicalRole:
        "A recreational and educational wellness app. Its plans and ratings are not diagnosis, treatment, or individualized medical nutrition therapy.",
      followThrough:
        "Goals, reminders, habits, Life Score, meal ratings, fasting, recipes, and guided meal plans on Premium.",
      format:
        "A visual mobile lifestyle tracker with food logging, scores, recipes, plans, and habit tools.",
      hardware:
        "No proprietary device is required. Supported wearables and scales can add activity, sleep, or weight data.",
      inputs:
        "Food by search, barcode, photo, voice, or text, plus water, weight, body measures, fasting, habits, exercise, and device data.",
      insightStyle:
        "Calories, macros, detailed nutrients, meal ratings, Life Score, goal trends, and plan-based guidance.",
      platforms:
        "iOS, iPad, Apple Watch, Android, and Wear OS, with direct support for Apple Health, Health Connect, and Samsung Health. Other services may route data through those health platforms depending on the device.",
      pricing:
        "US pricing checked August 30, 2026 is account and promotion dependent. A current App Store offer shows $7.49 monthly, $14.99 for three months, or $49.99 yearly, while higher-price SKUs remain listed.",
      primaryJob:
        "Guide everyday eating through meal logging, ratings, recipes, and packaged nutrition plans.",
    },
    competitorEvidence: {
      clinicalRole: [4],
      followThrough: [1, 2],
      format: [1],
      hardware: [1],
      inputs: [1, 2, 3],
      insightStyle: [1, 2],
      platforms: [1, 3],
      pricing: [3],
      primaryJob: [1],
    },
    faqs: [
      {
        answer:
          "Premium unlocks AI-assisted entry, custom goals, more nutrient detail, custom foods and exercise, and the full set of meal plans and recipes. Exact features can change by app version and market.",
        question: "What does Lifesum Premium include?",
      },
      {
        answer:
          "Lifesum offers plans such as Mediterranean, keto, weight-loss, and other themed approaches. These are consumer programs, not a clinician's assessment of whether a diet is safe for a particular condition.",
        question: "Does Lifesum create a personalized diet plan?",
      },
      {
        answer:
          "Murph may fit better when you do not want a preset eating plan to define the problem, or when food needs to be considered with the rest of your health. Lifesum remains stronger for visual logging, recipes, meal ratings, and packaged plans; Murph does not recreate that library.",
        question: "When might Murph fit better than a Lifesum plan?",
      },
    ],
    headline: "Meal plans and scores or context-led support",
    lastVerified: "2026-08-31",
    metaDescription:
      "Lifesum offers meal plans, ratings, and a nutrition routine. As a personal health assistant, Murph weighs wider context rather than supplying preset diet tools.",
    name: "Lifesum",
    quickComparison: [
      {
        capability: "Visual food logging",
        evidence: "format",
        murph: "yes",
        competitor: "yes",
      },
      {
        capability: "Preset meal plans",
        evidence: "followThrough",
        murph: "limited",
        competitor: "limited",
      },
      {
        capability: "Meal ratings",
        evidence: "insightStyle",
        murph: "no",
        competitor: "yes",
      },
      {
        capability: "Recipe library",
        evidence: "followThrough",
        murph: "limited",
        competitor: "limited",
      },
      {
        capability: "Cross domain health context",
        evidence: "inputs",
        murph: "yes",
        competitor: "limited",
      },
      {
        capability: "Works in iMessage or Telegram",
        evidence: "format",
        murph: "yes",
        competitor: "no",
      },
      {
        capability: "Handles health errands",
        evidence: "followThrough",
        murph: "yes",
        competitor: "no",
      },
      {
        capability: "Tests what works for you",
        evidence: "followThrough",
        murph: "yes",
        competitor: "no",
      },
      {
        capability: "Open source option",
        evidence: "platforms",
        murph: "yes",
        competitor: "no",
      },
      {
        capability: "Reminders and check ins",
        evidence: "followThrough",
        murph: "yes",
        competitor: "yes",
      },
    ],
    relationship: "alternative",
    slug: "lifesum",
    sources: [
      {
        label: "Lifesum features",
        url: "https://lifesum.com/features/",
      },
      {
        label: "Lifesum Premium features",
        url: "https://help.lifesum.com/en/article/what-do-i-get-when-i-buy-premium-1vzq8pz/",
      },
      {
        label: "Lifesum App Store listing",
        url: "https://apps.apple.com/us/app/lifesum-ai-calorie-counter/id286906691",
      },
      {
        label: "Lifesum policy and medical boundary",
        url: "https://lifesum.com/policy/",
      },
    ],
    tradeoffs: [
      "Preset diet plans make choices easier but cannot account for every medical condition, preference, or life constraint. Murph can discuss those constraints, but it does not supply preset menus, meal ratings, or a full nutrition diary.",
      "Meal scores make feedback quick and legible, but they compress the context that can explain why a meal does or does not fit one person.",
      "Promotional and storefront pricing is variable enough that renewal terms need a checkout review.",
    ],
  },
  {
    aliases: ["Yazio"],
    category: "nutrition",
    chooseCompetitor:
      "Choose YAZIO when calorie and macro targets, a large food database, fasting timers, recipes, and multilingual mobile support are the priority.",
    chooseMurph:
      "Choose Murph when the usefulness or safety of a food or fasting goal depends on symptoms, training, sleep, records, preferences, or another priority. It can help reason through that context and support the plan without replacing YAZIO's tracker.",
    competitor: {
      clinicalRole:
        "A general wellness and nutrition app. It does not provide licensed medical care, diagnosis, or prescription management.",
      followThrough:
        "Goals, reminders, fasting plans, recipe guidance, streaks, progress analysis, and Buddies for optional social accountability.",
      format:
        "A mobile calorie and fasting app with food logging, recipes, goals, and a paid Pro plan.",
      hardware:
        "No proprietary hardware is required. Phones and compatible health or fitness platforms can add steps and activity.",
      inputs:
        "Food search, barcode, photo AI, meals, water, weight, body metrics, mood, symptoms, fasting, and supported activity data.",
      insightStyle:
        "Calorie and macro progress, weight trends, fasting history, food analysis, and personalized Pro targets.",
      platforms:
        "iOS, iPad, Apple Watch, and Android, with multiple languages and support for Apple Health, Health Connect, Fitbit, and Garmin.",
      pricing:
        "US pricing checked August 30, 2026 is promotional and account specific. The App Store lists twelve-month offers at $23.90 and $47.90, three months at $23.99, and six months at $34.99, plus other unlabeled Pro SKUs.",
      primaryJob:
        "Track food, calories, macros, weight, and fasting against a personal goal.",
    },
    competitorEvidence: {
      clinicalRole: [4],
      followThrough: [1],
      format: [1],
      hardware: [1, 3],
      inputs: [1, 2, 3],
      insightStyle: [1],
      platforms: [1, 2, 3],
      pricing: [2],
      primaryJob: [1],
    },
    faqs: [
      {
        answer:
          "YAZIO supports manual and barcode entry and offers AI photo recognition in current versions. As with any camera estimate, ingredients and portions should be reviewed before relying on the totals.",
        question: "Can YAZIO log a meal from a photo?",
      },
      {
        answer:
          "YAZIO combines fasting timers and plans with the same food, water, weight, mood, and progress diary. Fasting guidance remains general wellness content rather than individualized medical clearance.",
        question: "How does fasting work in YAZIO?",
      },
      {
        answer:
          "No. YAZIO is purpose-built for its fasting timers, multilingual food database, recipes, and target tracking. Murph is useful when those tools raise a broader question or when you want a plan that can account for other health context and be revisited in conversation. No direct YAZIO connection is implied.",
        question: "Would Murph replace YAZIO's food log or fasting timer?",
      },
    ],
    headline: "Daily calorie and fasting tools or a broader plan",
    lastVerified: "2026-08-31",
    metaDescription:
      "YAZIO bundles calorie logging, fasting timers, recipes, and goals. Murph serves as a personal health assistant when the plan itself needs examination.",
    name: "YAZIO",
    quickComparison: [
      {
        capability: "Multilingual food database",
        evidence: "platforms",
        murph: "no",
        competitor: "yes",
      },
      {
        capability: "Fasting timer",
        evidence: "followThrough",
        murph: "no",
        competitor: "yes",
      },
      {
        capability: "Barcode meal logging",
        evidence: "inputs",
        murph: "no",
        competitor: "yes",
      },
      {
        capability: "Recipe guidance",
        evidence: "followThrough",
        murph: "limited",
        competitor: "limited",
      },
      {
        capability: "Cross domain health context",
        evidence: "inputs",
        murph: "yes",
        competitor: "limited",
      },
      {
        capability: "Works in iMessage or Telegram",
        evidence: "format",
        murph: "yes",
        competitor: "no",
      },
      {
        capability: "Handles health errands",
        evidence: "followThrough",
        murph: "yes",
        competitor: "no",
      },
      {
        capability: "Tests what works for you",
        evidence: "followThrough",
        murph: "yes",
        competitor: "no",
      },
      {
        capability: "Open source option",
        evidence: "platforms",
        murph: "yes",
        competitor: "no",
      },
      {
        capability: "Optional group support",
        evidence: "followThrough",
        murph: "yes",
        competitor: "yes",
      },
    ],
    relationship: "alternative",
    slug: "yazio",
    sources: [
      {
        label: "YAZIO product overview",
        url: "https://www.yazio.com/en/",
      },
      {
        label: "YAZIO App Store listing",
        url: "https://apps.apple.com/us/app/ai-calorie-tracker-by-yazio/id946099227",
      },
      {
        label: "YAZIO Health Connect support",
        url: "https://help.yazio.com/hc/en-us/articles/50068039509905-Yazio-and-Health-Connect",
      },
      {
        label: "YAZIO terms and privacy",
        url: "https://help.yazio.com/hc/en-us/articles/203444951-Terms-of-Use-Privacy-Policy",
      },
    ],
    tradeoffs: [
      "Food, fasting, body metrics, and social features make YAZIO a broad tracker, while the experience still assumes that structured daily logging is the useful center of the problem. Murph offers no built-in fasting timer, multilingual food database, or recipe catalog.",
      "Camera-recognized meals are estimates and can miss portions, oils, preparation, or ingredients.",
      "The product does not publish one stable Pro list price across regions and offers.",
    ],
  },
  {
    category: "nutrition",
    chooseCompetitor:
      "Choose Lumen when breath readings, metabolic-flexibility scores, daily carb guidance, and a device-centered routine are specifically motivating.",
    chooseMurph:
      "Choose Murph when you want help with nutrition and energy but do not need another device, or when a Lumen reading is only one clue in a wider decision. Murph can help choose and revisit the next step without claiming to measure fuel use.",
    competitor: {
      clinicalRole:
        "A wellness device and guidance program, not a diagnostic or prescribing service. Several medical conditions and pregnancy warrant professional review before use.",
      followThrough:
        "Daily breath checks, macro guidance, meal logging, fasting prompts, workout recommendations, scores, and weight-loss programs.",
      format:
        "A handheld breath device paired with a subscription mobile app and guided metabolic program.",
      hardware:
        "The proprietary Lumen breath device is central to the paid experience and measures breath carbon dioxide under instructed conditions.",
      inputs:
        "Breath measurements, food logs, weight, sleep, activity, workouts, goals, and data from supported fitness services.",
      insightStyle:
        "Inferred fuel use, metabolic-flexibility scores, daily carbohydrate and protein guidance, and program progress.",
      platforms:
        "iOS and Android, with more than 40 advertised connections including Apple Health, Google Fit, Garmin, Oura, WHOOP, Strava, MyFitnessPal, Peloton, and others.",
      pricing:
        "The US shop displayed a limited-offer device price of $249, reduced from $299, with the first twelve months included and renewal at $149 yearly. Promotions may change; the company advertises a 30-day return window and possible HSA or FSA eligibility.",
      primaryJob:
        "Use breath carbon dioxide to infer current fuel use and guide daily nutrition choices.",
    },
    competitorEvidence: {
      clinicalRole: [1],
      followThrough: [1, 2],
      format: [1, 2],
      hardware: [1],
      inputs: [1, 2],
      insightStyle: [1, 2],
      platforms: [1],
      pricing: [1],
      primaryJob: [1],
    },
    faqs: [
      {
        answer:
          "Lumen measures carbon dioxide in a controlled breath and uses its model to infer whether the body is relying relatively more on carbohydrate or fat. That output is an inference from breath data, not a direct measurement of every metabolic process.",
        question: "What does the Lumen device actually measure?",
      },
      {
        answer:
          "For devices bought on or after July 30, 2023, Lumen says basic unlimited measurements remain available after cancellation. Granular history, personalized guidance, scores, and other premium features are lost.",
        question: "Can I use Lumen without renewing the membership?",
      },
      {
        answer:
          "Lumen excludes users under 16 and advises professional consultation for pregnancy, diabetes, severe asthma or COPD, kidney disease, cancer, thyroid conditions, and other situations in which its general recommendations may not fit.",
        question: "Who should get medical advice before using Lumen?",
      },
    ],
    headline: "Breath-based metabolic feedback in a wider health decision",
    lastVerified: "2026-08-31",
    metaDescription:
      "Lumen measures breath and turns it into daily fuel guidance. A personal health assistant, Murph helps judge that signal in context but cannot take the reading.",
    name: "Lumen",
    quickComparison: [
      {
        capability: "Breath fuel measurements",
        evidence: "hardware",
        murph: "no",
        competitor: "yes",
      },
      {
        capability: "Daily macro guidance",
        evidence: "insightStyle",
        murph: "limited",
        competitor: "yes",
      },
      {
        capability: "Metabolic flexibility scores",
        evidence: "insightStyle",
        murph: "no",
        competitor: "yes",
      },
      {
        capability: "Works without dedicated hardware",
        evidence: "hardware",
        murph: "yes",
        competitor: "no",
      },
      {
        capability: "Cross domain health context",
        evidence: "inputs",
        murph: "yes",
        competitor: "limited",
      },
      {
        capability: "Works in iMessage or Telegram",
        evidence: "format",
        murph: "yes",
        competitor: "no",
      },
      {
        capability: "Handles health errands",
        evidence: "followThrough",
        murph: "yes",
        competitor: "no",
      },
      {
        capability: "Tests what works for you",
        evidence: "followThrough",
        murph: "yes",
        competitor: "limited",
      },
      {
        capability: "Free start without a card",
        evidence: "pricing",
        murph: "yes",
        competitor: "no",
      },
      {
        capability: "Reminders and check ins",
        evidence: "followThrough",
        murph: "yes",
        competitor: "yes",
      },
    ],
    relationship: "complement",
    slug: "lumen",
    sources: [
      {
        label: "Lumen shop and membership pricing",
        url: "https://www.lumen.me/shop",
      },
      {
        label: "Lumen weight-loss programs",
        url: "https://www.lumen.me/journal/lumen-news/product/lumen-weight-loss-programs",
      },
    ],
    tradeoffs: [
      "The useful experience depends on buying and regularly using proprietary hardware. Murph avoids that device burden but cannot produce a breath reading, fuel-use score, or Lumen's daily macro guidance.",
      "Fuel-use and flexibility outputs are modeled interpretations of breath readings rather than direct measurements of fat loss.",
      "General macro guidance may not fit pregnancy or several chronic medical conditions without professional input, and a compelling daily score can still deserve less attention than other evidence.",
    ],
    useTogether:
      "Keep Lumen for the breath measurement and its device-specific program. Add Murph to discuss the readings you choose to share, compare them with other relevant context, and decide whether the routine is helping enough to keep. There is no claimed direct data connection.",
  },
  {
    aliases: ["January AI"],
    category: "nutrition",
    chooseCompetitor:
      "Choose January when photo, barcode, voice, or search-based meal logging and model-generated glucose predictions are the experience you want.",
    chooseMurph:
      "Choose Murph when you want support to begin with any health question or task in familiar messaging, remember relevant context across domains, and carry the decision into a plan or action. It can discuss a January estimate you share, but it does not generate or validate the prediction.",
    competitor: {
      clinicalRole:
        "A wellness and metabolic-awareness app. Device-free glucose output is predictive, not diagnostic, and the app does not replace medical care.",
      followThrough:
        "Meal suggestions, food swaps, adaptive goals, fasting, Jan AI conversation, and feedback shaped by logged health context.",
      format:
        "An AI-first iPhone app for food capture, predicted glucose response, and metabolic guidance.",
      hardware:
        "No sensor is required for predicted glucose. A compatible user-owned CGM can supply actual sensor readings through supported connection paths.",
      inputs:
        "Meal photos, barcodes, voice, search, calories, macros, activity, sleep, labs, medications, health records, Apple Health, Oura, WHOOP, and supported CGM data.",
      insightStyle:
        "Predicted post-meal glucose, food comparisons, macro summaries, swaps, goals, and AI answers grounded in available inputs.",
      platforms:
        "The current consumer listing is iPhone-first, with some compatibility across Apple devices. A native Android consumer app was not verified on August 30, 2026.",
      pricing:
        "US pricing checked August 30, 2026: limited free use; Premium is $9.99 monthly or $59.99 yearly with a seven-day trial. Older or discounted $4.99 and $39.99 SKUs also appear in the official storefront.",
      primaryJob:
        "Make food logging fast and estimate how meals may affect personal glucose response.",
    },
    competitorEvidence: {
      clinicalRole: [1],
      followThrough: [1],
      format: [1, 3],
      hardware: [1, 4],
      inputs: [1, 3, 4],
      insightStyle: [1, 2],
      platforms: [3],
      pricing: [2, 3],
      primaryJob: [1],
    },
    faqs: [
      {
        answer:
          "No. January's device-free feature predicts a likely response from its model and the information available about the person and meal. Only a glucose meter or CGM supplies an actual glucose measurement.",
        question: "Does January measure glucose without a CGM?",
      },
      {
        answer:
          "January already provides Jan AI, adaptive goals, and answers grounded in its metabolic, lab, medication, and activity inputs. Its advantage remains the scanner and proprietary prediction workflow. Murph differs by supporting broader health questions and practical tasks in familiar messaging, with context and decisions carried across topics. There is no direct integration, and Murph does not turn a prediction into a measurement.",
        question: "What would Murph add to January?",
      },
      {
        answer:
          "January documents a direct Libre connection for US users. Other CGMs may send readings through Apple Health when their own app supports it, with availability and latency depending on that connection path.",
        question: "Can January use readings from my CGM?",
      },
    ],
    headline: "Food-and-glucose predictions or broader follow-through",
    lastVerified: "2026-08-31",
    metaDescription:
      "January scans meals and predicts glucose responses through its model. Murph is a personal health assistant for broader questions and tasks, not prediction.",
    name: "January",
    quickComparison: [
      {
        capability: "AI meal capture",
        evidence: "inputs",
        murph: "yes",
        competitor: "yes",
      },
      {
        capability: "Predicted glucose responses",
        evidence: "insightStyle",
        murph: "no",
        competitor: "yes",
      },
      {
        capability: "Actual CGM data",
        evidence: "inputs",
        murph: "connected",
        competitor: "limited",
      },
      {
        capability: "Health record context",
        evidence: "inputs",
        murph: "yes",
        competitor: "yes",
      },
      {
        capability: "Broad health task support",
        evidence: "primaryJob",
        murph: "yes",
        competitor: "limited",
      },
      {
        capability: "Works in iMessage or Telegram",
        evidence: "format",
        murph: "yes",
        competitor: "limited",
      },
      {
        capability: "Handles health errands",
        evidence: "followThrough",
        murph: "yes",
        competitor: "no",
      },
      {
        capability: "Tests what works for you",
        evidence: "followThrough",
        murph: "yes",
        competitor: "limited",
      },
      {
        capability: "Free start without a card",
        evidence: "pricing",
        murph: "yes",
        competitor: "limited",
      },
      {
        capability: "Open source option",
        evidence: "platforms",
        murph: "yes",
        competitor: "no",
      },
    ],
    relationship: "complement",
    slug: "january-ai",
    sources: [
      {
        label: "January app overview",
        url: "https://january.ai/app",
      },
      {
        label: "January frequently asked questions",
        url: "https://january.ai/faq",
      },
      {
        label: "January App Store listing",
        url: "https://apps.apple.com/us/app/january-ai-health-tracker/id6470235391",
      },
      {
        label: "January CGM connection guide",
        url: "https://blog.january.ai/blog/how-to-connect-your-cgm",
      },
    ],
    tradeoffs: [
      "Predicted glucose can offer a hypothesis but should not be read as a sensor measurement or medical result. Murph can help judge the estimate, but it has neither January's food scanner nor its proprietary glucose-prediction model.",
      "The verified consumer experience is currently Apple-centered, with no confirmed native Android app.",
      "Food-recognition and model outputs inherit uncertainty from portions, ingredients, records, and the model itself, so a precise-looking prediction may still warrant a low-burden response or no action.",
    ],
    useTogether:
      "Let January own meal capture, glucose predictions, and its app's metabolic coaching. Murph can handle broader health threads and follow-through around an estimate you choose to share. This is a complementary workflow, not a claimed direct integration.",
  },
  {
    category: "nutrition",
    chooseCompetitor:
      "Choose Signos when continuous glucose data, meal and habit scores, dietitian support, or its clinician-led Signos+ medication program are the specific goal.",
    chooseMurph:
      "Choose Murph when you want help without committing to a CGM program, or when glucose is only one clue among symptoms, sleep, training, records, preferences, and cost. It can support the broader plan while clinical decisions stay with clinicians.",
    competitor: {
      clinicalRole:
        "The Signos CGM membership and Essentials use the FDA-cleared over-the-counter Signos Glucose Monitoring System for eligible adults. Signos+ separately facilitates evaluation and prescribing through independent licensed clinician networks.",
      followThrough:
        "Prompts, scores, goals, meal and habit feedback, dietitian support, medication tracking, and clinician follow-up depending on plan.",
      format:
        "A mobile CGM program with AI guidance, plus distinct GLP-1 support and prescription offerings.",
      hardware:
        "CGM sensors are central to the program. Essentials uses OTC Stelo sensors; other plan hardware and fulfillment depend on the offering.",
      inputs:
        "Continuous glucose, meals, weight, activity, sleep, habits, medication doses, body scans, and supported health-platform or scale data.",
      insightStyle:
        "Glucose trends, meal response, daily and weekly scores, habit prompts, and treatment progress on clinical plans.",
      platforms:
        "Compatible iOS and Android phones, with Apple Health, Google Health Connect, supported watches, and smart scales.",
      pricing:
        "US pricing checked August 30, 2026: standard membership is advertised at $127 monthly with hardware; Essentials is $89 monthly for six months, medication extra; Signos+ starts at $199 monthly for three or six months and includes eligible compounded medication and CGMs.",
      primaryJob:
        "Use continuous glucose feedback to guide eating and weight habits, with optional GLP-1 support or prescribing.",
    },
    competitorEvidence: {
      clinicalRole: [2, 3, 4],
      followThrough: [1, 2, 3],
      format: [1, 3],
      hardware: [1, 2],
      inputs: [1, 2, 3],
      insightStyle: [1, 2, 3],
      platforms: [1, 2],
      pricing: [1, 2, 3],
      primaryJob: [1, 2, 3],
    },
    faqs: [
      {
        answer:
          "Essentials includes the app and a series of OTC Stelo sensors for adults already using a GLP-1 medication, but it does not include the medication or require a new prescription for the sensor. It focuses on food, activity, dose, symptoms, and body changes.",
        question: "What is Signos Essentials?",
      },
      {
        answer:
          "Signos+ is a separate clinician-guided program that can include compounded semaglutide or tirzepatide after eligibility review, along with supplies, app access, and CGMs. Compounded drugs are not FDA-approved equivalents of branded products.",
        question: "Does Signos prescribe GLP-1 medication?",
      },
      {
        answer:
          "The OTC Stelo sensor used in some plans is not intended for people using insulin, on dialysis, or with problematic hypoglycemia. A clinician should guide medical decisions and any medication change.",
        question: "Can anyone use the Signos CGM program?",
      },
    ],
    headline: "Continuous glucose guidance or context beyond the sensor",
    lastVerified: "2026-08-31",
    metaDescription:
      "Signos pairs CGM feedback with structured and clinical programs. Murph, a personal health assistant, adds wider context; it neither measures glucose nor prescribes.",
    name: "Signos",
    quickComparison: [
      {
        capability: "Continuous glucose readings",
        evidence: "inputs",
        murph: "connected",
        competitor: "yes",
      },
      {
        capability: "Meal response scoring",
        evidence: "insightStyle",
        murph: "limited",
        competitor: "yes",
      },
      {
        capability: "Clinician led medication care",
        evidence: "clinicalRole",
        murph: "no",
        competitor: "limited",
      },
      {
        capability: "Works without a sensor",
        evidence: "hardware",
        murph: "yes",
        competitor: "no",
      },
      {
        capability: "Cross domain health context",
        evidence: "inputs",
        murph: "yes",
        competitor: "limited",
      },
      {
        capability: "Works in iMessage or Telegram",
        evidence: "format",
        murph: "yes",
        competitor: "limited",
      },
      {
        capability: "Handles health errands",
        evidence: "followThrough",
        murph: "yes",
        competitor: "no",
      },
      {
        capability: "Tests what works for you",
        evidence: "followThrough",
        murph: "yes",
        competitor: "limited",
      },
      {
        capability: "Free start without a card",
        evidence: "pricing",
        murph: "yes",
        competitor: "no",
      },
      {
        capability: "Reminders and check ins",
        evidence: "followThrough",
        murph: "yes",
        competitor: "yes",
      },
    ],
    relationship: "different-role",
    slug: "signos",
    sources: [
      {
        label: "Signos program overview",
        url: "https://www.signos.com/",
      },
      {
        label: "Signos Essentials",
        url: "https://www.signos.com/essentials",
      },
      {
        label: "Signos+ GLP-1 program",
        url: "https://www.signos.com/lp/signos-plus",
      },
      {
        label: "About Signos",
        url: "https://support.signos.com/hc/en-us/articles/50323955411476-About-Signos",
      },
    ],
    tradeoffs: [
      "CGM feedback can make meal responses visible, while adding cost, sensor wear, and a risk of giving short-term glucose variation more importance than it deserves. Murph avoids the sensor commitment but cannot generate continuous readings, meal scores, or prescriptions.",
      "The standard, Essentials, and Signos+ plans differ materially in hardware, clinical role, commitment, and medication inclusion.",
      "Compounded medication requires clear eligibility, safety, quality, and FDA-status disclosures.",
    ],
    useTogether:
      "Keep Signos for sensor data, its program, and any clinician-led medication care. Add Murph only for findings you choose to discuss beside other health information and for day-to-day execution of the resulting plan. No direct integration is implied, and medication or CGM decisions remain with the relevant clinician and Signos program.",
  },
  {
    category: "nutrition",
    chooseCompetitor:
      "Choose Levels when organizing meals, glucose, wearables, labs, habits, and metabolic programs in one structured app is the main need.",
    chooseMurph:
      "Choose Murph when the need is an ongoing messaging relationship for questions and tasks beyond a metabolic program, with remembered context and follow-through but no extra dashboard. It does not reproduce Levels' scores, programs, sensors, labs, or expert review.",
    competitor: {
      clinicalRole:
        "A metabolic wellness platform with optional labs and limited clinician review. It is not diabetes treatment or continuous clinical care.",
      followThrough:
        "Goals, habits, adaptive programs, AI insights, scores, experiments, and optional clinician or nutritionist touchpoints in higher packages.",
      format:
        "A mobile and web metabolic-health dashboard with optional sensor, lab, and professional-service add-ons.",
      hardware:
        "No sensor is required for the base membership. Members can bring a compatible sensor or buy optional Stelo shipments.",
      inputs:
        "Food photos, text, barcodes, macros, CGM data, sleep, exercise, wearables, labs, documents, habits, and goals.",
      insightStyle:
        "Meal and glucose response, metabolic scores, trends, AI summaries, lab context, and program feedback.",
      platforms:
        "iOS, Android, and a web dashboard, with health and wearable data connections plus bring-your-own sensor support.",
      pricing:
        "US pricing checked August 30, 2026: Build Your System is $80 yearly with optional Stelo at $89 per two-sensor shipment; Core is $499 yearly; Complete is $1,999 yearly. Sensor, lab, and review inclusions differ.",
      primaryJob:
        "Combine food, glucose, activity, sleep, and labs into a metabolic-health feedback system.",
    },
    competitorEvidence: {
      clinicalRole: [1],
      followThrough: [1],
      format: [1],
      hardware: [1, 2],
      inputs: [1],
      insightStyle: [1],
      platforms: [1, 2],
      pricing: [1, 3],
      primaryJob: [1],
    },
    faqs: [
      {
        answer:
          "No. The base membership supports food, habits, programs, records, and other available data without requiring a CGM. A member can add Stelo or bring a compatible sensor for continuous glucose information.",
        question: "Do I need a CGM to use Levels?",
      },
      {
        answer:
          "Levels already provides AI insights, adaptive programs, habit loops, and optional clinician or nutritionist support around its metabolic data. Murph's different job is to take questions beyond the metabolic program into ongoing messaging, retain the relevant context, and remember the resulting decision for later follow-through. There is no claimed direct integration.",
        question: "What would Murph add to Levels?",
      },
      {
        answer:
          "No. Levels can organize glucose and related lifestyle data, and some packages include review by a clinician. It is not a substitute for diagnosis, diabetes treatment, urgent care, or ongoing management by the person's care team.",
        question: "Is Levels a diabetes-care service?",
      },
    ],
    headline: "Metabolic data programs or a broader health assistant",
    lastVerified: "2026-08-31",
    metaDescription:
      "Levels combines metabolic dashboards, programs, sensors, labs, and expert support. Murph, a personal health assistant, handles wider questions and follow-through.",
    name: "Levels",
    quickComparison: [
      {
        capability: "Metabolic dashboard",
        evidence: "format",
        murph: "limited",
        competitor: "yes",
      },
      {
        capability: "Optional CGM support",
        evidence: "hardware",
        murph: "connected",
        competitor: "yes",
      },
      {
        capability: "Optional laboratory testing",
        evidence: "format",
        murph: "no",
        competitor: "limited",
      },
      {
        capability: "Broad health task support",
        evidence: "primaryJob",
        murph: "yes",
        competitor: "limited",
      },
      {
        capability: "Works in iMessage or Telegram",
        evidence: "format",
        murph: "yes",
        competitor: "limited",
      },
      {
        capability: "Handles health errands",
        evidence: "followThrough",
        murph: "yes",
        competitor: "no",
      },
      {
        capability: "Tests what works for you",
        evidence: "followThrough",
        murph: "yes",
        competitor: "yes",
      },
      {
        capability: "Wearable and lab context",
        evidence: "inputs",
        murph: "yes",
        competitor: "yes",
      },
      {
        capability: "Free start without a card",
        evidence: "pricing",
        murph: "yes",
        competitor: "no",
      },
      {
        capability: "Open source option",
        evidence: "platforms",
        murph: "yes",
        competitor: "no",
      },
    ],
    relationship: "complement",
    slug: "levels",
    sources: [
      {
        label: "Levels product overview",
        url: "https://www.levels.com/",
      },
      {
        label: "Levels bring-your-own sensor",
        url: "https://www.levels.com/bring-your-sensor",
      },
      {
        label: "Levels pricing and plans",
        url: "https://support.levels.com/article/720-levels-pricing-and-plans",
      },
    ],
    tradeoffs: [
      "Membership paths, sensor shipments, labs, and clinician reviews have different inclusions and costs. Murph does not bundle a sensor, lab panel, metabolic dashboard, or clinician review.",
      "Glucose is one useful signal, but short-term responses do not by themselves establish whether a food is healthy for a person or whether changing it will improve life.",
      "A clinician review included in a package is not the same as ongoing medical care.",
    ],
    useTogether:
      "Let Levels own its dashboard, programs, measurements, and any expert review. Murph can support broader health threads and the agreed action around a finding you choose to share. No direct product connection is implied.",
  },
  {
    category: "nutrition",
    chooseCompetitor:
      "Choose ZOE when food-quality scores, plant diversity, processing risk, personalized meal guidance, and optional microbiome testing fit the question you want to answer.",
    chooseMurph:
      "Choose Murph when you do not want one food model to define the problem, or when a ZOE recommendation must be weighed against symptoms, records, goals, preferences, cost, and ordinary life before you act.",
    competitor: {
      clinicalRole:
        "A consumer nutrition and wellness program. It does not diagnose, prevent, or treat disease, and underlying conditions warrant clinician guidance.",
      followThrough:
        "Meal scores, goals, plant and fiber targets, streaks, learning content, Ziggie or AskZiggie AI, and personalized suggestions on paid plans.",
      format:
        "A mobile personalized-nutrition app with a free US tier, paid guidance, and market-dependent microbiome testing.",
      hardware:
        "No ongoing wearable or sensor is required in ZOE 2.0. Optional stool-test kits are sold in supported markets.",
      inputs:
        "Meal photos, barcodes, products, calories, macros, fiber, plants, questionnaire responses, goals, and optional stool samples.",
      insightStyle:
        "Meal and product scores, plant diversity, processing-risk context, predicted glucose and fat responses, and microbiome-based guidance where tested.",
      platforms:
        "iOS and Android. Membership features, testing, and pricing vary between the United States and United Kingdom, and no current wearable integration was verified.",
      pricing:
        "Pricing checked August 30, 2026: US free app; ZOE Plus $15.99 monthly or $99.99 yearly. UK app-only membership starts at £9.99 monthly billed as £119.88 yearly, with an optional £149 stool test for members.",
      primaryJob:
        "Score meals and guide food choices using quality, plant diversity, and personalized-response models.",
    },
    competitorEvidence: {
      clinicalRole: [2],
      followThrough: [1],
      format: [1, 2, 4],
      hardware: [2, 4],
      inputs: [1, 2, 4],
      insightStyle: [1, 3, 4],
      platforms: [1, 2],
      pricing: [2, 4],
      primaryJob: [1, 3],
    },
    faqs: [
      {
        answer:
          "ZOE 2.0 no longer uses the original standardized cookies, blood-fat test, or CGM test. It predicts glucose and fat responses from questionnaire data and its models, with optional newer stool testing in supported markets.",
        question: "Does ZOE still require a glucose sensor?",
      },
      {
        answer:
          "ZOE already provides food-quality scores, predicted responses, optional testing, and AI guidance. Murph differs by supporting health questions and follow-through beyond a nutrition model, in a conversation that can remember relevant context across topics. Murph does not reproduce ZOE's scores or imply a direct connection.",
        question: "What would Murph add to ZOE?",
      },
      {
        answer:
          "No. ZOE offers nutrition education and personalization but says it is not intended to diagnose, prevent, or treat disease. A person with an underlying condition should use qualified medical advice for treatment decisions.",
        question: "Is ZOE medical nutrition therapy?",
      },
    ],
    headline: "Personalized nutrition scores or cross-domain follow-through",
    lastVerified: "2026-08-31",
    metaDescription:
      "ZOE provides nutrition scores, predictions, and optional testing. As a personal health assistant, Murph connects the result to wider health; it does not score meals.",
    name: "ZOE",
    quickComparison: [
      {
        capability: "Meal quality scoring",
        evidence: "insightStyle",
        murph: "no",
        competitor: "yes",
      },
      {
        capability: "Predicted metabolic responses",
        evidence: "insightStyle",
        murph: "no",
        competitor: "yes",
      },
      {
        capability: "Optional microbiome testing",
        evidence: "hardware",
        murph: "no",
        competitor: "limited",
      },
      {
        capability: "Plant diversity guidance",
        evidence: "insightStyle",
        murph: "limited",
        competitor: "yes",
      },
      {
        capability: "Cross domain health context",
        evidence: "inputs",
        murph: "yes",
        competitor: "limited",
      },
      {
        capability: "Works in iMessage or Telegram",
        evidence: "format",
        murph: "yes",
        competitor: "limited",
      },
      {
        capability: "Handles health errands",
        evidence: "followThrough",
        murph: "yes",
        competitor: "no",
      },
      {
        capability: "Tests what works for you",
        evidence: "followThrough",
        murph: "yes",
        competitor: "limited",
      },
      {
        capability: "Free start without a card",
        evidence: "pricing",
        murph: "yes",
        competitor: "yes",
      },
      {
        capability: "Open source option",
        evidence: "platforms",
        murph: "yes",
        competitor: "no",
      },
    ],
    relationship: "alternative",
    slug: "zoe",
    sources: [
      {
        label: "ZOE US app",
        url: "https://zoe.com/en-us/app",
      },
      {
        label: "ZOE US frequently asked questions",
        url: "https://zoe.com/en-us/faqs",
      },
      {
        label: "ZOE 2.0 science overview",
        url: "https://zoe.com/learn/zoe-2-0-science-made-simple",
      },
      {
        label: "ZOE UK membership pricing",
        url: "https://zoe.com/en-gb/buymembership",
      },
    ],
    tradeoffs: [
      "Predicted glucose and fat responses are model outputs rather than direct current measurements. Murph can question how much a result matters, but it does not provide ZOE's testing, response predictions, or meal-scoring model.",
      "The experience, testing pathway, availability, and price differ materially by country. ZOE's current FAQ says its next-generation testing has not yet launched in the United States, while another FAQ section retains older New York-specific language.",
      "Meal scores make a complex model easier to use, but they should not be treated as a diagnosis, a universal verdict, or a reason to ignore how a meal fits the person's life.",
    ],
  },
  {
    category: "nutrition",
    chooseCompetitor:
      "Choose Nourish when assessment and medical nutrition therapy from a registered dietitian are the core need, especially when insurance may cover visits.",
    chooseMurph:
      "Choose Murph when you do not need medical nutrition therapy, or add it between visits to organize questions, understand information, remember relevant context, and follow through on a plan without changing the dietitian's clinical role.",
    competitor: {
      clinicalRole:
        "Licensed registered dietitians provide medical nutrition therapy. Nourish's broader coordinated-care model may also include labs, virtual medical care, and GLP-1 prescribing or medication management through qualified medical clinicians for eligible patients.",
      followThrough:
        "Recurring dietitian visits, between-visit messaging, goals, meal logs, recipes, AI assistance, labs, and progress review.",
      format:
        "A US telehealth nutrition practice paired with patient apps and a web portal.",
      hardware:
        "No proprietary hardware is required. Supported Apple Health data can be used through the iOS app.",
      inputs:
        "Clinical history, goals, symptoms, meal photos and macros, messages, labs, progress, and information shared during video visits.",
      insightStyle:
        "Individualized assessment and recommendations from an RD, supported by app tracking and AI convenience tools.",
      platforms:
        "Virtual care across all 50 US states through video, web, iOS, and Android. Provider availability and insurance participation vary.",
      pricing:
        "US pricing checked August 30, 2026: Nourish says 94% of patients pay $0 out of pocket. Actual copay, deductible, coverage, and visit limits require a benefits check; a transparent universal self-pay price was not verified.",
      primaryJob:
        "Deliver ongoing one-to-one nutrition care from a licensed registered dietitian.",
    },
    competitorEvidence: {
      clinicalRole: [1, 4],
      followThrough: [1],
      format: [1],
      hardware: [2],
      inputs: [1],
      insightStyle: [1],
      platforms: [1, 2],
      pricing: [1],
      primaryJob: [1],
    },
    faqs: [
      {
        answer:
          "Yes. Nourish describes its care team as registered dietitians who provide individualized nutrition care through virtual visits. This is licensed nutrition care, not only automated app coaching.",
        question: "Are Nourish coaches registered dietitians?",
      },
      {
        answer:
          "Nourish says most covered patients pay nothing, but the actual amount depends on the insurer, plan, deductible, referral rules, visit limits, and provider eligibility. A benefits estimate is not a payment guarantee.",
        question: "Will insurance make Nourish free?",
      },
      {
        answer:
          "A Nourish dietitian does not prescribe. Nourish says its coordinated-care services may include GLP-1 evaluation, prescribing, and medication management by qualified medical clinicians for eligible patients, based on need and coverage.",
        question: "Can Nourish manage my GLP-1 prescription?",
      },
    ],
    headline: "Dietitian-led nutrition care with support between visits",
    lastVerified: "2026-08-31",
    metaDescription:
      "Nourish delivers licensed dietitian care. Murph remains a non-clinical personal health assistant for wider questions and between-visit follow-through.",
    name: "Nourish",
    quickComparison: [
      {
        capability: "Licensed dietitian care",
        evidence: "clinicalRole",
        murph: "no",
        competitor: "yes",
      },
      {
        capability: "Insurance billed visits",
        evidence: "pricing",
        murph: "no",
        competitor: "limited",
      },
      {
        capability: "Between visit support",
        evidence: "followThrough",
        murph: "yes",
        competitor: "yes",
      },
      {
        capability: "Cross domain health context",
        evidence: "inputs",
        murph: "yes",
        competitor: "limited",
      },
      {
        capability: "Works in iMessage or Telegram",
        evidence: "format",
        murph: "yes",
        competitor: "limited",
      },
      {
        capability: "Handles health errands",
        evidence: "followThrough",
        murph: "yes",
        competitor: "limited",
      },
      {
        capability: "Tests what works for you",
        evidence: "followThrough",
        murph: "yes",
        competitor: "limited",
      },
      {
        capability: "Open source option",
        evidence: "platforms",
        murph: "yes",
        competitor: "no",
      },
      {
        capability: "Handles changing priorities",
        evidence: "primaryJob",
        murph: "yes",
        competitor: "limited",
      },
      {
        capability: "Optional group support",
        evidence: "followThrough",
        murph: "yes",
        competitor: "no",
      },
    ],
    relationship: "different-role",
    slug: "nourish",
    sources: [
      {
        label: "Nourish nutrition care overview",
        url: "https://www.nourish.com/",
      },
      {
        label: "Nourish App Store listing",
        url: "https://apps.apple.com/us/app/nourish-eating-well-made-easy/id6448732070",
      },
      {
        label: "Nourish paid labs",
        url: "https://www.nourish.com/paid-labs",
      },
      {
        label: "Nourish coordinated medical care announcement",
        url: "https://www.nourish.com/blog/nourish-announces-series-c",
      },
    ],
    tradeoffs: [
      "The value depends heavily on dietitian fit, appointment availability, and continuity over multiple visits.",
      "Insurance marketing cannot establish an individual's final copay, deductible, or allowed number of visits.",
      "The app supports the care relationship, but its AI assistant is not the licensed clinician and should not blur who owns assessment or treatment decisions. Murph is also not a registered dietitian and cannot provide individualized medical nutrition therapy or an insurance-billed visit.",
    ],
    useTogether:
      "Let the registered dietitian own assessment and medical nutrition therapy. Add Murph to prepare questions, connect the care plan with other health threads, and support agreed steps between visits. Murph should not override the care plan, and medication decisions remain with the prescribing clinician.",
  },
  {
    category: "nutrition",
    chooseCompetitor:
      "Choose Fay when finding and working with a particular RD or RDN, with insurance billing and direct between-visit chat, is the primary goal.",
    chooseMurph:
      "Choose Murph for non-clinical support, or add it when questions, other health context, and practical follow-through need attention between appointments without asking Murph to overrule the dietitian.",
    competitor: {
      clinicalRole:
        "Fay connects patients with board-certified RDs and RDNs who can provide medical nutrition therapy within their licensure and specialty.",
      followThrough:
        "Scheduled visits, direct dietitian chat, daily goals, meal photos, symptom or win tracking, tasks, progress, and rewards.",
      format:
        "A US dietitian marketplace, insurer-billing service, and patient app for virtual or in-person nutrition care.",
      hardware:
        "No proprietary hardware is required. A Withings partnership supports discovery and related connected-health workflows.",
      inputs:
        "Health history, insurance, goals, meal photos, symptoms, progress, messages, and information shared with the selected dietitian.",
      insightStyle:
        "Individualized clinical guidance from the chosen dietitian, supported by daily logs and messaging.",
      platforms:
        "iOS, Android, and web booking for virtual or in-person care across all 50 US states. Individual provider licensing and location still matter.",
      pricing:
        "US pricing checked August 30, 2026: Fay advertises visits as low as $0, says most patients pay $0 to $12 and 95% pay under $15, while uncovered care is about $150 per session. Final cost depends on benefits.",
      primaryJob:
        "Help a patient find, book, and continue care with a registered dietitian.",
    },
    competitorEvidence: {
      clinicalRole: [1, 3],
      followThrough: [1],
      format: [1, 3],
      hardware: [4],
      inputs: [1],
      insightStyle: [1],
      platforms: [1, 3],
      pricing: [2],
      primaryJob: [1, 3],
    },
    faqs: [
      {
        answer:
          "Fay lets people filter dietitians by specialty, approach, availability, insurance, and virtual or in-person format. The ongoing relationship is with the selected RD or RDN, not an interchangeable automated coach.",
        question: "How does Fay match someone with a dietitian?",
      },
      {
        answer:
          "Fay's price estimates are based on insurance and can be very low, but deductibles, eligibility, location, age, plan rules, and claim processing can change the final bill. Uncovered sessions are advertised at about $150.",
        question: "What will a Fay nutrition visit cost?",
      },
      {
        answer:
          "A Fay dietitian can provide medical nutrition therapy and collaborate around medication-related eating needs. Dietitians generally do not replace the clinician responsible for prescribing, dosing, or monitoring a weight-loss drug.",
        question: "Can a Fay dietitian prescribe weight-loss medication?",
      },
    ],
    headline: "Choosing a dietitian and supporting the plan between visits",
    lastVerified: "2026-08-31",
    metaDescription:
      "Fay helps you choose and work with a registered dietitian. Murph instead is a personal health assistant for non-clinical context and support between visits.",
    name: "Fay",
    quickComparison: [
      {
        capability: "Choice of a specific dietitian",
        evidence: "primaryJob",
        murph: "no",
        competitor: "yes",
      },
      {
        capability: "Insurance billing",
        evidence: "format",
        murph: "no",
        competitor: "yes",
      },
      {
        capability: "Direct chat with your provider",
        evidence: "followThrough",
        murph: "no",
        competitor: "yes",
      },
      {
        capability: "Cross domain health context",
        evidence: "inputs",
        murph: "yes",
        competitor: "limited",
      },
      {
        capability: "Works in iMessage or Telegram",
        evidence: "format",
        murph: "yes",
        competitor: "limited",
      },
      {
        capability: "Handles health errands",
        evidence: "followThrough",
        murph: "yes",
        competitor: "limited",
      },
      {
        capability: "Tests what works for you",
        evidence: "followThrough",
        murph: "yes",
        competitor: "limited",
      },
      {
        capability: "Open source option",
        evidence: "platforms",
        murph: "yes",
        competitor: "no",
      },
      {
        capability: "Handles changing priorities",
        evidence: "primaryJob",
        murph: "yes",
        competitor: "limited",
      },
      {
        capability: "Reminders and check ins",
        evidence: "followThrough",
        murph: "yes",
        competitor: "yes",
      },
    ],
    relationship: "different-role",
    slug: "fay",
    sources: [
      {
        label: "Fay nutrition care overview",
        url: "https://www.faynutrition.com/",
      },
      {
        label: "Fay insurance price estimate",
        url: "https://www.faynutrition.com/get-your-price",
      },
      {
        label: "Fay online nutritionists",
        url: "https://www.faynutrition.com/find-nutritionists/online",
      },
      {
        label: "Fay and Withings partnership",
        url: "https://www.faynutrition.com/post/fay-withings-announcement",
      },
    ],
    tradeoffs: [
      "The quality and fit of care depend on the individual dietitian, specialty, schedule, and relationship.",
      "Insurance estimates can change after claims process and are not a guarantee of the final patient responsibility.",
      "Nutrition care and medication prescribing remain separate professional scopes, and adding an AI assistant does not transfer either scope to the assistant. Murph cannot match you with an RD, book or bill a visit, or deliver medical nutrition therapy.",
    ],
    useTogether:
      "Let the selected Fay dietitian own individualized nutrition care. Add Murph when a question crosses into other health domains or when a practical step needs support between appointments. Murph should not override the dietitian's plan.",
  },
  {
    category: "nutrition",
    chooseCompetitor:
      "Choose Nutrisense when glucose sensors, meal-response analysis, Nora AI, and access to an RD or CNS are the central experience you want.",
    chooseMurph:
      "Choose Murph when you want to reason and follow through across health without making continuous glucose the center of the relationship, or when a Nutrisense result needs to be weighed beside other evidence and real-life burden.",
    competitor: {
      clinicalRole:
        "A metabolic wellness program with optional RD or CNS coaching. The app and OTC sensors do not replace diagnosis, treatment, or a prescribing clinician.",
      followThrough:
        "Nora AI, meal scores, habits, courses, webinars, goals, messaging, and video coaching eligibility depending on plan and insurance.",
      format:
        "A mobile CGM analysis and coaching program with bring-your-own-sensor and sensor-included options.",
      hardware:
        "Continuous glucose sensors are central. Supported options include Stelo, Dexcom, Libre, and Lingo with platform-specific limits.",
      inputs:
        "CGM readings, meals, sleep, activity, mood, habits, goals, Apple Health, Fitbit, Garmin, Oura, Google Fit, and MyFitnessPal data.",
      insightStyle:
        "Glucose trends, meal scores, response patterns, AI explanations, experiments, and feedback from a nutrition professional where included.",
      platforms:
        "iOS and Android. Sensor and connector support varies; Lingo support is documented for iOS rather than Android.",
      pricing:
        "US pricing checked August 30, 2026: bring-your-own-sensor access is $39 monthly or $199 yearly after a three-day trial. Sensor plans currently show conflicting promotions around $152 monthly for six months, $178 to $179 for three months, and $212 to $215 for one month.",
      primaryJob:
        "Use continuous glucose data, AI, and optional nutrition coaching to explore metabolic responses.",
    },
    competitorEvidence: {
      clinicalRole: [2, 3],
      followThrough: [2, 3, 4],
      format: [1, 2],
      hardware: [1, 2],
      inputs: [1, 3],
      insightStyle: [2, 3],
      platforms: [1, 3],
      pricing: [1, 2],
      primaryJob: [2, 3],
    },
    faqs: [
      {
        answer:
          "Yes. The bring-your-own-sensor plan provides app analysis and guidance for supported CGMs at a lower software price. Compatibility depends on the sensor, phone, country, and connection method.",
        question: "Can I use Nutrisense with my own CGM?",
      },
      {
        answer:
          "Nutrisense offers access to RD or CNS coaching, and qualifying insurance can reduce the coaching cost. Sensor hardware and the app program may still be paid out of pocket, so coverage should be verified separately.",
        question: "Does Nutrisense include a registered dietitian?",
      },
      {
        answer:
          "The program is generally for adults 18 and older. Stelo and similar OTC routes are not intended for insulin users, dialysis, or problematic hypoglycemia, and medication changes require the person's clinician.",
        question: "Who should not use Nutrisense without medical guidance?",
      },
    ],
    headline: "CGM experiments and coaching in a wider health context",
    lastVerified: "2026-08-31",
    metaDescription:
      "Nutrisense centers CGM analysis, AI, and optional nutrition coaching. Murph is a broader personal health assistant, not a sensor-analysis dashboard or clinician.",
    name: "Nutrisense",
    quickComparison: [
      {
        capability: "Continuous glucose analysis",
        evidence: "insightStyle",
        murph: "connected",
        competitor: "yes",
      },
      {
        capability: "Supported bring your own CGM",
        evidence: "format",
        murph: "connected",
        competitor: "limited",
      },
      {
        capability: "AI glucose explanations",
        evidence: "insightStyle",
        murph: "yes",
        competitor: "yes",
      },
      {
        capability: "Nutrition professional coaching",
        evidence: "clinicalRole",
        murph: "no",
        competitor: "limited",
      },
      {
        capability: "Cross domain health context",
        evidence: "inputs",
        murph: "yes",
        competitor: "limited",
      },
      {
        capability: "Works without dedicated hardware",
        evidence: "hardware",
        murph: "yes",
        competitor: "no",
      },
      {
        capability: "Works in iMessage or Telegram",
        evidence: "format",
        murph: "yes",
        competitor: "limited",
      },
      {
        capability: "Handles health errands",
        evidence: "followThrough",
        murph: "yes",
        competitor: "no",
      },
      {
        capability: "Tests what works for you",
        evidence: "insightStyle",
        murph: "yes",
        competitor: "yes",
      },
      {
        capability: "Free start without a card",
        evidence: "pricing",
        murph: "yes",
        competitor: "limited",
      },
    ],
    relationship: "complement",
    slug: "nutrisense",
    sources: [
      {
        label: "Nutrisense bring-your-own sensor",
        url: "https://www.nutrisense.io/products/bring-your-own-sensor",
      },
      {
        label: "Nutrisense CGM plans",
        url: "https://www.nutrisense.io/products/cgm-plans",
      },
      {
        label: "Nutrisense app and integrations",
        url: "https://www.nutrisense.io/what-is-a-cgm/how-to/app",
      },
      {
        label: "Nutrisense frequently asked questions",
        url: "https://www.nutrisense.io/faq",
      },
    ],
    tradeoffs: [
      "Sensor programs make glucose patterns visible while adding device cost, skin wear, and attention to short-term variation that may or may not change a useful decision. Murph supplies no CGM, sensor-analysis dashboard, or access to an RD or CNS.",
      "The official plan page presents conflicting promotional amounts, so a dated checkout quote is necessary.",
      "Nutrition coaching, app access, and sensor hardware can have different insurance and out-of-pocket treatment.",
    ],
    useTogether:
      "Let Nutrisense own the sensor experiment and any professional coaching. Add Murph to discuss the results you choose to share alongside wider health context and support the resulting plan. No direct data connection is claimed.",
  },
  {
    category: "nutrition",
    chooseCompetitor:
      "Choose Carb Manager when net carbs, keto macros, fasting, low-carb recipes, meal planning, and metabolic self-tracking define the daily job.",
    chooseMurph:
      "Choose Murph when you want to evaluate low-carb eating beside symptoms, training, sleep, labs, preferences, and real-life burden before committing to its rules. It can support a bounded plan, but it will not replace net-carb logging.",
    competitor: {
      clinicalRole:
        "A wellness and nutrition tracker. Glucose, ketone, insulin, and blood-pressure fields are self-management records, not medical treatment.",
      followThrough:
        "Goals, reminders, fasting, meal planning, shopping lists, recipes, community, macro cycling, and Smart Macros on Premium.",
      format:
        "A keto and low-carb food diary with free tracking and a Premium planning layer.",
      hardware:
        "No proprietary hardware is required. Supported meters, wearables, and health platforms can contribute selected data.",
      inputs:
        "Food search, barcode, photo, voice, recipes, weight, exercise, fasting, glucose, ketones, insulin, sleep, and body measurements.",
      insightStyle:
        "Net and total carbs, calories, macros, nutrients, fasting history, metabolic logs, trends, and low-carb meal guidance.",
      platforms:
        "iOS, iPad, Apple Watch, Android, and web, with Apple Health, Health Connect, Garmin, Fitbit, Keto-Mojo, and other connections.",
      pricing:
        "US pricing checked August 30, 2026: Premium is advertised at $39.99 yearly, equivalent to $3.33 monthly when billed annually. Monthly and quarterly options exist, but current public exact amounts were not verified.",
      primaryJob:
        "Track net carbohydrates and plan keto or low-carb eating.",
    },
    competitorEvidence: {
      clinicalRole: [1, 3],
      followThrough: [1],
      format: [1],
      hardware: [1],
      inputs: [1, 3],
      insightStyle: [1],
      platforms: [1, 3],
      pricing: [1, 2],
      primaryJob: [1],
    },
    faqs: [
      {
        answer:
          "Carb Manager is built around net carbs and low-carb targets, while still offering calories, macros, nutrients, recipes, exercise, weight, and other health logs. Premium adds the deeper planning and analysis tools.",
        question: "Is Carb Manager only for strict keto?",
      },
      {
        answer:
          "The app can record glucose, ketones, insulin, blood pressure, and related measurements and can connect with some meters. Those logs do not provide diagnosis, medication dosing, or individualized diabetes treatment.",
        question: "Can Carb Manager manage diabetes?",
      },
      {
        answer:
          "No. Carb Manager is purpose-built for net carbs, keto macros, fasting, recipes, and related metabolic logs. Murph fits before or around that workflow: it can help examine whether the approach suits your wider health, define what would make it worth continuing, and revisit the decision. No direct connection is implied.",
        question: "Would Murph replace Carb Manager's low-carb tracker?",
      },
    ],
    headline: "Keto tracking or a bounded diet experiment",
    lastVerified: "2026-08-31",
    metaDescription:
      "Carb Manager specializes in keto tracking, net carbs, fasting, and recipes. The personal health assistant Murph helps decide whether the plan fits wider health.",
    name: "Carb Manager",
    quickComparison: [
      {
        capability: "Net carb tracking",
        evidence: "primaryJob",
        murph: "limited",
        competitor: "yes",
      },
      {
        capability: "Fasting timer",
        evidence: "followThrough",
        murph: "no",
        competitor: "yes",
      },
      {
        capability: "Low carb recipes",
        evidence: "followThrough",
        murph: "limited",
        competitor: "yes",
      },
      {
        capability: "Metabolic measurement logs",
        evidence: "inputs",
        murph: "yes",
        competitor: "yes",
      },
      {
        capability: "Cross domain health context",
        evidence: "inputs",
        murph: "yes",
        competitor: "limited",
      },
      {
        capability: "Works in iMessage or Telegram",
        evidence: "format",
        murph: "yes",
        competitor: "no",
      },
      {
        capability: "Handles health errands",
        evidence: "followThrough",
        murph: "yes",
        competitor: "no",
      },
      {
        capability: "Tests what works for you",
        evidence: "followThrough",
        murph: "yes",
        competitor: "limited",
      },
      {
        capability: "Open source option",
        evidence: "platforms",
        murph: "yes",
        competitor: "no",
      },
      {
        capability: "Optional group support",
        evidence: "followThrough",
        murph: "yes",
        competitor: "yes",
      },
    ],
    relationship: "alternative",
    slug: "carb-manager",
    sources: [
      {
        label: "Carb Manager Premium",
        url: "https://www.carbmanager.com/premium",
      },
      {
        label: "Carb Manager subscription guide",
        url: "https://help.carbmanager.com/docs/subscribe-to-carb-manager-premium",
      },
      {
        label: "Carb Manager App Store listing",
        url: "https://apps.apple.com/us/app/carb-manager-keto-macro-log/id410089731",
      },
    ],
    tradeoffs: [
      "A low-carb-first design is efficient once the approach is chosen, but it is not a neutral place to decide whether low-carb eating is the right approach. Murph can examine the premise, but it does not supply a net-carb ledger, fasting timer, or low-carb recipe plan.",
      "Those metabolic and blood-pressure fields can organize observations without establishing treatment decisions.",
      "The clearly published value price requires annual billing.",
    ],
  },
  {
    category: "nutrition",
    chooseCompetitor:
      "Choose Cal AI when the fastest possible photo, barcode, or text meal entry matters more than detailed manual logging or human coaching.",
    chooseMurph:
      "Choose Murph when speed of logging is not the main problem and you need to weigh food beside symptoms, goals, records, preferences, and practical constraints, then carry a realistic next step forward.",
    competitor: {
      clinicalRole:
        "A consumer app for wellness estimates, without professional nutrition services, medical advice, diagnosis, or treatment.",
      followThrough:
        "Personal targets, progress views, recipes, custom foods, activity context, and repeated AI-assisted meal logging.",
      format:
        "A subscription mobile app centered on estimating calories and macros from meal photos.",
      hardware:
        "No proprietary hardware is required. A phone camera and supported health-platform data provide the main inputs.",
      inputs:
        "Meal photos, barcodes, text descriptions, recipes, custom foods, weight goals, steps, exercise, Apple Health, and Google health data.",
      insightStyle:
        "Estimated calories and macros, daily target progress, meal history, and goal-oriented summaries.",
      platforms:
        "iOS, Apple Watch, and Android, with Apple Health and Google Fit references in official materials.",
      pricing:
        "US pricing checked August 30, 2026 is not transparently labeled by term. Apple lists Unlimited purchases from $2.99 to $29.99 and says some purchases may support Family Sharing; verify the price, duration, and renewal in checkout after the three-day trial.",
      primaryJob:
        "Estimate meal calories and macros quickly from a photo or short description.",
    },
    competitorEvidence: {
      clinicalRole: [4],
      followThrough: [1, 3],
      format: [1, 3],
      hardware: [1, 3],
      inputs: [1, 3],
      insightStyle: [1, 3],
      platforms: [1, 3],
      pricing: [1, 3, 4],
      primaryJob: [1],
    },
    faqs: [
      {
        answer:
          "No. Cal AI estimates likely foods, portions, calories, and macros from the image and other information. Its own FAQ describes about 80% scan accuracy, so the result should be checked and corrected.",
        question: "Are Cal AI photo estimates exact?",
      },
      {
        answer:
          "Cal AI is better for repeatedly turning photos into estimated calories and macros. Murph is useful when you need to question that estimate, connect eating with other health context, and decide what action is worthwhile. It does not recreate Cal AI's scanner, and no direct connection is implied.",
        question: "What would Murph add to Cal AI?",
      },
      {
        answer:
          "The official service uses calai.app. Its terms identify Cal AI, Inc. as the operator, while Apple lists Viral Development LLC as the App Store seller. Similarly named apps can have different features, prices, and privacy terms.",
        question: "How do I identify the official Cal AI app?",
      },
    ],
    headline: "Fast photo estimates or a broader health conversation",
    lastVerified: "2026-08-31",
    metaDescription:
      "Cal AI turns meal photos into fast calorie and macro estimates. Murph works as the personal health assistant for the wider decision; it is not a camera-based food logger.",
    name: "Cal AI",
    quickComparison: [
      {
        capability: "Photo calorie estimates",
        evidence: "primaryJob",
        murph: "yes",
        competitor: "yes",
      },
      {
        capability: "Barcode meal logging",
        evidence: "inputs",
        murph: "no",
        competitor: "yes",
      },
      {
        capability: "Calorie and macro ledger",
        evidence: "insightStyle",
        murph: "yes",
        competitor: "yes",
      },
      {
        capability: "Cross domain health context",
        evidence: "inputs",
        murph: "yes",
        competitor: "limited",
      },
      {
        capability: "Remembered plan follow through",
        evidence: "followThrough",
        murph: "yes",
        competitor: "limited",
      },
      {
        capability: "Works in iMessage or Telegram",
        evidence: "format",
        murph: "yes",
        competitor: "no",
      },
      {
        capability: "Handles health errands",
        evidence: "followThrough",
        murph: "yes",
        competitor: "no",
      },
      {
        capability: "Tests what works for you",
        evidence: "followThrough",
        murph: "yes",
        competitor: "no",
      },
      {
        capability: "Free start without a card",
        evidence: "pricing",
        murph: "yes",
        competitor: "limited",
      },
      {
        capability: "Open source option",
        evidence: "platforms",
        murph: "yes",
        competitor: "no",
      },
    ],
    relationship: "alternative",
    slug: "cal-ai",
    sources: [
      {
        label: "Cal AI product overview",
        url: "https://calai.app/",
      },
      {
        label: "Cal AI frequently asked questions",
        url: "https://calai.app/faq",
      },
      {
        label: "Cal AI App Store listing",
        url: "https://apps.apple.com/us/app/cal-ai-calorie-tracker/id6480417616",
      },
      {
        label: "Cal AI terms of service",
        url: "https://www.calai.app/tos",
      },
    ],
    tradeoffs: [
      "Fast photo logging offers a real convenience advantage, but it trades precision for speed and requires review of ingredients and portions. Murph can discuss an estimate but offers no equivalent camera-to-calorie workflow, food database, or macro ledger.",
      "The official storefront does not label its many purchase amounts clearly enough to publish one dependable monthly or annual price.",
      "The app supplies automated wellness estimates rather than human dietitian coaching or medical care.",
    ],
  },
  {
    aliases: ["Ate Food Journal"],
    category: "nutrition",
    chooseCompetitor:
      "Choose AteMate when quick photo journaling of meals and day-to-day wellbeing, plus an AI coach grounded in that record, are the behavior-change tools you want.",
    chooseMurph:
      "Choose Murph when you want help to begin with a health question or task instead of maintaining a journal, when authorized records or connected data need to inform the answer, and when the result should become a remembered plan or action.",
    competitor: {
      clinicalRole:
        "A personal health journal for awareness. Its AI coach is not a clinician, dietitian, diagnosis service, or disease treatment.",
      followThrough:
        "AI prompts, pattern summaries, reminders, mindful questions, goals, and optional sharing with a human coach.",
      format:
        "A visual health journal with meal photos, wellbeing entries, and an AI coach; calorie and macro tracking remain optional.",
      hardware:
        "No proprietary hardware is required. Phones and watches support capture, while health-platform connections can add activity or related data.",
      inputs:
        "Meal photos, hunger, mood, reasons for eating, hydration, movement, sleep, weight, blood pressure, glucose, and optional calories or macros.",
      insightStyle:
        "Cross-pillar patterns, weekly reviews, AI conversation grounded in journal history, and coach-readable entries.",
      platforms:
        "iPhone, iPad, Apple Watch, and Android, with health-platform support including Health Connect and Apple ecosystem data.",
      pricing:
        "US pricing checked August 30, 2026: the base journal lists $9.99 monthly, $19.99 quarterly, or $49.99 yearly. AteMate Coach is a separate $19.99 monthly tier; Coach Plus is another tier whose public US price was not verified.",
      primaryJob:
        "Capture daily patterns across food and wellbeing through a photo-led journal and AI coach rather than compulsory calorie counting.",
    },
    competitorEvidence: {
      clinicalRole: [1],
      followThrough: [1, 2],
      format: [1],
      hardware: [1, 2, 3],
      inputs: [1, 2, 3],
      insightStyle: [1],
      platforms: [2, 3],
      pricing: [2],
      primaryJob: [1],
    },
    faqs: [
      {
        answer:
          "No. AteMate is intentionally usable as a photo and context journal without calorie targets. People who want numbers can enable calories and macros, but they are not required for the main photo-journal workflow.",
        question: "Do I have to count calories in AteMate?",
      },
      {
        answer:
          "AteMate includes an automated AI coach that responds to the journal and surfaces patterns. A person can also share data with a separate human coach, but the app's AI itself is not a registered dietitian or clinician.",
        question: "Is AteMate's AI coach a human dietitian?",
      },
      {
        answer:
          "AteMate already has an AI coach that can use journal history across food, mood, hydration, movement, and sleep. Its advantage is the dedicated, low-friction journal. Murph differs by starting from any health question or task, using relevant authorized context beyond journal entries, and carrying decisions into broader follow-through. Neither product turns automated feedback into clinical care.",
        question: "How is Murph different from AteMate?",
      },
    ],
    headline: "A five-pillar journal or question-first health support",
    lastVerified: "2026-08-31",
    metaDescription:
      "AteMate is a five-pillar photo journal with AI pattern coaching. Murph is a question-first personal health assistant for decisions and action beyond the journal.",
    name: "AteMate",
    quickComparison: [
      {
        capability: "Photo health journaling",
        evidence: "format",
        murph: "limited",
        competitor: "yes",
      },
      {
        capability: "Five pillar journal reviews",
        evidence: "insightStyle",
        murph: "no",
        competitor: "yes",
      },
      {
        capability: "AI journal pattern coaching",
        evidence: "insightStyle",
        murph: "limited",
        competitor: "limited",
      },
      {
        capability: "Question first support",
        evidence: "primaryJob",
        murph: "yes",
        competitor: "limited",
      },
      {
        capability: "Authorized health record context",
        evidence: "inputs",
        murph: "yes",
        competitor: "no",
      },
      {
        capability: "Works in iMessage or Telegram",
        evidence: "format",
        murph: "yes",
        competitor: "limited",
      },
      {
        capability: "Handles health errands",
        evidence: "followThrough",
        murph: "yes",
        competitor: "no",
      },
      {
        capability: "Tests what works for you",
        evidence: "followThrough",
        murph: "yes",
        competitor: "limited",
      },
      {
        capability: "Free start without a card",
        evidence: "pricing",
        murph: "yes",
        competitor: "limited",
      },
      {
        capability: "Reminders and check ins",
        evidence: "followThrough",
        murph: "yes",
        competitor: "yes",
      },
    ],
    relationship: "alternative",
    slug: "atemate",
    sources: [
      {
        label: "AteMate product overview",
        url: "https://youate.com/",
      },
      {
        label: "AteMate App Store listing",
        url: "https://apps.apple.com/us/app/atemate-food-journal-support/id1164976477",
      },
      {
        label: "AteMate Google Play listing",
        url: "https://play.google.com/store/apps/details?id=com.youate.android",
      },
      {
        label: "AteMate terms and privacy",
        url: "https://youate.com/terms-privacy.html",
      },
    ],
    tradeoffs: [
      "A photo-led journal lowers the pressure to count, while its value still depends on maintaining enough entries for the AI coach to see a pattern. Murph asks for less ongoing capture, but it has no dedicated photo timeline or five-pillar journal review.",
      "AI pattern feedback remains automated guidance rather than individualized clinical nutrition care.",
      "Official storefronts retain legacy subscription SKUs, so current-account checkout terms should be confirmed.",
    ],
  },
]);
