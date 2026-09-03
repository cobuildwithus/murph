import { defineComparisons } from "../types";

export const NUTRITION_COMPARISONS = defineComparisons([
  {
    category: "nutrition",
    chooseCompetitor:
      "Pick MyFitnessPal when the main job is fast food entry, barcode scanning, calorie targets, and a deep set of exercise and device connections.",
    chooseMurph:
      "Choose Murph if you want to log meals by photo or text and then talk through what the numbers mean. It keeps your food beside your sleep, training, and records, and it can import your MyFitnessPal meals.",
    competitor: {
      clinicalRole:
        "A general wellness tracker. It does not diagnose conditions, prescribe treatment, or stand in for a clinician or dietitian.",
      followThrough:
        "Goals, feedback on your diary, streaks, and reminders. Fasting tools and meal planning come with the Premium tiers.",
      format:
        "A structured food and exercise diary with dashboards and goals. Meal-planning tools are optional.",
      hardware:
        "No special hardware is needed. Supported wearables and smart scales can add activity, sleep, or weight data.",
      inputs:
        "Manual search, barcode, saved meals, recipes, photo, voice, weight, exercise, and data from supported health platforms.",
      insightStyle:
        "Daily calorie and nutrient totals, progress toward goals, food patterns, and reports that depend on your subscription level.",
      platforms:
        "Web, iOS, and Android. It connects to Apple Health, Health Connect, Fitbit, Garmin, Samsung Health, Withings, and other services.",
      pricing:
        "US pricing checked August 30, 2026: a free tier, Premium at $19.99 a month or $79.99 a year, and Premium+ at $24.99 a month or $99.99 a year. Offers can vary.",
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
          "Yes. The free tier covers basic food, weight, exercise, and progress tracking. In the United States, barcode scanning and several advanced logging and analysis tools need a Premium plan.",
        question: "Is MyFitnessPal free to use?",
      },
      {
        answer:
          "MyFitnessPal connects with many health platforms and devices. Which fields sync, and whether a connection is offered at all, depends on your operating system, country, device, and the partner app.",
        question: "What health data can MyFitnessPal collect?",
      },
      {
        answer:
          "For many people, yes. Murph logs meals from a photo or text with calorie and macro estimates, searches about two million food labels plus the USDA catalog, and imports your MyFitnessPal meals. MyFitnessPal is still faster if you rely on barcode scanning, and neither product replaces medical nutrition care.",
        question: "Can Murph replace my MyFitnessPal food diary?",
      },
    ],
    headline: "MyFitnessPal logs the meal. Murph ties it to your sleep, training, and labs.",
    integration: "direct",
    lastVerified: "2026-08-31",
    metaDescription:
      "MyFitnessPal is a fast calorie and macro diary with barcode scanning. Murph is a personal health assistant that logs meals too, then links them to your sleep, training, and labs.",
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
      "The free tier is useful, but in the United States barcode scanning and many deeper tools sit behind a subscription.",
      "A large database makes entry quick. It also means checking user-submitted foods and automatic estimates before you trust them.",
      "MyFitnessPal is built as a diary, which is efficient for totals and targets. Murph logs meals too, but it has no barcode scanner and no streaks. Its strength is explaining a food pattern beside your sleep, training, and labs.",
    ],
  },
  {
    category: "nutrition",
    chooseCompetitor:
      "Cronometer is the better fit if you want verified food records, detailed nutrient targets, biometrics, and nutrition reports you can export.",
    chooseMurph:
      "Choose Murph if a nutrient chart raises a question you want to talk through. It imports your Cronometer meals, keeps your health history in the conversation, and helps you weigh a change without making food tracking the whole project.",
    competitor: {
      clinicalRole:
        "The consumer app is a wellness tracker. It does not diagnose or treat. Cronometer also sells separate professional products for practices.",
      followThrough:
        "Targets, diary groups, fasting, food suggestions, charts, and reports. Gold adds Crono Coach AI.",
      format:
        "A precise nutrition diary with nutrient dashboards, biometrics, notes, trends, and reports.",
      hardware:
        "No device of its own is required. It can take in supported data from wearables, scales, glucose devices, and health platforms.",
      inputs:
        "Food search, barcode, recipes, exercise, biometrics, notes, and supported device data. Photo logging is on Gold.",
      insightStyle:
        "Nutrient adequacy, energy balance, biomarker charts, correlations, and detailed reports built on verified food data.",
      platforms:
        "Web, iOS, and Android. Integrations include Apple Health, Health Connect, Garmin, Fitbit, WHOOP, Oura, Dexcom, Withings, and Keto-Mojo.",
      pricing:
        "US pricing checked August 30, 2026: Basic is free. Gold is $10.99 a month or $59.99 a year. Taxes and regional offers may differ.",
      primaryJob:
        "Measure energy, macros, micronutrients, exercise, and biometrics in detail, and track progress against them.",
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
          "Very detailed. Beyond calories and macros it tracks a broad set of vitamins, minerals, fatty acids, amino acids, and other compounds, as long as the food record you pick contains them. Its official pages quote slightly different nutrient counts, so judge coverage food by food.",
        question: "How detailed is Cronometer's nutrient tracking?",
      },
      {
        answer:
          "Yes, from many devices and platforms. Each connector has its own direction and limits. Activity energy may come across while raw step totals do not, for example.",
        question: "Does Cronometer import wearable data?",
      },
      {
        answer:
          "Cronometer stays the better nutrient ledger, and Murph imports its meals rather than competing on precision. Murph then sets a possible gap beside your symptoms, labs, routines, preferences, and the effort of tracking, and helps you decide whether to change anything. Neither product is clinical nutrition care.",
        question: "What does Murph add to Cronometer?",
      },
    ],
    headline: "Cronometer counts every nutrient. Murph helps you decide what to change.",
    integration: "direct",
    lastVerified: "2026-08-31",
    metaDescription:
      "Cronometer tracks vitamins, minerals, and biometrics in detail. Murph is a personal health assistant that imports that data and reads it beside your labs, sleep, and symptoms.",
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
      "The depth suits nutrient-focused users. It is more detail than a simple weight-loss diary needs.",
      "How complete a nutrient total is depends on the food record, even when the app supports the field. Murph estimates calories and macros from what you log or import, but it does not build Cronometer's micronutrient ledger.",
      "Device connectors differ in what they read and write. A listed integration does not mean full parity, and it does not tell you what the pattern means.",
    ],
  },
  {
    category: "nutrition",
    chooseCompetitor:
      "Pick MacroFactor when you want an expenditure estimate and weekly calorie or macro adjustments built from steady intake and weight data.",
    chooseMurph:
      "Choose Murph if the real question involves sleep, symptoms, training, records, stress, or whether the logging is still worth it. Murph helps you shape and revisit the plan, but it is not an adaptive calorie algorithm.",
    competitor: {
      clinicalRole:
        "A self-guided nutrition and fitness app. It is not a clinician, a registered dietitian, a diagnosis service, or a prescription program.",
      followThrough:
        "Weekly program check-ins, adaptive targets, and progress trends. Its coaching language stays neutral about adherence.",
      format:
        "A paid mobile food logger paired with an algorithm that sets calorie and macro targets.",
      hardware:
        "No special hardware is required. Connected health platforms can pass in weight and nutrition data, including readings from compatible scales.",
      inputs:
        "Logged food, calories, macros, scale weight, goals, recipes, and selected data from Apple Health or Health Connect.",
      insightStyle:
        "Estimated energy expenditure, a smoothed weight trend, rate of change, and weekly target adjustments.",
      platforms:
        "iOS and Android, with Apple Health and Health Connect. It does not rely on activity-calorie estimates from wearables.",
      pricing:
        "US pricing checked August 30, 2026: $11.99 a month, $47.99 for six months, or $71.99 a year. A Nutrition and Workouts bundle is $89.99 a year for eligible new users.",
      primaryJob:
        "Adapt calorie and macro targets from what you log and how your body weight changes.",
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
          "It estimates your energy expenditure from how logged intake lines up with weight change. Each week it proposes updated calorie and macro targets. Missed targets are treated as data, not as a moral failure.",
        question: "How does MacroFactor adjust a nutrition plan?",
      },
      {
        answer:
          "No. Its core expenditure model is built on food and weight data on purpose. A watch's daily calorie estimate does not move your targets.",
        question: "Does MacroFactor use wearable calorie burn in its algorithm?",
      },
      {
        answer:
          "MacroFactor turns steady food and weight data into a focused body-composition program. Murph adds an ongoing conversation about what the model leaves out: competing health goals, symptoms, training, and whether the routine is sustainable. It does not replace the expenditure model or a clinician.",
        question: "When would Murph add something to MacroFactor?",
      },
    ],
    headline: "MacroFactor adjusts your macros each week. Murph covers the rest of your health.",
    lastVerified: "2026-08-31",
    metaDescription:
      "MacroFactor estimates expenditure and adjusts your calorie and macro targets weekly. Murph is a personal health assistant for the sleep, training, and symptoms around that plan.",
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
        murph: "limited",
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
      "The adaptive model gets better as food and weight are logged consistently and accurately.",
      "There is no lasting free tier once the trial ends.",
      "The app deliberately ignores daily wearable calorie estimates when setting food targets. That removes a noisy input but keeps the program narrow. Murph can talk through that tradeoff, but it does not estimate expenditure or set weekly calorie and macro targets.",
    ],
  },
  {
    category: "nutrition",
    chooseCompetitor:
      "Pick Noom when you want a structured weight curriculum, its food color system, daily lessons, and the option of a Noom Med evaluation.",
    chooseMurph:
      "Choose Murph if you want to log meals and ask what the numbers mean, without a daily lesson to complete. It keeps your food beside your sleep, training, and records, and it remembers the plan you land on.",
    competitor: {
      clinicalRole:
        "Noom Weight is a wellness program. Noom Med is a separate service led by clinicians, who may prescribe medication after an evaluation where it is available.",
      followThrough:
        "Daily lessons, weight and meal routines, habit prompts, and Welli AI. Coaching is optional. Eligible Med plans add medication follow-up.",
      format:
        "A structured behavior change program in a mobile app. Separate telehealth plans cover medical weight care for eligible members.",
      hardware:
        "No hardware of its own. Phones, scales, wearables, and supported health services can supply steps or weight.",
      inputs:
        "Food by search, photo, or voice, with calorie and color categories. Also weight, steps, habits, lessons, and an optional clinical intake.",
      insightStyle:
        "Psychology-based lessons, calorie guidance, habit feedback, and progress views. Med plans add clinical monitoring.",
      platforms:
        "iOS and Android. Health and device connections vary by operating system. Account history does not move freely between mobile platforms.",
      pricing:
        "US Noom Weight pricing checked August 30, 2026 runs from $70 for one month to $209 for twelve months before discounts. Noom Med lists initial charges from $39 to $149 and later advertised rates from $99 to $299 a month, often billed quarterly. Whether medication is included varies.",
      primaryJob:
        "Guide weight change through a structured behavior program, with separate optional access to medical obesity care.",
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
          "Noom Weight uses psychology-based lessons, meal logging, calorie guidance, and habit tools. Whether a coach is available depends on the plan. Coaching is not licensed medical care.",
        question: "What kind of coaching does Noom Weight include?",
      },
      {
        answer:
          "Noom Weight does not. Noom Med sells separate plans where a licensed clinician can check your eligibility. Drug cost, insurance coverage, state availability, and what each plan includes all vary.",
        question: "Does Noom include weight loss medication?",
      },
      {
        answer:
          "No. Noom's lessons, food color system, and Noom Med clinicians are distinct services that Murph does not offer. Murph fits when you want to log meals and talk through food, sleep, and other health questions in one place. It cannot prescribe, and it should not override a plan from a clinician.",
        question: "Can Murph replace Noom or Noom Med?",
      },
    ],
    headline: "Noom runs a weight program. Murph answers the health questions around it.",
    lastVerified: "2026-08-31",
    metaDescription:
      "Noom is a lesson-based weight program with an optional medical arm. Murph is a personal health assistant that logs meals and connects food to your sleep, training, and records.",
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
      "The lesson format gives real structure, but it keeps you inside a weight curriculum. Murph has no lesson sequence, no human coaching program, and no prescribing clinic. It starts from whatever question you bring.",
      "Weight and Med prices, renewal terms, state availability, and whether medication is included all deserve a careful look at checkout.",
      "Compounded medications are not FDA approved. They are not reviewed for safety, effectiveness, or quality the way approved drugs are.",
    ],
  },
  {
    aliases: ["WW"],
    category: "nutrition",
    chooseCompetitor:
      "Pick Weight Watchers when Points, recipe planning, a peer community, workshops, or its Clinic are the parts you want.",
    chooseMurph:
      "Choose Murph if food and weight matter to you but sit beside symptoms, sleep, training, or another health goal. Murph logs meals from a photo or text and keeps those threads together, with no Points to count.",
    competitor: {
      clinicalRole:
        "Core memberships are wellness programs. Weight Watchers Clinic is a separate medical service where clinicians evaluate members and can prescribe when eligible.",
      followThrough:
        "Points budgets, recipes, community, workshops, coaching, and activity and sleep goals. Eligible plans add GLP-1 Success support.",
      format:
        "A membership app built around Points. Live community formats are optional, and the telehealth clinic is separate.",
      hardware:
        "No hardware of its own. Activity and health connections can add data where supported.",
      inputs:
        "Food and Points, macros, weight, activity, sleep, body scans, goals, community activity, and an optional medical intake.",
      insightStyle:
        "Points guidance, progress summaries, meal planning, and community reinforcement. Clinic plans add clinical follow-up.",
      platforms:
        "iOS, Android, and web. Check which activity devices work with your current app and region.",
      pricing:
        "US pricing checked August 30, 2026 is promotional and changes often. The site advertises membership from $12 a month. Med+ advertises $25 for the first month, then $74 a month on a twelve-month term or $84 a month on six months, with GLP-1 medication extra.",
      primaryJob:
        "Support weight management with Points, recipes, community, coaching, and optional clinical care.",
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
          "The consumer program turns foods into a Points budget. It pairs that tracking with recipes, goals, and community features. Your plan decides whether workshops or extra coaching are included.",
        question: "How does the Weight Watchers program work?",
      },
      {
        answer:
          "No. Med+ includes access to the Clinic program, but the advertised price does not cover GLP-1 medication. Coverage, cash price, eligibility, and available drugs depend on your clinical and insurance situation.",
        question: "Does Weight Watchers Med+ include GLP-1 medication?",
      },
      {
        answer:
          "No. Murph has no Points system, workshops, peer community, or prescribing clinic. It gives you a private, ongoing conversation that logs meals and connects food to your other health threads, then helps you carry out a plan. Clinic decisions stay with Weight Watchers clinicians.",
        question: "Can Murph replace Weight Watchers Points, workshops, or the Clinic?",
      },
    ],
    headline: "Weight Watchers runs on Points. Murph connects food to the rest of your health.",
    lastVerified: "2026-08-31",
    metaDescription:
      "Weight Watchers offers Points, recipes, workshops, and a clinic. Murph is a personal health assistant that logs meals and reads them beside your sleep, records, and training.",
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
      "Points make food decisions simpler and the program easier to stick with. They also hide some nutritional detail on purpose and keep weight at the center.",
      "Promotional prices, commitment length, renewal rates, workshop access, and Clinic costs are hard to compare from one headline price.",
      "The consumer program and the licensed Clinic play different roles and are not the same level of care. Murph has no Points system, recipe program, workshops, peer network, or obesity medicine clinic.",
    ],
  },
  {
    category: "nutrition",
    chooseCompetitor:
      "Pick Lose It! when a calorie budget, a large food database, barcode or camera entry, and weight tracking are the core jobs.",
    chooseMurph:
      "Choose Murph if you want to log a meal from a photo or text and then ask why a pattern matters. It weighs food against symptoms, sleep, training, and records, and keeps a realistic plan moving. It has no barcode scanner.",
    competitor: {
      clinicalRole:
        "A general wellness and weight tracking product. Logging medication in it does not make it a prescribing or clinical monitoring service.",
      followThrough:
        "Goals, reminders, challenges, community, fasting, meal planning, future logging, and trend reports, depending on tier.",
      format:
        "A calorie budget app with a food diary, weight charts, goals, and optional premium analysis.",
      hardware:
        "No hardware of its own. Supported wearables and scales can supply activity or weight data.",
      inputs:
        "Food search, barcode, photo, voice, recipes, weight, exercise, water, sleep, body metrics, and medication logs.",
      insightStyle:
        "Progress against your calorie budget, macro and nutrient totals, weight trends, meal patterns, and goal reports.",
      platforms:
        "iOS, Android, and web. Connections include Apple Health, Health Connect, Fitbit, Garmin, and Withings. Existing Google Fit connections may keep working, but new ones cannot be made or reconnected.",
      pricing:
        "US pricing checked August 30, 2026: Basic is free and Premium is $79.99 a year. Lifetime is $299.99 from Basic or $229.99 for active Premium members, and personalized promotions vary.",
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
          "The free tier gives you a calorie budget plus core food, weight, and exercise logging. Premium adds more entry methods, nutrient detail, planning, fasting, extra health metrics, and more integrations.",
        question: "What does the free Lose It! plan include?",
      },
      {
        answer:
          "Yes, on Premium. It records supported GLP-1 medications, doses, injection sites, schedules, and modeled medication levels next to your nutrition goals. That log is not a prescription, a dose recommendation, or a substitute for clinical monitoring.",
        question: "Can Lose It! track GLP-1 medication?",
      },
      {
        answer:
          "For many people, yes. Murph logs meals from a photo or text with calorie and macro estimates, searches about two million food labels and the USDA catalog, and explains what a pattern means beside the rest of your health. Lose It! is still the better tool for barcode scanning and a structured daily calorie budget, and neither product prescribes or monitors treatment.",
        question: "Can Murph replace Lose It!?",
      },
    ],
    headline: "Lose It! runs your calorie budget. Murph explains what the numbers mean.",
    lastVerified: "2026-08-31",
    metaDescription:
      "Lose It! is a calorie budget app with barcode and photo entry. Murph is a personal health assistant that logs meals too and puts them beside your sleep, training, and labs.",
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
      "Premium is sold mainly as an annual plan. Lifetime pricing depends on your current membership state.",
      "Photo and voice results are estimates and need a check before they become useful nutrition data. Murph estimates calories and macros the same way, but it has no barcode scanner, and it sets a calorie target rather than running a daily budget.",
      "The medication features organize what you report. They do not make dosing or safety decisions, and a diary does not make medication the right lens for every health question.",
    ],
  },
  {
    category: "nutrition",
    chooseCompetitor:
      "Foodnoms is the better fit if you live on Apple devices and want a private calorie and macro tracker with Siri, Shortcuts, and Apple Health support.",
    chooseMurph:
      "Choose Murph if you want to log a meal from a photo or text and then ask how it fits with your sleep, training, symptoms, or records. It works in iMessage or Telegram on any phone, and it helps you carry out the change you settle on.",
    competitor: {
      clinicalRole:
        "A consumer wellness tracker. It does not offer medical nutrition therapy, diagnosis, prescribing, or human clinical coaching.",
      followThrough:
        "Goals, reminders, fasting, favorites, trends, and analysis of your top foods. Plus adds AI-assisted logging.",
      format:
        "A privacy-focused food diary built natively for Apple devices. The core is free, with an optional Plus subscription.",
      hardware:
        "You need an Apple device. There is no Foodnoms hardware, and compatible scales can pass weight through Apple Health.",
      inputs:
        "Manual food search, barcode, foods, meals, recipes, text, photo, voice, Siri, weight, active energy, and Apple Health data.",
      insightStyle:
        "Calories, macros, extended nutrients, energy calibration, trends, charts, and the foods that contribute most to a target.",
      platforms:
        "iPhone, iPad, Mac, and Apple Watch, with iCloud, Apple Health, Siri, and Shortcuts. Current releases need recent Apple operating systems.",
      pricing:
        "Pricing checked August 30, 2026 varies by storefront and account. The US App Store shows individual tiers from $5.99 a month or $39.99 a year and family tiers from $9.99 a month or $69.99 a year, alongside other active storefront price points.",
      primaryJob:
        "Track calories, macros, nutrients, recipes, fasting, and weight on Apple devices.",
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
          "No. Foodnoms is built for Apple devices: iPhone, iPad, Mac, and Apple Watch, with iCloud, Siri, Shortcuts, and Apple Health. There is no Android app and no full web version.",
        question: "Is Foodnoms available on Android?",
      },
      {
        answer:
          "Core calorie and macro logging stays free. Plus adds AI photo and text logging, more nutrients, fasting, recipe import, deeper charts, and related conveniences. Siri and Shortcuts voice tools are documented separately.",
        question: "What does Foodnoms Plus add?",
      },
      {
        answer:
          "For many people, yes. Murph logs meals from a photo or text with calorie and macro estimates, searches about two million food labels plus the USDA catalog, and works on Android too. Foodnoms is still the better pick if you want barcode scanning, Siri, Shortcuts, or a diary that lives in Apple Health, and there is no documented direct connection between the two.",
        question: "Can Murph replace Foodnoms?",
      },
    ],
    headline: "Foodnoms is an Apple-only food diary. Murph logs meals in iMessage or Telegram.",
    lastVerified: "2026-08-31",
    metaDescription:
      "Foodnoms is a privacy-focused food diary for Apple devices. Murph is a personal health assistant that logs meals by photo or text and links them to your sleep, training, and labs.",
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
      "Being Apple-native is a plus for Apple households and a hard stop for Android users. Murph runs in iMessage or Telegram on either platform, but it has no barcode scanner or Siri and Shortcuts logging, and it estimates calories and macros rather than keeping a full nutrient ledger.",
      "AI meal estimates speed up logging, but you still need to check portions and ingredients.",
      "The storefront lists several active prices, so the in-app checkout is the reliable price for your account. Plus buys a better diary, not a wider health conversation.",
    ],
  },
  {
    category: "nutrition",
    chooseCompetitor:
      "Pick MyNetDiary when you want one full log for food, exercise, weight, fasting, and glucose, with strong free features and optional AI analysis.",
    chooseMurph:
      "Choose Murph if you want your food, weight, and medication notes read beside your symptoms, records, and goals in one conversation. Murph logs meals from a photo or text and reads Dexcom glucose, but it does not build a 108-nutrient ledger.",
    competitor: {
      clinicalRole:
        "A wellness tracker and self-management aid. Its GLP-1 Companion logs medication and side effects but does not prescribe or manage treatment.",
      followThrough:
        "Goals, reminders, AutoPilot adjustments, fasting, meal plans, community, AI Coach, and GLP-1 Companion, depending on tier.",
      format:
        "An ad-free food and health diary. The base is free, with Premium and an AI-led Premium Plus layer on top.",
      hardware:
        "No device of its own. Compatible watches, scales, and fitness platforms can add activity, weight, or health data.",
      inputs:
        "Food search, barcode, voice, meal scan, recipes, weight, exercise, water, glucose, medications, fasting, and supported device data.",
      insightStyle:
        "Calories, macros, up to 108 nutrients, diet analysis, charts, forecasts, AI suggestions, and medication support trends.",
      platforms:
        "Web, iOS, Android, Apple Watch, and Wear OS. It supports Apple Health, Health Connect, Fitbit, Garmin, and Withings.",
      pricing:
        "US pricing checked August 30, 2026: Premium is $8.99 a month or $59.99 a year. Premium Plus pricing varies by storefront. An official listing shows a $14.99 purchase without a clearly labeled duration, so check in checkout.",
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
          "Quite a lot. The free app covers core calorie, macro, food, exercise, water, weight, barcode, voice, and community features with no ads. Premium adds meal scanning, diet plans, fasting, more measurements, reports, and wearable connections.",
        question: "How much of MyNetDiary is free?",
      },
      {
        answer:
          "MyNetDiary's Premium Plus AI Coach already talks through your diet history and suggests meals, and the tracker handles most nutrition jobs well. Murph's conversation can start anywhere in your health, pull in your sleep, training, labs, and records, and turn a decision into reminders and errands across topics. There is no direct MyNetDiary connection, and neither AI replaces clinical medication care.",
        question: "Why use Murph if MyNetDiary already has an AI Coach?",
      },
      {
        answer:
          "It logs dose history, reminders, medication adherence, protein, fiber, hydration, symptoms, nutrition targets, and progress. It does not decide eligibility, write prescriptions, or replace the clinician who manages the medication.",
        question: "What does MyNetDiary's GLP-1 Companion do?",
      },
    ],
    headline: "MyNetDiary tracks up to 108 nutrients. Murph ties food to your sleep and labs.",
    lastVerified: "2026-08-31",
    metaDescription:
      "MyNetDiary logs food, weight, glucose, and medication with an AI Coach. Murph is a personal health assistant that logs meals too and explains them beside your sleep, training, and labs.",
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
        murph: "limited",
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
      "The large feature set takes more setup than a minimal food diary. Murph asks for less structured logging and records medications too, but it does not replace MyNetDiary's food, weight, and 108-nutrient ledger.",
      "Premium Plus pricing is not shown consistently enough to quote one durable public price.",
      "Medication logs, reminders, and adherence charts help you stay organized. They are not treatment instructions, and they do not interpret the wider health picture for you.",
    ],
  },
  {
    category: "nutrition",
    chooseCompetitor:
      "Lifesum is the better fit if you want visual meal feedback, recipes, preset eating plans, water and fasting tracking, and activity from your wearable in one daily routine.",
    chooseMurph:
      "Choose Murph if a meal score or a preset plan does not answer your real question. Murph logs meals by photo or text, keeps your symptoms, training, sleep, and records in the same conversation, and helps you revisit what you chose.",
    competitor: {
      clinicalRole:
        "A recreational and educational wellness app. Its plans and ratings are not diagnosis, treatment, or individual medical nutrition therapy.",
      followThrough:
        "Goals, reminders, habits, Life Score, meal ratings, fasting, and recipes. Premium adds guided meal plans.",
      format:
        "A visual mobile lifestyle tracker with food logging, scores, recipes, plans, and habit tools.",
      hardware:
        "No device of its own. Supported wearables and scales can add activity, sleep, or weight data.",
      inputs:
        "Food by search, barcode, photo, voice, or text. Also water, weight, body measures, fasting, habits, exercise, and device data.",
      insightStyle:
        "Calories, macros, detailed nutrients, meal ratings, Life Score, goal trends, and guidance based on your plan.",
      platforms:
        "iOS, iPad, Apple Watch, Android, and Wear OS, with direct support for Apple Health, Health Connect, and Samsung Health. Other services may pass data through those platforms depending on the device.",
      pricing:
        "US pricing checked August 30, 2026 depends on your account and current promotions. A current App Store offer shows $7.49 a month, $14.99 for three months, or $49.99 a year, while higher-price SKUs remain listed.",
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
          "Premium adds AI-assisted entry, custom goals, more nutrient detail, custom foods and exercise, and the full set of meal plans and recipes. Exact features can change by app version and market.",
        question: "What does Lifesum Premium include?",
      },
      {
        answer:
          "Lifesum offers plans such as Mediterranean, keto, weight loss, and other themed approaches. These are consumer programs. They are not a clinician's judgment on whether a diet is safe for your condition.",
        question: "Does Lifesum make a personalized diet plan?",
      },
      {
        answer:
          "It depends on what you use. Murph logs meals from a photo or text with calorie and macro estimates, and it fits better when you do not want a preset plan to frame the problem or when food has to be weighed with the rest of your health. Lifesum stays stronger for meal ratings, recipes, and packaged plans, which Murph does not offer.",
        question: "Can Murph replace Lifesum?",
      },
    ],
    headline: "Lifesum rates each meal. Murph reads food beside your sleep, training, and labs.",
    lastVerified: "2026-08-31",
    metaDescription:
      "Lifesum offers meal ratings, a Life Score, recipes, and preset diet plans. Murph is a personal health assistant that logs meals and weighs them against your sleep, training, and records.",
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
      "Preset diet plans make choices easier, but they cannot account for every medical condition, preference, or life constraint. Murph can talk through those constraints and log your meals, but it has no preset menus and no meal ratings.",
      "Meal scores give quick, readable feedback. They also flatten the detail that explains why a meal does or does not suit one person.",
      "Prices vary enough by promotion and storefront that you should check renewal terms at checkout.",
    ],
  },
  {
    aliases: ["Yazio"],
    category: "nutrition",
    chooseCompetitor:
      "Pick YAZIO when calorie and macro targets, a large food database, fasting timers, recipes, and an app in your own language matter most.",
    chooseMurph:
      "Choose Murph if whether a food or fasting goal is useful or safe depends on your symptoms, training, sleep, or records. Murph logs meals by photo or text, reasons through that picture with you, and helps you keep the plan going. It has no fasting timer.",
    competitor: {
      clinicalRole:
        "A general wellness and nutrition app. It does not provide licensed medical care, diagnosis, or prescription management.",
      followThrough:
        "Goals, reminders, fasting plans, recipe guidance, streaks, and progress analysis. Buddies adds optional social accountability.",
      format:
        "A mobile calorie and fasting app with food logging, recipes, goals, and a paid Pro plan.",
      hardware:
        "No hardware of its own. Phones and compatible health or fitness platforms can add steps and activity.",
      inputs:
        "Food search, barcode, photo AI, meals, water, weight, body metrics, mood, symptoms, fasting, and supported activity data.",
      insightStyle:
        "Calorie and macro progress, weight trends, fasting history, food analysis, and personalized targets on Pro.",
      platforms:
        "iOS, iPad, Apple Watch, and Android, in multiple languages. It supports Apple Health, Health Connect, Fitbit, and Garmin.",
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
          "Yes, in current versions. YAZIO supports manual and barcode entry and adds AI photo recognition. As with any camera estimate, check ingredients and portions before you trust the totals.",
        question: "Can YAZIO log a meal from a photo?",
      },
      {
        answer:
          "YAZIO pairs fasting timers and plans with the same food, water, weight, mood, and progress diary. The fasting guidance is general wellness content. It is not individual medical clearance.",
        question: "How does fasting work in YAZIO?",
      },
      {
        answer:
          "Partly. Murph logs meals from a photo or text with calorie and macro estimates, but it has no fasting timer, recipe catalog, or multilingual food database. Murph earns its place when those tools raise a wider question, or when you want a plan that accounts for your other health data and can be revisited in conversation. No direct YAZIO connection is implied.",
        question: "Can Murph replace YAZIO's food log or fasting timer?",
      },
    ],
    headline: "YAZIO tracks food and fasting. Murph checks the plan against sleep and labs.",
    lastVerified: "2026-08-31",
    metaDescription:
      "YAZIO combines calorie logging, fasting timers, and recipes. Murph is a personal health assistant that logs meals too and checks a fasting or food plan against your sleep and labs.",
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
      "Food, fasting, body metrics, and social features make YAZIO a broad tracker, but it still assumes structured daily logging is the center of the problem. Murph has no built-in fasting timer, multilingual food database, or recipe catalog.",
      "Camera-recognized meals are estimates. They can miss portions, oils, preparation, or ingredients.",
      "YAZIO does not publish one stable Pro list price across regions and offers.",
    ],
  },
  {
    category: "nutrition",
    chooseCompetitor:
      "Pick Lumen when breath readings, metabolic flexibility scores, daily carb guidance, and a device-led routine are what keep you going.",
    chooseMurph:
      "Choose Murph if you want help with food and energy without buying another device, or if a Lumen reading is one clue among several. Murph logs meals, reads your wearable data, and helps you pick and revisit a next step. It does not measure fuel use.",
    competitor: {
      clinicalRole:
        "A wellness device and guidance program, not a diagnostic or prescribing service. Several medical conditions and pregnancy call for professional review before use.",
      followThrough:
        "Daily breath checks, macro guidance, meal logging, fasting prompts, workout recommendations, scores, and weight loss programs.",
      format:
        "A handheld breath device paired with a subscription mobile app and a guided metabolic program.",
      hardware:
        "The Lumen breath device is the center of the paid experience. It measures carbon dioxide in your breath under instructed conditions.",
      inputs:
        "Breath measurements, food logs, weight, sleep, activity, workouts, goals, and data from supported fitness services.",
      insightStyle:
        "Inferred fuel use, metabolic flexibility scores, daily carbohydrate and protein guidance, and program progress.",
      platforms:
        "iOS and Android, with more than 40 advertised connections. These include Apple Health, Google Fit, Garmin, Oura, WHOOP, Strava, MyFitnessPal, and Peloton.",
      pricing:
        "The US shop showed a limited-offer device price of $249, down from $299, with the first twelve months included and renewal at $149 a year. Promotions may change. The company advertises a 30-day return window and possible HSA or FSA eligibility.",
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
          "Lumen measures carbon dioxide in a controlled breath. Its model then infers whether your body is running relatively more on carbohydrate or fat. That output is an inference from breath data, not a direct measurement of every metabolic process.",
        question: "What does the Lumen device actually measure?",
      },
      {
        answer:
          "Partly. For devices bought on or after July 30, 2023, Lumen says basic unlimited measurements stay available after you cancel. You lose detailed history, personalized guidance, scores, and other premium features.",
        question: "Can I use Lumen without renewing the membership?",
      },
      {
        answer:
          "Lumen excludes anyone under 16. It advises talking to a professional if you are pregnant or have diabetes, severe asthma or COPD, kidney disease, cancer, a thyroid condition, or another situation where its general recommendations may not fit.",
        question: "Who should get medical advice before using Lumen?",
      },
    ],
    headline: "Lumen reads your breath. Murph sets that reading beside your sleep and labs.",
    lastVerified: "2026-08-31",
    metaDescription:
      "Lumen measures carbon dioxide in your breath for daily carb guidance. Murph is a personal health assistant that weighs that reading with your sleep, food, and labs but cannot take it.",
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
      "The useful experience depends on buying the device and using it regularly. Murph skips that, but it cannot produce a breath reading, a fuel use score, or Lumen's daily macro guidance.",
      "Fuel use and flexibility scores are modeled readings of breath data. They are not direct measurements of fat loss.",
      "The general macro guidance may not fit pregnancy or several chronic conditions without professional input. A compelling daily score can still deserve less weight than other evidence.",
    ],
    useTogether:
      "Keep Lumen for the breath reading and its device program. Add Murph to talk through the readings you share, compare them with your sleep, food, and labs, and decide whether the routine is worth keeping. There is no claimed direct data connection.",
  },
  {
    aliases: ["January AI"],
    category: "nutrition",
    chooseCompetitor:
      "Pick January when you want photo, barcode, voice, or search meal logging paired with a model that predicts your glucose response.",
    chooseMurph:
      "Choose Murph if you want to start from any health question in iMessage or Telegram, keep your food, sleep, labs, and records in one thread, and turn a decision into a plan. Murph logs meals and reads Dexcom data, and it can discuss a January estimate you share, but it does not make or check the prediction.",
    competitor: {
      clinicalRole:
        "A wellness and metabolic awareness app. Device-free glucose output is a prediction, not a diagnosis, and the app does not replace medical care.",
      followThrough:
        "Meal suggestions, food swaps, adaptive goals, fasting, Jan AI conversation, and feedback shaped by the health data you log.",
      format:
        "An AI-first iPhone app for food capture, predicted glucose response, and metabolic guidance.",
      hardware:
        "No sensor is needed for predicted glucose. A compatible CGM you already own can supply actual readings through supported connection paths.",
      inputs:
        "Meal photos, barcodes, voice, search, calories, macros, activity, sleep, labs, medications, health records, Apple Health, Oura, WHOOP, and supported CGM data.",
      insightStyle:
        "Predicted post-meal glucose, food comparisons, macro summaries, swaps, goals, and AI answers based on the inputs available.",
      platforms:
        "The current consumer listing is iPhone-first, with some compatibility across Apple devices. A native Android consumer app was not verified on August 30, 2026.",
      pricing:
        "US pricing checked August 30, 2026: limited free use, then Premium at $9.99 a month or $59.99 a year with a seven-day trial. Older or discounted $4.99 and $39.99 SKUs also appear in the official storefront.",
      primaryJob:
        "Make food logging fast and estimate how meals may affect your glucose.",
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
          "No. January's device-free feature predicts a likely response from its model and what it knows about you and the meal. Only a glucose meter or CGM gives an actual glucose measurement.",
        question: "Does January measure glucose without a CGM?",
      },
      {
        answer:
          "January already has Jan AI, adaptive goals, and answers built on its metabolic, lab, medication, and activity inputs, and its edge is the barcode scanner and its own prediction model. Murph adds a messaging thread that covers your wider health and practical tasks, carrying your food, sleep, labs, and records across topics. There is no direct integration, and Murph does not turn a prediction into a measurement.",
        question: "What does Murph add if I already use January?",
      },
      {
        answer:
          "Yes, in some cases. January documents a direct Libre connection for US users. Other CGMs may send readings through Apple Health when their own app supports it, and availability and delay depend on that path.",
        question: "Can January use readings from my CGM?",
      },
    ],
    headline: "January predicts your glucose response. Murph handles the rest of your health.",
    integration: "dexcom",
    lastVerified: "2026-08-31",
    metaDescription:
      "January scans a meal and predicts your glucose response. Murph is a personal health assistant that logs meals, reads Dexcom data, and covers the questions beyond the prediction.",
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
      "A predicted glucose value is a hypothesis, not a sensor reading or a medical result. Murph can help you judge the estimate and reads actual Dexcom data, but it has no barcode scanner and no glucose prediction model.",
      "The verified consumer experience is Apple-centered right now, with no confirmed native Android app.",
      "Food recognition and model outputs carry uncertainty from portions, ingredients, records, and the model itself. A precise-looking prediction may still deserve a small response, or none.",
    ],
    useTogether:
      "Let January handle meal capture, glucose predictions, and its in-app metabolic coaching. Murph takes the wider health threads and the follow-up around an estimate you choose to share. This is a side-by-side workflow, not a claimed direct integration.",
  },
  {
    category: "nutrition",
    chooseCompetitor:
      "Pick Signos when continuous glucose data, meal and habit scores, dietitian support, or its clinician-led Signos+ medication program are the goal.",
    chooseMurph:
      "Choose Murph if you want help without joining a CGM program, or if glucose is one clue beside your symptoms, sleep, training, records, and budget. Murph logs meals, reads Dexcom data, and records medications, while clinical decisions stay with your clinicians.",
    competitor: {
      clinicalRole:
        "The Signos CGM membership and Essentials use the FDA-cleared, over-the-counter Signos Glucose Monitoring System for eligible adults. Signos+ separately arranges evaluation and prescribing through independent networks of licensed clinicians.",
      followThrough:
        "Prompts, scores, goals, meal and habit feedback, dietitian support, medication tracking, and clinician follow-up, depending on plan.",
      format:
        "A mobile CGM program with AI guidance, plus separate GLP-1 support and prescription offerings.",
      hardware:
        "CGM sensors are central to the program. Essentials uses over-the-counter Stelo sensors. Hardware and fulfillment for other plans depend on the offering.",
      inputs:
        "Continuous glucose, meals, weight, activity, sleep, habits, medication doses, body scans, and data from supported health platforms or scales.",
      insightStyle:
        "Glucose trends, meal response, daily and weekly scores, habit prompts, and treatment progress on clinical plans.",
      platforms:
        "Compatible iOS and Android phones, with Apple Health, Google Health Connect, supported watches, and smart scales.",
      pricing:
        "US pricing checked August 30, 2026: the standard membership is advertised at $127 a month with hardware. Essentials is $89 a month for six months, medication extra. Signos+ starts at $199 a month for three or six months and includes eligible compounded medication and CGMs.",
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
          "Essentials is for adults already taking a GLP-1 medication. It includes the app and a series of over-the-counter Stelo sensors, but not the medication, and the sensor needs no new prescription. It focuses on food, activity, dose, symptoms, and body changes.",
        question: "What is Signos Essentials?",
      },
      {
        answer:
          "Signos+ can. It is a separate clinician-guided program that may include compounded semaglutide or tirzepatide after an eligibility review, along with supplies, app access, and CGMs. Compounded drugs are not FDA-approved equivalents of the branded products.",
        question: "Does Signos prescribe GLP-1 medication?",
      },
      {
        answer:
          "No. The over-the-counter Stelo sensor used in some plans is not meant for people who use insulin, are on dialysis, or have problematic hypoglycemia. A clinician should guide medical decisions and any medication change.",
        question: "Can anyone use the Signos CGM program?",
      },
    ],
    headline: "Signos pairs a CGM with coaching. Murph handles the health questions around it.",
    integration: "dexcom",
    lastVerified: "2026-08-31",
    metaDescription:
      "Signos pairs a CGM with scores, dietitians, and a medication program. Murph is a personal health assistant that reads glucose beside your sleep, food, and labs, and does not prescribe.",
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
      "CGM feedback makes meal responses visible. It also adds cost and sensor wear, and it can make short-term glucose swings look more important than they are. Murph skips the sensor commitment, but it cannot generate continuous readings, meal scores, or prescriptions.",
      "The standard, Essentials, and Signos+ plans differ a lot in hardware, clinical role, commitment, and whether medication is included.",
      "Compounded medication calls for clear disclosures about eligibility, safety, quality, and FDA status.",
    ],
    useTogether:
      "Keep Signos for the sensor data, its program, and any clinician-led medication care. Bring Murph the findings you want to look at beside your other health data, and use it for the day-to-day work of the plan. No direct integration is implied, and medication or CGM decisions stay with the clinician and the Signos program.",
  },
  {
    category: "nutrition",
    chooseCompetitor:
      "Levels is the better fit if you want meals, glucose, wearables, labs, habits, and metabolic programs organized in one structured app.",
    chooseMurph:
      "Choose Murph if you want an ongoing messaging thread for questions and tasks outside a metabolic program, with your history remembered and no extra dashboard. Murph logs meals and reads Dexcom data, but it does not recreate Levels' scores, programs, sensors, labs, or expert review.",
    competitor: {
      clinicalRole:
        "A metabolic wellness platform with optional labs and limited clinician review. It is not diabetes treatment or continuous clinical care.",
      followThrough:
        "Goals, habits, adaptive programs, AI insights, scores, and experiments. Higher packages add optional clinician or nutritionist touchpoints.",
      format:
        "A mobile and web metabolic health dashboard with optional sensor, lab, and professional service add-ons.",
      hardware:
        "The base membership needs no sensor. Members can bring a compatible sensor or buy optional Stelo shipments.",
      inputs:
        "Food photos, text, barcodes, macros, CGM data, sleep, exercise, wearables, labs, documents, habits, and goals.",
      insightStyle:
        "Meal and glucose response, metabolic scores, trends, AI summaries, labs read alongside the other data, and program feedback.",
      platforms:
        "iOS, Android, and a web dashboard. It connects to health and wearable data and supports bringing your own sensor.",
      pricing:
        "US pricing checked August 30, 2026: Build Your System is $80 a year, with optional Stelo at $89 per two-sensor shipment. Core is $499 a year and Complete is $1,999 a year. Sensor, lab, and review inclusions differ.",
      primaryJob:
        "Combine food, glucose, activity, sleep, and labs into one metabolic health feedback system.",
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
          "No. The base membership covers food, habits, programs, records, and other available data without a CGM. You can add Stelo or bring a compatible sensor for continuous glucose.",
        question: "Do I need a CGM to use Levels?",
      },
      {
        answer:
          "Levels already gives you AI insights, adaptive programs, habit loops, and optional clinician or nutritionist support around its metabolic data. Murph's job is different: it takes the questions beyond the metabolic program into an ongoing messaging thread, keeps the relevant history, and remembers what you decided so it can follow up. There is no claimed direct integration.",
        question: "What does Murph add to Levels?",
      },
      {
        answer:
          "No. Levels organizes glucose and lifestyle data, and some packages include a clinician review. It does not replace diagnosis, diabetes treatment, urgent care, or ongoing management by your care team.",
        question: "Is Levels a diabetes care service?",
      },
    ],
    headline: "Levels tracks glucose, meals, and labs. Murph covers the rest of your health.",
    integration: "dexcom",
    lastVerified: "2026-08-31",
    metaDescription:
      "Levels puts glucose, meals, wearables, and labs in one metabolic dashboard. Murph is a personal health assistant for the questions beyond the program, and it remembers what you decide.",
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
      "Membership paths, sensor shipments, labs, and clinician reviews come with different inclusions and costs. Murph bundles no sensor, lab panel, metabolic dashboard, or clinician review.",
      "Glucose is one useful measure. A short-term response alone does not tell you whether a food is healthy for you or whether changing it will improve your life.",
      "A clinician review included in a package is not the same as ongoing medical care.",
    ],
    useTogether:
      "Let Levels run its dashboard, programs, measurements, and any expert review. Murph handles the wider health threads and the agreed action around a finding you choose to share. No direct product connection is implied.",
  },
  {
    category: "nutrition",
    chooseCompetitor:
      "ZOE is the better fit if food quality scores, plant diversity, processing risk, personalized meal guidance, and optional microbiome testing answer the question you have.",
    chooseMurph:
      "Choose Murph if you do not want one food model to define the problem, or if a ZOE recommendation needs to be weighed against your symptoms, records, goals, budget, and daily life before you act. Murph logs meals too, but it has no food scores.",
    competitor: {
      clinicalRole:
        "A consumer nutrition and wellness program. It does not diagnose, prevent, or treat disease, and anyone with an underlying condition should get clinician guidance.",
      followThrough:
        "Meal scores, goals, plant and fiber targets, streaks, learning content, and Ziggie or AskZiggie AI. Paid plans add personalized suggestions.",
      format:
        "A mobile personalized nutrition app with a free US tier, paid guidance, and microbiome testing that depends on your market.",
      hardware:
        "ZOE 2.0 needs no ongoing wearable or sensor. Optional stool test kits are sold in supported markets.",
      inputs:
        "Meal photos, barcodes, products, calories, macros, fiber, plants, questionnaire answers, goals, and optional stool samples.",
      insightStyle:
        "Meal and product scores, plant diversity, processing risk, predicted glucose and fat responses, and microbiome guidance where you have tested.",
      platforms:
        "iOS and Android. Membership features, testing, and pricing differ between the United States and the United Kingdom, and no current wearable integration was verified.",
      pricing:
        "Pricing checked August 30, 2026: the US app is free, and ZOE Plus is $15.99 a month or $99.99 a year. UK app-only membership starts at £9.99 a month, billed as £119.88 a year, with an optional £149 stool test for members.",
      primaryJob:
        "Score meals and guide food choices using quality, plant diversity, and personalized response models.",
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
          "No. ZOE 2.0 dropped the original standardized cookies, blood fat test, and CGM test. It now predicts glucose and fat responses from questionnaire data and its models, with optional newer stool testing in supported markets.",
        question: "Does ZOE still require a glucose sensor?",
      },
      {
        answer:
          "Not the scores. ZOE gives you food quality scores, predicted responses, optional testing, and AI guidance, and Murph reproduces none of them. Murph logs meals and takes health questions beyond a nutrition model, in a conversation that remembers your history across topics, and there is no direct connection between the two.",
        question: "Can Murph replace ZOE?",
      },
      {
        answer:
          "No. ZOE offers nutrition education and personalization, and it says it is not intended to diagnose, prevent, or treat disease. If you have an underlying condition, use qualified medical advice for treatment decisions.",
        question: "Is ZOE medical nutrition therapy?",
      },
    ],
    headline: "ZOE scores each meal. Murph weighs the score against your sleep, labs, and life.",
    lastVerified: "2026-08-31",
    metaDescription:
      "ZOE scores meals and offers optional microbiome testing. Murph is a personal health assistant that weighs those results against your sleep, labs, and records, and it does not score meals.",
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
      "Predicted glucose and fat responses are model outputs, not direct measurements taken now. Murph can question how much a result matters, but it has no testing, response predictions, or meal scoring model of its own.",
      "The experience, testing, availability, and price differ a lot by country. ZOE's current FAQ says its next-generation testing has not launched in the United States, while another FAQ section still carries older New York-specific language.",
      "Meal scores make a complex model easy to use. They are not a diagnosis, a universal verdict, or a reason to ignore how a meal fits your life.",
    ],
  },
  {
    category: "nutrition",
    chooseCompetitor:
      "Nourish is the better fit if you need an assessment and medical nutrition therapy from a registered dietitian, especially when insurance may cover the visits.",
    chooseMurph:
      "Choose Murph if you do not need medical nutrition therapy, or add it between visits to sort out your questions, understand what you were told, log meals, and keep the plan moving. The dietitian's clinical role does not change.",
    competitor: {
      clinicalRole:
        "Licensed registered dietitians provide medical nutrition therapy. Nourish's wider coordinated care model may also include labs, virtual medical care, and GLP-1 prescribing or medication management by qualified medical clinicians for eligible patients.",
      followThrough:
        "Recurring dietitian visits, messaging between visits, goals, meal logs, recipes, AI assistance, labs, and progress review.",
      format:
        "A US telehealth nutrition practice with patient apps and a web portal.",
      hardware:
        "No hardware of its own. The iOS app can use supported Apple Health data.",
      inputs:
        "Clinical history, goals, symptoms, meal photos and macros, messages, labs, progress, and what you share during video visits.",
      insightStyle:
        "An individual assessment and recommendations from a registered dietitian, backed by app tracking and AI convenience tools.",
      platforms:
        "Virtual care in all 50 US states through video, web, iOS, and Android. Provider availability and insurance participation vary.",
      pricing:
        "US pricing checked August 30, 2026: Nourish says 94% of patients pay $0 out of pocket. Your copay, deductible, coverage, and visit limits need a benefits check, and a clear universal self-pay price was not verified.",
      primaryJob:
        "Provide ongoing one-to-one nutrition care from a licensed registered dietitian.",
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
          "Yes. Nourish describes its care team as registered dietitians who provide individual nutrition care through virtual visits. That is licensed nutrition care, not only automated app coaching.",
        question: "Are Nourish coaches registered dietitians?",
      },
      {
        answer:
          "Often, but not always. Nourish says most covered patients pay nothing, but the real amount depends on your insurer, plan, deductible, referral rules, visit limits, and provider eligibility. A benefits estimate is not a payment guarantee.",
        question: "Will insurance make Nourish free?",
      },
      {
        answer:
          "Not through the dietitian, who does not prescribe. Nourish says its coordinated care services may include GLP-1 evaluation, prescribing, and medication management by qualified medical clinicians for eligible patients, depending on need and coverage.",
        question: "Can Nourish manage my GLP-1 prescription?",
      },
    ],
    headline: "Nourish gives you a registered dietitian. Murph helps between the visits.",
    lastVerified: "2026-08-31",
    metaDescription:
      "Nourish offers dietitian visits that insurance often covers. Murph is a personal health assistant that helps you prepare questions and keep the plan going between visits.",
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
      "The value depends heavily on how well you match with your dietitian, on appointment availability, and on continuity across visits.",
      "Insurance marketing cannot tell you your final copay, deductible, or how many visits are allowed.",
      "The app supports the care relationship, but its AI assistant is not the licensed clinician and should not blur who owns assessment and treatment. Murph is not a registered dietitian either. It cannot provide individual medical nutrition therapy or an insurance-billed visit.",
    ],
    useTogether:
      "Let the registered dietitian own the assessment and medical nutrition therapy. Add Murph to prepare questions, connect the care plan to your other health threads, and support the agreed steps between visits. Murph should not override the care plan, and medication decisions stay with the prescribing clinician.",
  },
  {
    category: "nutrition",
    chooseCompetitor:
      "Pick Fay when you want to find and work with a specific RD or RDN, with insurance billing and direct chat between visits.",
    chooseMurph:
      "Choose Murph for support that is not clinical care, or add it when your questions, other health data, and practical next steps need attention between appointments. Murph does not overrule the dietitian.",
    competitor: {
      clinicalRole:
        "Fay connects patients with board-certified RDs and RDNs who provide medical nutrition therapy within their licensure and specialty.",
      followThrough:
        "Scheduled visits, direct chat with your dietitian, daily goals, meal photos, symptom or win tracking, tasks, progress, and rewards.",
      format:
        "A US dietitian marketplace, insurer billing service, and patient app for virtual or in-person nutrition care.",
      hardware:
        "No hardware of its own. A Withings partnership supports discovery and related connected health workflows.",
      inputs:
        "Health history, insurance, goals, meal photos, symptoms, progress, messages, and what you share with your chosen dietitian.",
      insightStyle:
        "Individual clinical guidance from the dietitian you choose, supported by daily logs and messaging.",
      platforms:
        "iOS, Android, and web booking for virtual or in-person care in all 50 US states. Each provider's licensing and location still matter.",
      pricing:
        "US pricing checked August 30, 2026: Fay advertises visits as low as $0, says most patients pay $0 to $12, and says 95% pay under $15. Uncovered care is about $150 a session, and the final cost depends on your benefits.",
      primaryJob:
        "Help a patient find, book, and keep seeing a registered dietitian.",
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
          "You filter dietitians by specialty, approach, availability, insurance, and virtual or in-person format. The ongoing relationship is with the RD or RDN you pick, not an interchangeable automated coach.",
        question: "How does Fay match you with a dietitian?",
      },
      {
        answer:
          "Fay's estimates are based on your insurance and can be very low. Deductibles, eligibility, location, age, plan rules, and claim processing can change the final bill. Uncovered sessions are advertised at about $150.",
        question: "How much does a Fay nutrition visit cost?",
      },
      {
        answer:
          "Generally no. A Fay dietitian can provide medical nutrition therapy and work with you on eating needs related to a medication. Dietitians do not usually replace the clinician who prescribes, doses, or monitors a weight loss drug.",
        question: "Can a Fay dietitian prescribe weight loss medication?",
      },
    ],
    headline: "Fay finds you a dietitian and bills insurance. Murph helps between visits.",
    lastVerified: "2026-08-31",
    metaDescription:
      "Fay matches you with a registered dietitian and handles the insurance billing. Murph is a personal health assistant for the questions and follow-up between appointments, not clinical care.",
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
      "The quality and fit of care depend on the individual dietitian, their specialty, their schedule, and how well you work together.",
      "Insurance estimates can change after claims are processed. They do not guarantee what you will owe.",
      "Nutrition care and prescribing are separate professional scopes, and adding an AI assistant does not hand either scope to the assistant. Murph cannot match you with an RD, book or bill a visit, or provide medical nutrition therapy.",
    ],
    useTogether:
      "Let your Fay dietitian own your individual nutrition care. Add Murph when a question crosses into other parts of your health, or when a practical step needs support between appointments. Murph should not override the dietitian's plan.",
  },
  {
    category: "nutrition",
    chooseCompetitor:
      "Pick Nutrisense when glucose sensors, meal response analysis, Nora AI, and access to an RD or CNS are the experience you want.",
    chooseMurph:
      "Choose Murph if you want to reason about your health and act on it without making continuous glucose the center of everything. Murph logs meals and reads Dexcom data, and it can weigh a Nutrisense result beside your other evidence and the daily cost of wearing a sensor.",
    competitor: {
      clinicalRole:
        "A metabolic wellness program with optional RD or CNS coaching. The app and over-the-counter sensors do not replace diagnosis, treatment, or a prescribing clinician.",
      followThrough:
        "Nora AI, meal scores, habits, courses, webinars, goals, and messaging. Video coaching eligibility depends on plan and insurance.",
      format:
        "A mobile CGM analysis and coaching program. You can bring your own sensor or buy a plan that includes sensors.",
      hardware:
        "Continuous glucose sensors are central. Supported options include Stelo, Dexcom, Libre, and Lingo, each with platform-specific limits.",
      inputs:
        "CGM readings, meals, sleep, activity, mood, habits, goals, and data from Apple Health, Fitbit, Garmin, Oura, Google Fit, and MyFitnessPal.",
      insightStyle:
        "Glucose trends, meal scores, response patterns, AI explanations, and experiments. Plans that include coaching add feedback from a nutrition professional.",
      platforms:
        "iOS and Android. Sensor and connector support varies, and Lingo support is documented for iOS rather than Android.",
      pricing:
        "US pricing checked August 30, 2026: bring-your-own-sensor access is $39 a month or $199 a year after a three-day trial. Sensor plans currently show conflicting promotions around $152 a month for six months, $178 to $179 for three months, and $212 to $215 for one month.",
      primaryJob:
        "Use continuous glucose data, AI, and optional nutrition coaching to explore your metabolic responses.",
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
          "Yes. The bring-your-own-sensor plan gives you the app's analysis and guidance for supported CGMs at a lower software price. Compatibility depends on the sensor, phone, country, and connection method.",
        question: "Can I use Nutrisense with my own CGM?",
      },
      {
        answer:
          "It offers access to RD or CNS coaching, and qualifying insurance can lower the coaching cost. Sensor hardware and the app program may still be paid out of pocket, so check coverage for each part separately.",
        question: "Does Nutrisense include a registered dietitian?",
      },
      {
        answer:
          "The program is generally for adults 18 and older. Stelo and similar over-the-counter routes are not meant for insulin users, people on dialysis, or anyone with problematic hypoglycemia. Medication changes belong with your clinician.",
        question: "Who should not use Nutrisense without medical guidance?",
      },
    ],
    headline: "Nutrisense runs the CGM experiment. Murph weighs the result with sleep and labs.",
    integration: "dexcom",
    lastVerified: "2026-08-31",
    metaDescription:
      "Nutrisense pairs CGM analysis with Nora AI and dietitian coaching. Murph is a personal health assistant that weighs a glucose result beside your sleep, food, and labs.",
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
      "Sensor programs make glucose patterns visible. They also add device cost, skin wear, and attention to short-term swings that may not change any useful decision. Murph supplies no CGM, no sensor analysis dashboard, and no access to an RD or CNS.",
      "The official plan page shows conflicting promotional prices, so get a dated quote at checkout.",
      "Nutrition coaching, app access, and sensor hardware can each be treated differently by insurance and for out-of-pocket cost.",
    ],
    useTogether:
      "Let Nutrisense own the sensor experiment and any professional coaching. Add Murph to talk through the results you share beside your sleep, food, and labs, and to support the plan that follows. No direct data connection is claimed.",
  },
  {
    category: "nutrition",
    chooseCompetitor:
      "Pick Carb Manager when net carbs, keto macros, fasting, low-carb recipes, meal planning, and metabolic self-tracking are the daily job.",
    chooseMurph:
      "Choose Murph if you want to weigh low-carb eating against your symptoms, training, sleep, labs, and daily life before you commit to its rules. Murph logs meals and can run a bounded trial with you, but it does not keep a net carb ledger.",
    competitor: {
      clinicalRole:
        "A wellness and nutrition tracker. Its glucose, ketone, insulin, and blood pressure fields are self-management records, not medical treatment.",
      followThrough:
        "Goals, reminders, fasting, meal planning, shopping lists, recipes, community, and macro cycling. Premium adds Smart Macros.",
      format:
        "A keto and low-carb food diary. Tracking is free, and Premium adds a planning layer.",
      hardware:
        "No hardware of its own. Supported meters, wearables, and health platforms can add selected data.",
      inputs:
        "Food search, barcode, photo, voice, recipes, weight, exercise, fasting, glucose, ketones, insulin, sleep, and body measurements.",
      insightStyle:
        "Net and total carbs, calories, macros, nutrients, fasting history, metabolic logs, trends, and low-carb meal guidance.",
      platforms:
        "iOS, iPad, Apple Watch, Android, and web. Connections include Apple Health, Health Connect, Garmin, Fitbit, Keto-Mojo, and others.",
      pricing:
        "US pricing checked August 30, 2026: Premium is advertised at $39.99 a year, which works out to $3.33 a month when billed annually. Monthly and quarterly options exist, but their current public amounts were not verified.",
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
          "No. It is built around net carbs and low-carb targets, but it also tracks calories, macros, nutrients, recipes, exercise, weight, and other health logs. Premium adds the deeper planning and analysis tools.",
        question: "Is Carb Manager only for strict keto?",
      },
      {
        answer:
          "Not as treatment. The app records glucose, ketones, insulin, blood pressure, and related measurements, and it connects with some meters. Those logs do not give a diagnosis, medication dosing, or individual diabetes treatment.",
        question: "Can Carb Manager manage diabetes?",
      },
      {
        answer:
          "Not for net carb tracking, which Carb Manager is built for along with keto macros, fasting, recipes, and metabolic logs. Murph fits before or around that work: it logs meals, helps you judge whether low-carb eating suits your wider health, and revisits the decision with you. No direct connection is implied.",
        question: "Can Murph replace Carb Manager?",
      },
    ],
    headline: "Carb Manager counts net carbs. Murph checks whether low carb is helping you.",
    lastVerified: "2026-08-31",
    metaDescription:
      "Carb Manager tracks net carbs, keto macros, fasting, and low-carb recipes. Murph is a personal health assistant that logs meals and checks the plan against your sleep, labs, and symptoms.",
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
      "A low-carb-first design is efficient once you have chosen the approach. It is not a neutral place to decide whether low carb is right for you. Murph can test that premise, but it does not supply a net carb ledger, fasting timer, or low-carb recipe plan.",
      "The metabolic and blood pressure fields organize what you observe. They do not settle treatment decisions.",
      "The clearly published value price requires annual billing.",
    ],
  },
  {
    category: "nutrition",
    chooseCompetitor:
      "Pick Cal AI when the fastest possible photo, barcode, or text meal entry matters more than detailed manual logging or human coaching.",
    chooseMurph:
      "Choose Murph if you want a photo or text meal log that also answers questions. Murph estimates calories and macros, then weighs food beside your symptoms, goals, records, and daily life, and carries a realistic next step forward.",
    competitor: {
      clinicalRole:
        "A consumer app for wellness estimates. It offers no professional nutrition services, medical advice, diagnosis, or treatment.",
      followThrough:
        "Personal targets, progress views, recipes, custom foods, activity data, and repeated AI-assisted meal logging.",
      format:
        "A subscription mobile app built around estimating calories and macros from meal photos.",
      hardware:
        "No hardware of its own. A phone camera and supported health platform data are the main inputs.",
      inputs:
        "Meal photos, barcodes, text descriptions, recipes, custom foods, weight goals, steps, exercise, Apple Health, and Google health data.",
      insightStyle:
        "Estimated calories and macros, progress toward daily targets, meal history, and goal summaries.",
      platforms:
        "iOS, Apple Watch, and Android. Official materials reference Apple Health and Google Fit.",
      pricing:
        "US pricing checked August 30, 2026 is not clearly labeled by term. Apple lists Unlimited purchases from $2.99 to $29.99 and says some purchases may support Family Sharing. Check the price, duration, and renewal in checkout after the three-day trial.",
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
          "No. Cal AI estimates likely foods, portions, calories, and macros from the image and other information. Its own FAQ puts scan accuracy at about 80%, so check and correct the result.",
        question: "Are Cal AI photo estimates exact?",
      },
      {
        answer:
          "For many people, yes. Murph also logs a meal from a photo or text with calorie and macro estimates, and it then connects eating with your sleep, training, labs, and records and helps you decide what is worth doing. Cal AI stays the leaner tool if all you want is repeated photo and barcode scans, and no direct connection between the two is implied.",
        question: "Can Murph replace Cal AI?",
      },
      {
        answer:
          "The official service uses calai.app. Its terms name Cal AI, Inc. as the operator, while Apple lists Viral Development LLC as the App Store seller. Apps with similar names can have different features, prices, and privacy terms.",
        question: "How do I identify the official Cal AI app?",
      },
    ],
    headline: "Cal AI logs meals from a photo. Murph does too, and reads your sleep and labs.",
    lastVerified: "2026-08-31",
    metaDescription:
      "Cal AI turns meal photos into fast calorie and macro estimates. Murph is a personal health assistant that logs meals from a photo too, then reads them beside your sleep, training, and labs.",
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
      "Fast photo logging is convenient, but it trades precision for speed and still needs a check of ingredients and portions. Murph's photo estimates need the same check, and Murph has no barcode scanner.",
      "The official storefront does not label its many purchase amounts clearly enough to publish one reliable monthly or annual price.",
      "The app gives automated wellness estimates. It offers no human dietitian coaching or medical care.",
    ],
  },
  {
    aliases: ["Ate Food Journal"],
    category: "nutrition",
    chooseCompetitor:
      "AteMate is the better fit if quick photo journaling of meals and daily wellbeing, plus an AI coach that works from that record, are the habit tools you want.",
    chooseMurph:
      "Choose Murph if you want to start with a health question or task rather than keep a journal. Murph logs meals by photo or text, pulls in your connected data and records, and turns the answer into a plan it remembers.",
    competitor: {
      clinicalRole:
        "A personal health journal for awareness. Its AI coach is not a clinician, dietitian, diagnosis service, or disease treatment.",
      followThrough:
        "AI prompts, pattern summaries, reminders, mindful questions, goals, and optional sharing with a human coach.",
      format:
        "A visual health journal with meal photos, wellbeing entries, and an AI coach. Calorie and macro tracking are optional.",
      hardware:
        "No hardware of its own. Phones and watches handle capture, and health platform connections can add activity or related data.",
      inputs:
        "Meal photos, hunger, mood, reasons for eating, hydration, movement, sleep, weight, blood pressure, glucose, and optional calories or macros.",
      insightStyle:
        "Patterns across the five pillars, weekly reviews, AI conversation grounded in your journal history, and entries a coach can read.",
      platforms:
        "iPhone, iPad, Apple Watch, and Android. Health platform support includes Health Connect and Apple ecosystem data.",
      pricing:
        "US pricing checked August 30, 2026: the base journal lists $9.99 a month, $19.99 a quarter, or $49.99 a year. AteMate Coach is a separate $19.99 a month tier, and Coach Plus is another tier whose public US price was not verified.",
      primaryJob:
        "Capture daily patterns across food and wellbeing through a photo-led journal and AI coach, without required calorie counting.",
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
          "No. AteMate is designed to work as a photo and context journal without calorie targets. If you want numbers, you can turn on calories and macros, but the main photo journal does not need them.",
        question: "Do I have to count calories in AteMate?",
      },
      {
        answer:
          "No. AteMate's AI coach is automated: it responds to your journal and points out patterns. You can also share data with a separate human coach, but the app's AI is not a registered dietitian or clinician.",
        question: "Is AteMate's AI coach a human dietitian?",
      },
      {
        answer:
          "AteMate already has an AI coach that reads your journal history across food, mood, hydration, movement, and sleep, and its strength is the dedicated, low-effort journal. Murph starts from any health question or task, draws on your connected data and records beyond journal entries, and carries decisions into reminders and errands. Neither product turns automated feedback into clinical care.",
        question: "How is Murph different from AteMate?",
      },
    ],
    headline: "AteMate is a photo journal with an AI coach. Murph starts from your question.",
    lastVerified: "2026-08-31",
    metaDescription:
      "AteMate is a photo journal for food, mood, movement, and sleep with an AI coach. Murph is a personal health assistant that logs meals and reads them beside your wearable data and records.",
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
      "A photo-led journal takes the pressure off counting, but its value still depends on enough entries for the AI coach to spot a pattern. Murph asks for less ongoing capture, but it has no dedicated photo timeline or five-pillar journal review.",
      "AI pattern feedback is automated guidance. It is not individual clinical nutrition care.",
      "Official storefronts still list legacy subscription SKUs, so confirm the checkout terms for your account.",
    ],
  },
]);
