import { defineComparisons } from "../types";

export const HEALTH_ASSISTANT_COMPARISONS = defineComparisons([
  {
    aliases: ["BodyBuddy: Better Health", "BodyBuddy HQ"],
    bestFor:
      "Adults who want an AI accountability coach to check in by text and turn an existing health goal or professional plan into daily actions.",
    bottomLine:
      "BodyBuddy is a proactive, text-first accountability product for logging habits and carrying plans into daily life. Murph is an ongoing health conversation with a wider remit across questions, personal context, planning, and follow-through.",
    category: "health-assistants",
    chooseCompetitor:
      "Choose BodyBuddy when daily text check-ins, habit logging, motivational accountability, and gamified progress around a defined plan are the central needs.",
    chooseMurph:
      "Choose Murph when you want an ongoing private health conversation that can move between questions, records, wearable context, decisions, experiments, reminders, and practical next steps.",
    competitor: {
      clinicalRole:
        "A consumer wellness and accountability coach. BodyBuddy says it does not provide medical advice, diagnose conditions, or independently validate instructions from a health professional.",
      followThrough:
        "Daily text check-ins, persistent plans, action tracking, reminders, progress views, points, badges, leaderboards, and optional plan sharing.",
      format:
        "An AI accountability coach built around proactive text messages, with app and web access for plans, logs, documents, and progress.",
      hardware:
        "No proprietary hardware is required. An iPhone and Apple Health can contribute activity, sleep, body weight, and related data.",
      inputs:
        "Text, photos, voice, meals, movement, sleep, hydration, appointment audio, uploaded care or training documents, and authorized Apple Health data.",
      insightStyle:
        "Turns stated goals and imported instructions into action items, then responds to daily logs with encouragement, summaries, and accountability prompts.",
      platforms:
        "iPhone and iMessage with iOS 15.1 or later, plus web access described in BodyBuddy's terms. The service is for adults age 18 and older.",
      pricing:
        "The App Store description says subscriptions start at $29 per month with a seven-day trial. Its in-app purchase list contains several monthly and annual promotional price points, so the live checkout offer controls.",
      primaryJob:
        "Help an adult follow an existing health or wellness plan through proactive messages, easy logging, and daily accountability.",
    },
    competitorEvidence: {
      clinicalRole: [3],
      followThrough: [1],
      format: [1, 3],
      hardware: [1],
      inputs: [1, 2],
      insightStyle: [1],
      platforms: [2, 3],
      pricing: [2],
      primaryJob: [1],
    },
    faqs: [
      {
        answer:
          "The relevant product is BodyBuddy: Better Health from BodyBuddy HQ, with Please Clap LLC still shown as the App Store seller. It is not the similarly named EMS controller, pregnancy course business, or unrelated Apple Health utility.",
        question: "Which BodyBuddy does this comparison cover?",
      },
      {
        answer:
          "BodyBuddy can record an appointment, create a transcript or summary, and turn uploaded instructions into action items. It warns that generated material can contain errors and that the original professional instructions remain authoritative. The user is also responsible for recording consent.",
        question: "Can BodyBuddy summarize a medical appointment?",
      },
      {
        answer:
          "BodyBuddy documents Apple Health access for steps, workouts, weight, sleep, active energy, and dietary calories. Its listing says data from Fitbit, Garmin, Oura, and WHOOP can reach BodyBuddy through Apple Health, which is different from a documented native connection to each service.",
        question: "What health data can BodyBuddy use?",
      },
    ],
    headline: "Murph vs BodyBuddy for AI health accountability",
    lastVerified: "2026-08-30",
    metaDescription:
      "Compare Murph and BodyBuddy on proactive health texts, daily accountability, plan tracking, appointment summaries, Apple Health data, and pricing.",
    name: "BodyBuddy",
    overview:
      "BodyBuddy: Better Health is the AI accountability product operated by BodyBuddy HQ. It checks in proactively by text, accepts quick logs in several formats, and can convert a clinician or trainer document into a plan that is easier to follow day by day. Murph also supports ongoing follow-through, but its product shape is a broader health conversation rather than a dedicated habit game and text accountability loop.",
    relationship: "alternative",
    slug: "bodybuddy",
    sources: [
      {
        label: "BodyBuddy product overview",
        url: "https://bodybuddy.app/",
      },
      {
        label: "BodyBuddy App Store listing",
        url: "https://apps.apple.com/us/app/bodybuddy-better-health/id6756154234",
      },
      {
        label: "BodyBuddy terms",
        url: "https://bodybuddy.app/terms",
      },
      {
        label: "BodyBuddy privacy policy",
        url: "https://bodybuddy.app/privacy",
      },
    ],
    tradeoffs: [
      "BodyBuddy's proactive text format can reduce logging friction, but its accountability focus is narrower than a general health assistant.",
      "Appointment transcripts, imported-plan summaries, and other AI output can be inaccurate and need comparison with the original source.",
      "Several advertised device connections depend on data first reaching Apple Health rather than a direct BodyBuddy integration.",
    ],
  },
  {
    aliases: ["Ada - your health portal", "Ada Health"],
    bestFor:
      "People with a current symptom who want a structured assessment of possible causes and guidance on an appropriate next step.",
    bottomLine:
      "Ada identifies its consumer assessment as a Class IIa medical device under EU MDR and builds it for episodic symptom assessment and triage guidance. Murph is built for a continuing health relationship, so the products address different moments and should not be treated as identical AI assistants.",
    category: "health-assistants",
    chooseCompetitor:
      "Choose Ada when the immediate job is to use a structured symptom assessment that Ada identifies as a Class IIa medical device under EU MDR and receive a report with possible explanations and next-step guidance.",
    chooseMurph:
      "Choose Murph when the need is an ongoing conversation that retains broader personal context and helps with questions, planning, reminders, and follow-through over time.",
    competitor: {
      clinicalRole:
        "Ada identifies its consumer assessment as a Class IIa medical device under EU MDR. It provides possible explanations and care guidance but does not diagnose a condition or replace professional or emergency care.",
      followThrough:
        "Keeps an assessment history and allows users to review, export, or share reports. It does not center the experience on daily coaching or habit accountability.",
      format:
        "A structured conversational symptom assessment that adapts its questions to the user's answers and produces a personalized report.",
      hardware:
        "No proprietary device or wearable is required, and Ada does not document a current consumer wearable integration for the assessment.",
      inputs:
        "Current symptoms, symptom duration, age, demographic information, health profile, risk factors, and answers to follow-up questions.",
      insightStyle:
        "Compares the reported presentation with a clinical knowledge base to rank possible explanations and suggest the urgency or type of care to consider.",
      platforms:
        "iPhone, Android phones and tablets, Chromebooks, and a lighter web symptom assessment. Ada advertises support for seven languages.",
      pricing:
        "Ada says its consumer symptom assessment is free and does not contain advertising or a paid consumer subscription.",
      primaryJob:
        "Help a person think through a current symptom and decide what kind of care or next step may be appropriate.",
    },
    competitorEvidence: {
      clinicalRole: [5],
      followThrough: [3],
      format: [2],
      hardware: [1],
      inputs: [2],
      insightStyle: [2, 3],
      platforms: [3, 4, 5],
      pricing: [1],
      primaryJob: [1, 2],
    },
    faqs: [
      {
        answer:
          "No. Ada identifies its consumer assessment as a Class IIa medical device under EU MDR, but states that the possible causes and suggested next steps it presents are not a diagnosis or a replacement for professional care.",
        question: "Can Ada diagnose a medical condition?",
      },
      {
        answer:
          "Ada asks about symptoms, timing, basic profile information, and relevant risk factors. Its current consumer materials do not document Apple Health, Health Connect, wearable, or medical-record input for the symptom assessment.",
        question: "Does Ada use wearable or medical-record data?",
      },
      {
        answer:
          "Ada is focused on one symptom-assessment episode and the resulting report. Murph is organized around an ongoing conversation and follow-through across changing health context rather than a condition-ranking assessment flow.",
        question: "How is Ada's role different from Murph's?",
      },
    ],
    headline: "Murph vs Ada: ongoing health support or symptom assessment?",
    lastVerified: "2026-08-30",
    metaDescription:
      "Compare Murph and Ada on regulated symptom assessment, diagnosis limits, health data inputs, ongoing support, platforms, reports, and consumer pricing.",
    name: "Ada",
    overview:
      "Ada identifies its consumer assessment as a Class IIa medical device under EU MDR. It guides a user through questions about a current symptom, then returns possible explanations and next-step guidance, making it an episodic assessment rather than a broad daily coach. Murph occupies a different role as a continuing private conversation for health context, planning, and practical follow-through, and should not be described as reproducing Ada's assessment engine.",
    relationship: "different-role",
    slug: "ada",
    sources: [
      {
        label: "Ada consumer app",
        url: "https://ada.com/app/",
      },
      {
        label: "Ada symptom assessment guide",
        url: "https://ada.com/help/how-do-i-start-a-symptom-assessment/",
      },
      {
        label: "Ada App Store listing",
        url: "https://apps.apple.com/us/app/ada-your-health-portal/id1099986434",
      },
      {
        label: "Ada Google Play listing",
        url: "https://play.google.com/store/apps/details?id=com.ada.app",
      },
      {
        label: "Ada consumer medical-device status",
        url: "https://ada.com/help/what-degree-of-liability-does-ada-accept/",
      },
      {
        label: "Ada terms and regulatory status",
        url: "https://ada.com/terms-and-conditions/",
      },
    ],
    tradeoffs: [
      "Class IIa status under EU MDR does not make Ada's possible-cause report a diagnosis or account for everything a clinician can observe or test.",
      "Ada is not designed around daily coaching, wearable trends, or open-ended longitudinal support.",
      "Natural-language symptom entry and some product details vary by country, language, and app version.",
    ],
  },
  {
    aliases: ["Hume", "Hume Pod", "Hume Band"],
    bestFor:
      "Quantified-self and longevity users who want Hume's body-composition scale and screenless wearable in one metrics-focused app.",
    bottomLine:
      "Hume Health is a hardware-led measurement ecosystem with AI-generated wellness insights. Murph is a conversation-led assistant that does not require proprietary hardware, making this primarily a choice of product format and data source.",
    category: "health-assistants",
    chooseCompetitor:
      "Choose Hume Health when Hume Pod body-composition estimates, Hume Band recovery signals, and a unified metrics dashboard are the main appeal.",
    chooseMurph:
      "Choose Murph when you want a continuing private health conversation for context, questions, decisions, and follow-through without making a proprietary scale or band the center of the experience.",
    competitor: {
      clinicalRole:
        "A consumer wellness system. Hume says its Pod and Band are not medical devices and are not intended to diagnose, monitor, or manage medical conditions.",
      followThrough:
        "Daily briefings, trend views, nutrition logging, weekly reports, personalized guidance, and subscription-level coaching features.",
      format:
        "A mobile dashboard and AI insight layer paired with a multi-frequency body-composition scale and a screenless continuous wearable.",
      hardware:
        "Hume Pod and Hume Band 2.0 are the core data sources. The app has limited value without Hume hardware, although it can also read selected phone health-platform data.",
      inputs:
        "Estimated body composition from Hume Pod, sleep and recovery signals from Hume Band, nutrition entries, and selected Apple Health or Health Connect data.",
      insightStyle:
        "Presents metric trends, recovery and activity scores, daily recommendations, and proprietary outputs such as Pace of Aging and metabolic scores.",
      platforms:
        "iPhone and iPad with iOS 15 or later, Android phones and tablets, and Chromebook, used with supported Hume hardware.",
      pricing:
        "Official promotional pages showed Hume Pod near $229 and Hume Band 2.0 near $249 when verified. Core data is marketed as subscription-free, while the App Store lists optional Hume Plus Annual at $99.99. Hardware offers vary.",
      primaryJob:
        "Combine Hume body-composition and wearable measurements into a single wellness dashboard with trend-based guidance.",
    },
    competitorEvidence: {
      clinicalRole: [1, 5],
      followThrough: [2, 3],
      format: [1, 2],
      hardware: [1, 2, 4],
      inputs: [1, 2, 3, 4],
      insightStyle: [1, 2],
      platforms: [3, 4],
      pricing: [1, 2, 3],
      primaryJob: [1, 2],
    },
    faqs: [
      {
        answer:
          "For its main experience, yes. Hume Health is designed around Hume Pod and Hume Band data. The app can also receive selected Apple Health and Health Connect data, but that does not turn it into a hardware-independent general assistant.",
        question: "Do I need Hume hardware to use Hume Health?",
      },
      {
        answer:
          "No. Hume describes Pod body composition as an estimate rather than a DEXA-equivalent clinical measurement. It also describes Band blood-pressure insights as directional PPG trends, not cuff readings or a tool for managing hypertension.",
        question: "Are Hume's measurements clinical readings?",
      },
      {
        answer:
          "The official app listing shows Hume Plus as an optional purchase, while current product pages say core scores and data remain available without a subscription. Some deeper reports, nutrition tools, or coaching features may require Hume Plus.",
        question: "Does Hume Health require a subscription?",
      },
    ],
    headline: "Murph vs Hume Health: conversation or hardware-led insights?",
    lastVerified: "2026-08-30",
    metaDescription:
      "Compare Murph and Hume Health across body composition, wearable recovery data, AI insights, hardware requirements, medical limits, and pricing.",
    name: "Hume Health",
    overview:
      "Hume Health begins with measurement hardware. Hume Pod estimates body composition, Hume Band records sleep and recovery signals, and the app converts those readings into trends and AI guidance. Murph begins with an ongoing health conversation and can use authorized context without requiring a particular scale or band. Hume's aging and metabolic outputs are wellness estimates, not established clinical measurements.",
    relationship: "different-role",
    slug: "hume-health",
    sources: [
      {
        label: "Hume Pod",
        url: "https://humehealth.com/pages/the-hume-pod",
      },
      {
        label: "Hume Band",
        url: "https://humehealth.com/pages/the-hume-band",
      },
      {
        label: "Hume Health App Store listing",
        url: "https://apps.apple.com/us/app/hume-health/id1477782599",
      },
      {
        label: "Hume Health Google Play listing",
        url: "https://play.google.com/store/apps/details?id=com.elink.fittrackhealth.pro",
      },
      {
        label: "Hume Band medical disclaimer",
        url: "https://humehealth.com/pages/humeband-quickstart",
      },
    ],
    tradeoffs: [
      "Using the full Hume experience requires an upfront hardware purchase and continued use of Hume devices.",
      "Bioelectrical-impedance body composition and optical wearable signals are useful for trends but remain estimates affected by measurement conditions.",
      "Hume's proprietary aging, recovery, and metabolic scores should not be interpreted as diagnoses or guaranteed outcome changes.",
    ],
  },
  {
    aliases: ["HUMANITY - AI Health Coach", "Humanity Health"],
    bestFor:
      "Longevity-focused users who want a simple Rate of Aging score, gamified daily actions, wearable data, and optional blood-test analysis.",
    bottomLine:
      "Humanity packages phone, wearable, and optional laboratory inputs into proprietary aging scores and daily wellness actions. Murph provides a broader ongoing health conversation without treating one aging score as the center of the relationship.",
    category: "health-assistants",
    chooseCompetitor:
      "Choose Humanity when Rate of Aging, Biological Age, streaks, social accountability, and a longevity-focused action program are the desired experience.",
    chooseMurph:
      "Choose Murph when you want to discuss wider health context, uncertainty, records, questions, tradeoffs, and practical follow-through without organizing the experience around a single proprietary age estimate.",
    competitor: {
      clinicalRole:
        "A consumer wellness and longevity app. Humanity says its scores and guidance are informational and are not medical advice, diagnosis, treatment, or a reason to change medication or care without a professional.",
      followThrough:
        "Recommended actions across movement, nutrition, mind, and recovery, plus streaks, reminders, weekly reports, and optional social Circles.",
      format:
        "A mobile longevity dashboard and AI coach organized around proprietary aging scores, daily actions, and optional blood-test analysis.",
      hardware:
        "No proprietary hardware is required. A supported phone, Apple Watch, or other data source connected through Apple Health or Health Connect can contribute signals.",
      inputs:
        "Phone and wearable movement, steps, heart-rate patterns, resting heart rate, sleep, manually completed actions, and optional recent blood-test results.",
      insightStyle:
        "Summarizes inputs as Rate of Aging, Biological Age, Age Difference, H Score, and Blood Age, then recommends wellness actions intended to move those estimates.",
      platforms:
        "iPhone with iOS 16 or later, Apple Watch with watchOS 9.3 or later, and Android with supported Health Connect data.",
      pricing:
        "A free account can generate a Rate of Aging score. Humanity currently advertises Premium at $49.99 per year, while the App Store shows several promotional Premium prices and a separate Pro purchase. Checkout terms can vary.",
      primaryJob:
        "Motivate longevity-oriented behavior through model-generated aging estimates and a gamified set of daily wellness actions.",
    },
    competitorEvidence: {
      clinicalRole: [4],
      followThrough: [2],
      format: [2],
      hardware: [2, 3],
      inputs: [2, 3],
      insightStyle: [1, 2],
      platforms: [2, 3],
      pricing: [2, 4],
      primaryJob: [1],
    },
    faqs: [
      {
        answer:
          "No. Humanity's Biological Age and Rate of Aging are model-generated wellness estimates. They can be used as motivational trends, but the consumer product does not establish them as clinical diagnoses or precise forecasts for an individual.",
        question: "Is Humanity's Biological Age a clinical measurement?",
      },
      {
        answer:
          "Humanity can generate its core Rate of Aging from compatible phone and wearable signals. Its Pro features can add recent blood-test data to produce blood-based insights, so laboratory input is optional rather than required for the basic experience.",
        question: "Does Humanity require a blood test?",
      },
      {
        answer:
          "Humanity organizes its experience around aging estimates, daily actions, and gamification. Murph is organized around a broader continuing conversation that can address many kinds of health context and does not make one longevity score the main interface.",
        question: "What is the central difference between Humanity and Murph?",
      },
    ],
    headline: "Murph vs Humanity for AI longevity and daily health support",
    lastVerified: "2026-08-30",
    metaDescription:
      "Compare Murph and Humanity on Rate of Aging, Biological Age, wearable and blood-test inputs, daily actions, medical limits, and pricing.",
    name: "Humanity",
    overview:
      "Humanity is a longevity app that translates compatible phone, wearable, and optional blood-test data into proprietary age and healthspan-oriented scores. It uses daily actions and gamification to encourage movement, nutrition, recovery, and mind-related habits. Murph is structured around a wider ongoing health relationship rather than a score-led longevity program. Humanity's outputs remain wellness estimates and should not be read as clinical biological age.",
    relationship: "alternative",
    slug: "humanity",
    sources: [
      {
        label: "Humanity product overview",
        url: "https://humanity.health/",
      },
      {
        label: "Humanity App Store listing",
        url: "https://apps.apple.com/us/app/humanity-ai-health-coach/id1519091344",
      },
      {
        label: "Humanity Google Play listing",
        url: "https://play.google.com/store/apps/details?id=health.humanity.android",
      },
      {
        label: "Humanity terms",
        url: "https://www.humanity.health/terms",
      },
      {
        label: "Humanity privacy policy",
        url: "https://www.humanity.health/privacy",
      },
    ],
    tradeoffs: [
      "A single aging score can make progress feel concrete, but it can also imply more precision than a proprietary wellness estimate supports.",
      "Blood-based features and deeper analysis sit outside the free core experience and may require a higher-priced plan.",
      "Recommendations are general wellness guidance and should not drive medication, diagnosis, or treatment decisions.",
    ],
  },
  {
    aliases: ["Health Tracker: Healthily", "Your.MD"],
    bestFor:
      "People who want a mobile self-care journal for habits, symptoms, mood, medication, reminders, structured plans, and health content.",
    bottomLine:
      "Healthily is currently verifiable as a self-care tracker and content app, but its advertised DOT AI symptom checker is not verified as live. Murph is an ongoing conversational assistant rather than a structured self-care journal.",
    category: "health-assistants",
    chooseCompetitor:
      "Choose Healthily for manual wellness tracking, reminders, short guided plans, weekly reports, and a library of self-care information.",
    chooseMurph:
      "Choose Murph when you want an active ongoing health conversation that can carry context across questions, plans, records, decisions, reminders, and follow-through.",
    competitor: {
      clinicalRole:
        "A consumer self-care and wellness app. Healthily says its content and tools do not provide medical advice, diagnosis, or treatment and do not replace a health professional.",
      followThrough:
        "Goals, reminders, manual trackers, notes, weekly reports, and 28-day plans covering activity, mind, nutrition, and sleep.",
      format:
        "A structured mobile health journal with trackers, plans, reports, reminders, a back-pain hub, and a health-information library.",
      hardware:
        "No proprietary hardware is required. Healthily advertises selected Apple Health and Fitbit data support, with current terms most clearly documenting health-app sync on iOS.",
      inputs:
        "Manual activity, sleep, mental wellbeing, symptoms, medication, habits, goals, notes, and selected connected health or Fitbit data.",
      insightStyle:
        "Shows logs, progress, reminders, and weekly self-care reports. The store listings still advertise a DOT AI checker, but its live consumer availability is not established.",
      platforms:
        "iPhone with iOS 14 or later. Android availability is not currently verifiable from a live official listing; confirm a live regional listing before relying on Android support.",
      pricing:
        "Healthily advertises a seven-day trial. Its App Store list includes $4.99 weekly, $6.49 and $24.99 subscription entries, and a $29.99 lifetime entry, but some durations are unclear and checkout terms control.",
      primaryJob:
        "Help a user record wellness factors, follow short self-care plans, and review progress in a structured mobile journal.",
    },
    competitorEvidence: {
      clinicalRole: [4],
      followThrough: [2],
      format: [2],
      hardware: [4],
      inputs: [2],
      insightStyle: [2, 5],
      platforms: [2, 3],
      pricing: [2],
      primaryJob: [2],
    },
    faqs: [
      {
        answer:
          "Not from the current public evidence. The mobile listings still advertise Healthily's DOT AI chatbot and symptom checker, but Healthily's consumer symptom-checker page says the feature has been temporarily removed and the current terms do not list it as an active service.",
        question: "Is Healthily's AI symptom checker currently available?",
      },
      {
        answer:
          "Healthily supports manual trackers for areas such as activity, sleep, mental wellbeing, symptoms, medication, and custom habits. It also advertises Apple Health and Fitbit data, although supported fields and connection paths can vary.",
        question: "What can I track in Healthily?",
      },
      {
        answer:
          "Healthily's terms exclude emergency use and say the service is not intended for children under 16, pregnancy, immunosuppression, or management of long-term conditions such as diabetes. A qualified professional remains the right source for medical decisions.",
        question: "Who should not rely on Healthily for self-care guidance?",
      },
    ],
    headline: "Murph vs Healthily for AI guidance and self-care tracking",
    lastVerified: "2026-08-30",
    metaDescription:
      "Compare Murph and Healthily on self-care tracking, wellness plans, advertised AI features, data connections, medical limits, pricing, and current iPhone availability.",
    name: "Healthily",
    overview:
      "Healthily is currently a mobile self-care journal with manual trackers, reminders, guided plans, weekly reports, and health information. Its stores still mention the DOT AI chatbot and symptom checker, but the official consumer web page says that checker is temporarily removed, so it should not be presented as a verified live AI assistant. Murph's product shape is an ongoing health conversation rather than a library and tracking interface.",
    relationship: "different-role",
    slug: "healthily",
    sources: [
      {
        label: "Healthily consumer product",
        url: "https://www.healthily.app/",
      },
      {
        label: "Healthily App Store listing",
        url: "https://apps.apple.com/us/app/health-tracker-healthily/id1491316446",
      },
      {
        label: "Healthily download page",
        url: "https://www.healthily.app/download",
      },
      {
        label: "Healthily terms of service",
        url: "https://www.healthily.app/terms-of-service",
      },
      {
        label: "Healthily symptom checker status",
        url: "https://www.livehealthily.com/symptom-checker/",
      },
    ],
    tradeoffs: [
      "The current app supports useful structured self-care tracking, but its advertised AI checker cannot be treated as a verified live feature.",
      "Manual tracking can reveal patterns only when entries are consistent enough to support a meaningful report.",
      "Current Android availability is not verifiable from a live official listing, and Healthily's terms exclude several populations and medical situations from its intended self-care use.",
    ],
  },
]);
