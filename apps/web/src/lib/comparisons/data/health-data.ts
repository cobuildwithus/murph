import { defineComparisons } from "../types";

export const HEALTH_DATA_COMPARISONS = defineComparisons([
  {
    aliases: ["Guava Health"],
    category: "health-data",
    chooseCompetitor:
      "Choose Guava if provider-record retrieval, a structured medication and symptom history, correlation charts, and a visit-ready packet are the core jobs. Its assistant also lets you search and analyze the information held in Guava.",
    chooseMurph:
      "Choose Murph if the harder part is reasoning across records, labs, wearable signals, symptoms, meals, and workouts in natural language, then turning a decision into reminders, check-ins, or a small experiment.",
    competitor: {
      clinicalRole:
        "A consumer personal health record and tracker. Guava organizes health information but does not replace a licensed clinician or emergency care.",
      followThrough:
        "Structured medication and symptom logs, reminders, goals, visit preparation, controlled sharing, and a Premium Emergency Card.",
      format:
        "A structured health timeline, record library, trackers, charts, correlations, and an assistant inside mobile and web apps.",
      hardware:
        "No proprietary device is required. Connected portals, apps, wearables, and glucose monitors can supply data.",
      inputs:
        "Medical records, labs, imaging documents, medications, symptoms, food, mood, menstrual cycle, activity, sleep, and connected-device data.",
      insightStyle:
        "Charts and correlations sit beside an AI assistant that can log entries and reminders, search and analyze Guava data, answer questions about that history, navigate features, and prepare visits. Guava warns that its generative AI is not always perfect.",
      platforms:
        "iOS, Android, and web, including a progressive web app experience.",
      pricing:
        "A free plan is available. Guava Premium is listed at $8 per month or $78 per year.",
      primaryJob:
        "Bring clinical records and day-to-day health tracking into one consumer-controlled health profile.",
    },
    competitorEvidence: {
      clinicalRole: [1, 5],
      followThrough: [1, 2, 5],
      format: [5],
      hardware: [3],
      inputs: [4],
      insightStyle: [5],
      platforms: [4],
      pricing: [2],
      primaryJob: [1],
    },
    faqs: [
      {
        answer:
          "Guava starts with the record: it retrieves, organizes, tracks, and shares health information, with an assistant for working with data inside Guava. Murph starts with the relationship: conversation is the main interface, and the work continues into decisions, plans, reminders, and check-ins.",
        question: "What is the main difference between Murph and Guava?",
      },
      {
        answer:
          "Guava lists MyChart, CommonWell, Medicare, Veterans Affairs, athenahealth, and Healow, plus Apple Health, Health Connect, Fitbit, Garmin, Oura, WHOOP, Withings, and Dexcom. Its direct Connect Provider feature is US-specific; outside the US, document upload and other sources remain available. Verify the exact provider, metric, and route you need.",
        question: "What data sources does Guava support?",
      },
      {
        answer:
          "Yes. The free plan includes portal and device sync, tracking, summaries and correlations, sharing, and uploads. Premium costs $8 per month or $78 per year and adds automatic insights, Guava Assistant AI, automated lab extraction, family profile managers, photo food analysis, and an Emergency Card.",
        question: "Is Guava free?",
      },
    ],
    headline: "Health assistant or personal health record?",
    lastVerified: "2026-08-31",
    metaDescription:
      "Guava builds a personal health record from portals, logs, and devices; Murph is a personal health assistant that interprets context and carries decisions forward.",
    name: "Guava",
    quickComparison: [
      {
        capability: "Direct US provider retrieval",
        competitor: "yes",
        evidence: "primaryJob",
        murph: "yes",
      },
      {
        capability: "Structured health record",
        competitor: "yes",
        evidence: "format",
        murph: "yes",
      },
      {
        capability: "Visit ready sharing",
        competitor: "yes",
        evidence: "followThrough",
        murph: "limited",
      },
      {
        capability: "Ongoing assistant conversation",
        competitor: "limited",
        evidence: "insightStyle",
        murph: "yes",
      },
      {
        capability: "Reminders and check ins",
        competitor: "yes",
        evidence: "followThrough",
        murph: "yes",
      },
      {
        capability: "Wearable and lab context",
        competitor: "yes",
        evidence: "inputs",
        murph: "yes",
      },
      {
        capability: "Handles health errands",
        competitor: "no",
        evidence: "followThrough",
        murph: "yes",
      },
      {
        capability: "Tests what works for you",
        competitor: "no",
        evidence: "followThrough",
        murph: "yes",
      },
      {
        capability: "Optional group support",
        competitor: "limited",
        evidence: "followThrough",
        murph: "yes",
      },
      {
        capability: "Open source option",
        competitor: "no",
        evidence: "platforms",
        murph: "yes",
      },
    ],
    relationship: "alternative",
    slug: "guava",
    sources: [
      {
        label: "Guava product overview",
        url: "https://guavahealth.com/",
      },
      {
        label: "Guava plans",
        url: "https://guavahealth.com/plans",
      },
      {
        label: "Guava supported apps and devices",
        url: "https://guavahealth.com/supported-apps",
      },
      {
        label: "Guava frequently asked questions",
        url: "https://guavahealth.com/faq",
      },
      {
        label: "Guava Assistant guide",
        url: "https://guavahealth.com/article/guava-ultimate-guide",
      },
    ],
    tradeoffs: [
      "Guava is more purpose-built for retrieving provider records and assembling information for a visit. Murph should not be chosen as a substitute for a dedicated record wallet.",
      "Guava's structured logs create a consistent history when maintained carefully, but they also ask the member to keep the tracker current.",
      "Guava's direct Connect Provider feature is limited to US providers; Guava says people elsewhere can still upload records and enter information manually.",
      "Murph makes explanation and follow-through the center of the experience, while Guava may remain the better fit for someone who wants charts, documents, and shareable summaries to stay in the foreground.",
      "Guava's assistant, automatic insights and lab extraction, family profile managers, photo food analysis, and Emergency Card require Premium.",
    ],
  },
  {
    category: "health-data",
    chooseCompetitor:
      "Choose CareClinic if you want to record symptoms, medications, mood, sleep, nutrition, activity, and care-plan adherence on a repeatable schedule, especially if you need reports to bring to appointments.",
    chooseMurph:
      "Choose Murph if you are less interested in maintaining a detailed diary and more interested in discussing how symptoms, sleep, meals, workouts, labs, or records fit together, then following up through reminders and check-ins.",
    competitor: {
      clinicalRole:
        "A consumer self-management app for recording and organizing symptoms, medications, routines, and other health information. CareClinic's terms say it does not provide medical advice, diagnosis, or treatment and is not a clinical system.",
      followThrough:
        "Reminders, care plans, recurring check-ins, caregiver participation, goals, adherence tracking, and reports for appointments.",
      format:
        "A configurable mobile diary with trackers, schedules, correlations, assessments, reports, and caregiver features.",
      hardware:
        "No proprietary hardware is required. Phone and wearable health platforms can contribute selected measurements.",
      inputs:
        "Symptoms, medications, treatments, mood, sleep, nutrition, activity, vitals, menstrual cycle, notes, documents, and supported health-platform data.",
      insightStyle:
        "Product pages market AI-powered pattern detection and personalized recommendations alongside charts and correlations. CareClinic's terms limit those insights to informational self-management and say the tools do not perform clinical analysis.",
      platforms:
        "iOS, Android, and Apple Watch. CareClinic also documents a limited legacy web interface for basic logging.",
      pricing:
        "A free version with core features is available. Premium adds advanced analytics, PDF reports, caregiver sharing, and more integrations through monthly, annual, or lifetime plans; current amounts are not published on the cited pages, so confirm at checkout.",
      primaryJob:
        "Help an individual document symptoms, treatments, behaviors, and outcomes in a consistent condition-management routine.",
    },
    competitorEvidence: {
      clinicalRole: [1, 6],
      followThrough: [1],
      format: [1],
      hardware: [2],
      inputs: [1, 2],
      insightStyle: [1, 5, 6],
      platforms: [1, 4],
      pricing: [3, 5],
      primaryJob: [1],
    },
    faqs: [
      {
        answer:
          "CareClinic is a structured self-management system: log the day, follow a care plan, review adherence, and export a report. Murph is conversation-led: bring a changing question or decision, connect it with authorized context, and continue the work through a plan and follow-up.",
        question: "How is CareClinic different from Murph?",
      },
      {
        answer:
          "CareClinic documents Apple Health, Google Fit or Health Connect, Fitbit, and Apple Watch connections. Its integration page markets Garmin, Oura, WHOOP, and Dexcom connections, but the FAQ on that same page says direct integrations for those four are still coming soon. Verify whether a currently available route and its supported fields meet your needs before choosing CareClinic for one of those devices.",
        question: "Which devices and health apps work with CareClinic?",
      },
      {
        answer:
          "CareClinic is mainly a mobile product. Its support center describes a legacy web interface for basic diary entries, while the full experience and newer features live in the iOS and Android apps.",
        question: "Can CareClinic be used on the web?",
      },
    ],
    headline: "Conversational support or health diary?",
    lastVerified: "2026-08-31",
    metaDescription:
      "CareClinic is a structured condition diary with reminders and reports; Murph is a personal health assistant focused on discussing changing context and following through.",
    name: "CareClinic",
    quickComparison: [
      {
        capability: "Detailed symptom diary",
        competitor: "yes",
        evidence: "format",
        murph: "limited",
      },
      {
        capability: "Medication adherence tracking",
        competitor: "yes",
        evidence: "followThrough",
        murph: "yes",
      },
      {
        capability: "Appointment reports",
        competitor: "limited",
        evidence: "followThrough",
        murph: "yes",
      },
      {
        capability: "Ongoing assistant conversation",
        competitor: "no",
        evidence: "insightStyle",
        murph: "yes",
      },
      {
        capability: "Plans reminders and check ins",
        competitor: "yes",
        evidence: "followThrough",
        murph: "yes",
      },
      {
        capability: "Free start without a card",
        competitor: "yes",
        evidence: "pricing",
        murph: "yes",
      },
      {
        capability: "Wearable and lab context",
        competitor: "limited",
        evidence: "inputs",
        murph: "yes",
      },
      {
        capability: "Handles health errands",
        competitor: "no",
        evidence: "followThrough",
        murph: "yes",
      },
      {
        capability: "Tests what works for you",
        competitor: "no",
        evidence: "followThrough",
        murph: "yes",
      },
      {
        capability: "Optional group support",
        competitor: "limited",
        evidence: "followThrough",
        murph: "yes",
      },
    ],
    relationship: "alternative",
    slug: "careclinic",
    sources: [
      {
        label: "CareClinic product overview",
        url: "https://careclinic.io/",
      },
      {
        label: "CareClinic health data integrations",
        url: "https://careclinic.io/features/health-data-integrations/",
      },
      {
        label: "CareClinic Premium subscriptions",
        url: "https://start.careclinic.io/knowledgebase/premium-subscriptions/",
      },
      {
        label: "CareClinic web browser support",
        url: "https://start.careclinic.io/knowledgebase/settings-menu/can-i-log-data-on-my-desktop-web-browser/202/",
      },
      {
        label: "CareClinic app features",
        url: "https://careclinic.io/features/",
      },
      {
        label: "CareClinic terms of use",
        url: "https://careclinic.io/terms-of-use/",
      },
    ],
    tradeoffs: [
      "CareClinic offers more purpose-built symptom scales, schedules, adherence views, and appointment reporting. Murph is not a replacement for a carefully configured condition journal.",
      "CareClinic's structured history can be valuable when details matter, but building that history can require significant daily input.",
      "Its mobile apps contain the full experience; desktop access is documented as a limited legacy interface.",
      "CareClinic's integration page contradicts itself about whether direct Garmin, Oura, WHOOP, and Dexcom connections are live or coming soon; verify the exact device and metric before relying on one of those routes.",
      "CareClinic documents monthly, annual, and lifetime Premium plans, but the cited pages do not publish stable current amounts; confirm the final price at checkout.",
    ],
  },
  {
    category: "health-data",
    chooseCompetitor:
      "Choose Bearable if you want to decide exactly what to score each day, make logging quick, and inspect how symptoms move alongside medications, routines, and other factors over time.",
    chooseMurph:
      "Choose Murph if you want to ask why a pattern might matter, bring in context beyond a symptom log, and have the answer lead somewhere practical through a plan, experiment, reminder, or check-in.",
    competitor: {
      clinicalRole:
        "A consumer symptom and wellbeing tracker often used for chronic illness, pain, fatigue, mood, and self-management. It is not a medical-record system or clinician.",
      followThrough:
        "Daily check-ins, medication and routine reminders, goals, experiments, reports, and data export.",
      format:
        "A customizable mobile tracker with a daily timeline, symptom and factor ratings, charts, correlations, and experiment tools.",
      hardware:
        "No proprietary hardware is needed. Bearable reads selected connected data through Health Connect on Android and Apple Health on iPhone; Fitbit and Google Health data use those hub routes.",
      inputs:
        "Symptoms, mood, energy, pain, sleep, medications, nutrition, habits, events, menstrual cycle, custom factors, and connected health data.",
      insightStyle:
        "Correlation and trend views compare symptoms with treatments, habits, and other factors. Current official support material points users to CSV export for analysis in external AI tools rather than describing a built-in AI assistant.",
      platforms:
        "iOS and Android phones and tablets. Bearable does not offer a full web or desktop app and advises using one device at a time to avoid conflicts or data loss.",
      pricing:
        "Most features are free. Bearable's pricing page lists Premium at $6.99 per month or $34.99 per year and says the annual price is frequently discounted to $18.99.",
      primaryJob:
        "Make daily symptom and lifestyle tracking flexible enough to reveal possible personal patterns.",
    },
    competitorEvidence: {
      clinicalRole: [1],
      followThrough: [1, 2],
      format: [1],
      hardware: [3, 4],
      inputs: [1, 3],
      insightStyle: [1, 2],
      platforms: [1, 6, 7],
      pricing: [5],
      primaryJob: [1],
    },
    faqs: [
      {
        answer:
          "Bearable helps you build and inspect a structured self-reported dataset. Murph helps you discuss a health question across authorized context and carry the conclusion into action. Bearable is stronger when the tracker itself is the job; Murph is stronger when interpretation and follow-up are the job, whether or not a tracking history already exists.",
        question: "What separates Bearable from Murph?",
      },
      {
        answer:
          "Bearable's current official pages do not describe a built-in AI coach. They describe charts, correlations, goals, and experiments, and Bearable's support material suggests exporting CSV data to an outside AI tool such as ChatGPT. Murph differs because the ongoing assistant conversation is the primary product.",
        question: "Does Bearable include an AI health coach?",
      },
      {
        answer:
          "Bearable reads selected data through Health Connect on Android and Apple Health on iPhone. Fitbit and Google Health data use those hubs. Fitbit-recorded data may currently be unavailable to Bearable on iPhone because Google Health does not yet write it into Apple Health.",
        question: "Can Bearable import wearable data?",
      },
    ],
    headline: "Health conversation or symptom tracker?",
    lastVerified: "2026-08-31",
    metaDescription:
      "Bearable turns customizable symptom logs into correlations; Murph is a personal health assistant for discussing wider context and acting on what matters.",
    name: "Bearable",
    quickComparison: [
      {
        capability: "Custom symptom tracking",
        competitor: "yes",
        evidence: "format",
        murph: "limited",
      },
      {
        capability: "Correlation charts",
        competitor: "yes",
        evidence: "insightStyle",
        murph: "limited",
      },
      {
        capability: "Ongoing assistant conversation",
        competitor: "no",
        evidence: "insightStyle",
        murph: "yes",
      },
      {
        capability: "Connected wearable data",
        competitor: "limited",
        evidence: "hardware",
        murph: "yes",
      },
      {
        capability: "Reminders and check ins",
        competitor: "yes",
        evidence: "followThrough",
        murph: "yes",
      },
      {
        capability: "Tests what works for you",
        competitor: "yes",
        evidence: "followThrough",
        murph: "yes",
      },
      {
        capability: "Free start without a card",
        competitor: "yes",
        evidence: "pricing",
        murph: "yes",
      },
      {
        capability: "Handles health errands",
        competitor: "no",
        evidence: "followThrough",
        murph: "yes",
      },
      {
        capability: "Optional group support",
        competitor: "limited",
        evidence: "followThrough",
        murph: "yes",
      },
      {
        capability: "Open source option",
        competitor: "no",
        evidence: "platforms",
        murph: "yes",
      },
    ],
    relationship: "alternative",
    slug: "bearable",
    sources: [
      {
        label: "Bearable product overview",
        url: "https://bearable.app/",
      },
      {
        label: "Bearable free and Premium features",
        url: "https://bearable.app/support/common-questions/bearable-free-vs-premium-features/",
      },
      {
        label: "Bearable health data syncing",
        url: "https://bearable.app/support/howto/sync-with-google-health-connect-apple-health/",
      },
      {
        label: "Bearable Fitbit and Google Health migration guidance",
        url: "https://bearable.app/support/howto/switch-from-fitbit-to-google-health/",
      },
      {
        label: "Bearable pricing principles",
        url: "https://bearable.app/our-pricing-and-principles/",
      },
      {
        label: "Bearable browser and desktop support",
        url: "https://bearable.app/support/common-questions/is-there-a-browser-or-desktop-version-of-bearable/",
      },
      {
        label: "Bearable multi-device support",
        url: "https://bearable.app/support/common-questions/can-i-use-bearable-on-multiple-devices/",
      },
    ],
    tradeoffs: [
      "Bearable is more granular and purpose-built for repeatable symptom scoring. Murph does not offer the same configurable tracker screens or correlation charts.",
      "Useful Bearable correlations depend on consistent self-reporting, and an association can generate a question without proving what caused a symptom.",
      "Bearable's current official pages center user-entered and mobile-hub data and do not document patient-portal retrieval or a built-in assistant conversation.",
      "A full Bearable desktop or web experience is not available, connected metrics vary by mobile health platform, and Fitbit-recorded data may not currently reach Bearable on iPhone.",
      "Bearable advises using one device at a time because simultaneous use can cause conflicts or data loss.",
    ],
  },
  {
    aliases: ["Exist.io"],
    category: "health-data",
    chooseCompetitor:
      "Choose Exist if you enjoy maintaining an integration-rich quantified-self system and want custom attributes, daily and weekly summaries, and conventional statistical correlations across health and non-health data.",
    chooseMurph:
      "Choose Murph if you would rather bring a health question to a conversation, consider records, labs, wearables, symptoms, meals, or workouts together, and turn the answer into an experiment or follow-up.",
    competitor: {
      clinicalRole:
        "A consumer quantified-self analytics service focused on personal trends and correlations. Its official materials do not present it as clinical care.",
      followThrough:
        "Daily insights, weekly summaries, mood prompts, custom tracking, and self-directed personal experiments.",
      format:
        "A full web dashboard with iOS and Android companion apps, integration feeds, charts, correlations, and custom attributes.",
      hardware:
        "No proprietary device is required. Exist depends on connected services and manual custom tracking.",
      inputs:
        "Activity, sleep, workouts, weight, mood, productivity, tasks, calendar, weather, location, media, social activity, and custom numeric or tagged data.",
      insightStyle:
        "Daily observations and long-term trends sit beside correlations with strength and confidence indicators. Exist explicitly uses traditional statistics rather than generative AI and warns that correlation does not establish cause.",
      platforms:
        "A full web app with iOS and Android companion apps for mood, custom tracking, and summaries.",
      pricing:
        "Exist is listed at $6.99 per month or $62.90 per year after a 30-day free trial.",
      primaryJob:
        "Find measurable relationships across many aspects of a person's digital and physical life.",
    },
    competitorEvidence: {
      clinicalRole: [1],
      followThrough: [1],
      format: [1, 4],
      hardware: [1],
      inputs: [2],
      insightStyle: [1, 3, 5],
      platforms: [4],
      pricing: [1],
      primaryJob: [1],
    },
    faqs: [
      {
        answer:
          "Exist shows what moves together across connected services and custom attributes. Murph helps someone reason about a health question and sustain a decision. Murph is not a more detailed quantified-self dashboard, and Exist is not an open-ended health conversation.",
        question: "How does Exist compare with Murph?",
      },
      {
        answer:
          "No. Exist says it uses traditional statistical analysis rather than generative AI. Its insights are derived from users' tracked attributes and correlations, not an open-ended assistant conversation.",
        question: "Does Exist use generative AI?",
      },
      {
        answer:
          "Exist requires at least three weeks of data for an attribute and recalculates correlations weekly. More overlapping history can improve confidence, but Exist itself warns that a correlation cannot establish cause.",
        question: "How long does Exist need before showing correlations?",
      },
    ],
    headline: "Conversational health help or quantified self?",
    lastVerified: "2026-08-31",
    metaDescription:
      "Exist finds statistical relationships across a quantified life; Murph is a personal health assistant built to interpret health context through conversation and follow-up.",
    name: "Exist",
    quickComparison: [
      {
        capability: "Statistical correlations",
        competitor: "yes",
        evidence: "insightStyle",
        murph: "limited",
      },
      {
        capability: "Lifestyle and productivity data",
        competitor: "yes",
        evidence: "inputs",
        murph: "limited",
      },
      {
        capability: "Custom quantitative tracking",
        competitor: "yes",
        evidence: "format",
        murph: "limited",
      },
      {
        capability: "Ongoing health conversation",
        competitor: "no",
        evidence: "insightStyle",
        murph: "yes",
      },
      {
        capability: "Personal experiments",
        competitor: "yes",
        evidence: "followThrough",
        murph: "yes",
      },
      {
        capability: "Wearable and lab context",
        competitor: "limited",
        evidence: "inputs",
        murph: "yes",
      },
      {
        capability: "Reminders and check ins",
        competitor: "limited",
        evidence: "followThrough",
        murph: "yes",
      },
      {
        capability: "Handles health errands",
        competitor: "no",
        evidence: "followThrough",
        murph: "yes",
      },
      {
        capability: "Free start without a card",
        competitor: "limited",
        evidence: "pricing",
        murph: "yes",
      },
      {
        capability: "Open source option",
        competitor: "no",
        evidence: "platforms",
        murph: "yes",
      },
    ],
    relationship: "alternative",
    slug: "exist",
    sources: [
      {
        label: "Exist product and pricing overview",
        url: "https://exist.io/",
      },
      {
        label: "Exist apps and data syncing",
        url: "https://exist.io/apps-data-syncing/",
      },
      {
        label: "Exist values and statistical approach",
        url: "https://exist.io/about/values/",
      },
      {
        label: "Exist frequently asked questions",
        url: "https://exist.io/page/faqs/",
      },
      {
        label: "Exist correlation methodology",
        url: "https://kb.exist.io/article/37-what-are-correlations",
      },
    ],
    tradeoffs: [
      "Murph does not reproduce Exist's non-health integrations or statistics dashboard. People who want to inspect the numbers directly may prefer Exist's dashboard-first approach.",
      "Meaningful correlations require enough overlapping history, and a statistical association is not proof of cause.",
      "Each attribute can use only one selected source at a time, which may require choices when services overlap.",
      "Exist deliberately avoids generative AI. That can appeal to users who prefer a non-generative statistical interface and frustrate users who want open-ended explanation; Murph takes the opposite product approach by making conversation central.",
      "After its 30-day trial, Exist lists one paid plan at $6.99 per month or $62.90 per year; it does not advertise a permanent free tier.",
    ],
  },
  {
    category: "health-data",
    chooseCompetitor:
      "Choose Gyroscope if Daily Reports, a Health Score, photo-based food logging, location and productivity views, and optional human coaching fit how you want to use your iPhone and Apple Watch data.",
    chooseMurph:
      "Choose Murph if you want health support to live mainly in familiar messaging, do not want the full experience to depend on a modern iPhone, and want a discussion to become a plan, reminder, check-in, or practical health task. Murph does not provide Gyroscope's Health Score, Food XRAY, or Max human coaching.",
    competitor: {
      clinicalRole:
        "A consumer wellness dashboard and coaching product. It is not an electronic health record or substitute for medical diagnosis and treatment.",
      followThrough:
        "Daily reports, goals, meditations, AI coaching, and optional human coaching on Max plans.",
      format:
        "An iPhone-first visual dashboard with Health Score, Daily Reports, timelines, photo-based food logging, and coaching layers.",
      hardware:
        "No Gyroscope-branded sensor is required, but an iPhone running iOS 18 or newer is required for the full app. Apple Watch, Oura, Garmin, and other supported sources are optional.",
      inputs:
        "Food photos, sleep, workouts, steps, mood, places, productivity, blood biomarkers, and supported connected services.",
      insightStyle:
        "Automated Daily Reports and Health Score summaries pair with an AI coach. Max memberships can add a human coach.",
      platforms:
        "The full app requires an iPhone running iOS 18 or newer. Members can view their data on the web, and Apple Watch data is supported. There is no current Android app.",
      pricing:
        "Basic is free with 30 days of storage and five daily tokens. One is listed at $1 per day with unlimited storage and 20 tokens; Max is listed at $3 to $8 per day with unlimited storage, 100 tokens, and AI, human coaching, or both.",
      primaryJob:
        "Turn Apple-centered lifestyle and biometrics data into a polished daily health dashboard and coaching program.",
    },
    competitorEvidence: {
      clinicalRole: [1, 5],
      followThrough: [1, 2, 3],
      format: [1, 3],
      hardware: [1, 2],
      inputs: [1, 3],
      insightStyle: [1, 2, 5],
      platforms: [1, 2],
      pricing: [2],
      primaryJob: [1],
    },
    faqs: [
      {
        answer:
          "Gyroscope turns Apple-centered lifestyle and biometric data into a visual daily report and coaching membership. Murph turns authorized health context into a continuing conversation and practical follow-up. Gyroscope is stronger as a polished dashboard; Murph is designed to reduce the need to manage health through one.",
        question: "What is the biggest difference between Gyroscope and Murph?",
      },
      {
        answer:
          "No. Gyroscope is iPhone-first and supports Apple Watch plus a web dashboard, but its official product material does not offer an Android app. That platform limitation is important for Android users.",
        question: "Is Gyroscope available on Android?",
      },
      {
        answer:
          "Gyroscope has a direct Oura connection. WHOOP is not direct: it reaches Gyroscope through Apple Health, which omits WHOOP HRV, Strain, Recovery, and full sleep-stage detail. Apple Watch, Garmin, Fitbit, Dexcom, and other sources are also marketed, but each metric can take a different route. If WHOOP's proprietary scores are the reason you use WHOOP, keep the WHOOP app and verify exactly what Gyroscope receives.",
        question: "Which wearables work with Gyroscope?",
      },
    ],
    headline: "Health conversation or visual dashboard?",
    lastVerified: "2026-08-31",
    metaDescription:
      "Gyroscope is an iPhone-first visual dashboard with AI and optional human coaching; Murph is a personal health assistant centered on conversation and follow-through.",
    name: "Gyroscope",
    quickComparison: [
      {
        capability: "Visual health dashboard",
        competitor: "yes",
        evidence: "format",
        murph: "yes",
      },
      {
        capability: "Daily health score",
        competitor: "yes",
        evidence: "insightStyle",
        murph: "no",
      },
      {
        capability: "Photo based food logging",
        competitor: "yes",
        evidence: "format",
        murph: "yes",
      },
      {
        capability: "Human health coaching",
        competitor: "limited",
        evidence: "followThrough",
        murph: "no",
      },
      {
        capability: "Ongoing assistant conversation",
        competitor: "limited",
        evidence: "insightStyle",
        murph: "yes",
      },
      {
        capability: "Free start without a card",
        competitor: "yes",
        evidence: "pricing",
        murph: "yes",
      },
      {
        capability: "Reminders and check ins",
        competitor: "limited",
        evidence: "followThrough",
        murph: "yes",
      },
      {
        capability: "Handles health errands",
        competitor: "no",
        evidence: "followThrough",
        murph: "yes",
      },
      {
        capability: "Tests what works for you",
        competitor: "no",
        evidence: "followThrough",
        murph: "yes",
      },
      {
        capability: "Open source option",
        competitor: "no",
        evidence: "platforms",
        murph: "yes",
      },
    ],
    relationship: "alternative",
    slug: "gyroscope",
    sources: [
      {
        label: "Gyroscope product overview",
        url: "https://gyrosco.pe/",
      },
      {
        label: "Gyroscope products and memberships",
        url: "https://gyrosco.pe/products/",
      },
      {
        label: "Gyroscope Daily Report",
        url: "https://gyrosco.pe/features/daily-report/",
      },
      {
        label: "Gyroscope WHOOP integration",
        url: "https://gyrosco.pe/integrations/whoop/",
      },
      {
        label: "Gyroscope terms and health disclaimers",
        url: "https://gyrosco.pe/terms/",
      },
    ],
    tradeoffs: [
      "Gyroscope is more purpose-built for people motivated by visual scores, photo food logs, and optional human accountability. Murph does not reproduce that dashboard or human-coaching program.",
      "Gyroscope's consumer app is limited to Apple's mobile ecosystem, while Murph does not require a proprietary device and also provides a web experience.",
      "Basic is limited to 30 days of storage and five daily tokens. One costs $1 per day and Max costs $3 to $8 per day, with higher token and storage allowances and human coaching available only through Max.",
      "WHOOP data reaches Gyroscope indirectly through Apple Health and omits WHOOP HRV, Strain, Recovery, and full sleep-stage detail.",
      "Gyroscope's terms say AI responses may be inaccurate, outdated, or inappropriate for an individual's situation, and that its Health Score is an estimate rather than a clinical diagnosis.",
      "Murph keeps explanation and follow-up in conversation, which may suit people who tire of dashboards; people who enjoy inspecting a designed daily report may prefer Gyroscope's format.",
    ],
  },
  {
    category: "health-data",
    chooseCompetitor:
      "Choose Welltory if camera or wearable HRV readings, stress and energy scores, sleep and workout reports, and automated measurement-led recommendations are the experience you want.",
    chooseMurph:
      "Choose Murph if an HRV or recovery signal usually leads to a wider question about symptoms, meals, training, labs, records, or daily life, and you want the discussion to continue into an experiment or check-in.",
    competitor: {
      clinicalRole:
        "A consumer wellness analytics app focused on HRV, stress, energy, recovery, sleep, and activity. Welltory states that it is not a medical app.",
      followThrough:
        "Lifestyle recommendations, breathing and measurement routines, personal experiments, activity guidance, automated health reports, and an experimental AI Coach delivered through ChatGPT.",
      format:
        "iOS and Android apps built around HRV readings, a data feed, charts, and automated reports; the experimental AI Coach runs through ChatGPT rather than as the app's main interface.",
      hardware:
        "A phone camera can take HRV readings. Apple Watch, Samsung Watch, Pixel Watch 2 or later, and compatible Bluetooth heart-rate monitors can provide HRV measurements; many other trackers contribute activity data only.",
      inputs:
        "HRV, heart rate, blood pressure, sleep, workouts, activity, weight, body measurements, lifestyle factors, weather, and data from supported apps and devices.",
      insightStyle:
        "HRV-derived wellness scores plus sleep, activity, workout, and personalized reports, with names and availability differing by platform. The separate ChatGPT-based AI Coach is an experimental beta, and personalized data access requires Welltory Premium plus ChatGPT Plus.",
      platforms:
        "iOS 16 or later and Android 9 or later. Welltory recommends using one phone platform because using the same account across both can make reports inaccurate; features and device routes also differ by ecosystem.",
      pricing:
        "Welltory lists Premium at $99 billed annually or $599 lifetime. In the free tier, feed data older than 30 days is deleted. Full AI Coach access to personal Welltory data also requires ChatGPT Plus.",
      primaryJob:
        "Translate HRV and connected wellness signals into understandable daily stress, energy, recovery, and lifestyle feedback.",
    },
    competitorEvidence: {
      clinicalRole: [3, 5],
      followThrough: [1, 2, 5],
      format: [2, 4, 5],
      hardware: [2, 3, 4],
      inputs: [2, 3],
      insightStyle: [2, 5],
      platforms: [4],
      pricing: [1, 2, 5],
      primaryJob: [2],
    },
    faqs: [
      {
        answer:
          "Welltory is stronger when you want the measurement routine itself: HRV readings become scores, reports, and automated guidance. Murph is stronger when an existing signal raises a wider question and you want the answer to carry into a decision and later follow-up.",
        question: "How is Welltory different from Murph?",
      },
      {
        answer:
          "No. Welltory explicitly says it is not a medical app. Its stress, energy, and recovery feedback is intended for wellness and self-understanding, not diagnosis or treatment.",
        question: "Is Welltory a medical app?",
      },
      {
        answer:
          "Welltory receives data through Apple Health, Health Connect, and Samsung Health and documents direct routes for services including Fitbit, Garmin, Oura, Withings, and Strava. Its current direct-connection table does not list WHOOP, so WHOOP users should verify the indirect route and exact fields. Welltory also warns against connecting the same source both directly and through an aggregator because that can create duplicate data.",
        question: "What can Welltory connect to?",
      },
    ],
    headline: "Ongoing assistant or HRV analytics?",
    lastVerified: "2026-08-31",
    metaDescription:
      "Welltory turns HRV and connected signals into wellness scores; Murph is a personal health assistant helping place those signals in context and decide what comes next.",
    name: "Welltory",
    quickComparison: [
      {
        capability: "HRV measurements",
        competitor: "yes",
        evidence: "hardware",
        murph: "connected",
      },
      {
        capability: "Stress and energy scores",
        competitor: "yes",
        evidence: "insightStyle",
        murph: "connected",
      },
      {
        capability: "Automated wellness reports",
        competitor: "yes",
        evidence: "insightStyle",
        murph: "yes",
      },
      {
        capability: "Ongoing assistant conversation",
        competitor: "limited",
        evidence: "insightStyle",
        murph: "yes",
      },
      {
        capability: "Personal health experiments",
        competitor: "yes",
        evidence: "followThrough",
        murph: "yes",
      },
      {
        capability: "Free start without a card",
        competitor: "yes",
        evidence: "pricing",
        murph: "yes",
      },
      {
        capability: "Wearable and lab context",
        competitor: "limited",
        evidence: "inputs",
        murph: "yes",
      },
      {
        capability: "Reminders and check ins",
        competitor: "limited",
        evidence: "followThrough",
        murph: "yes",
      },
      {
        capability: "Handles health errands",
        competitor: "no",
        evidence: "followThrough",
        murph: "yes",
      },
      {
        capability: "Open source option",
        competitor: "no",
        evidence: "platforms",
        murph: "yes",
      },
    ],
    relationship: "alternative",
    slug: "welltory",
    sources: [
      {
        label: "Welltory plans",
        url: "https://welltory.com/plans/",
      },
      {
        label: "Welltory Premium guidance and analytics",
        url: "https://help.welltory.com/en/articles/4007331-welltory-premium-personalized-guidance-habit-analytics-and-so-much-more",
      },
      {
        label: "Welltory data sources",
        url: "https://help.welltory.com/en/articles/11130907-data-sources-and-how-to-connect-them",
      },
      {
        label: "Welltory getting started guide",
        url: "https://help.welltory.com/en/articles/11093263-getting-started-with-welltory",
      },
      {
        label: "Welltory AI Coach",
        url: "https://help.welltory.com/en/articles/8727843-how-to-use-welltory-ai-coach",
      },
    ],
    tradeoffs: [
      "Welltory is more purpose-built for repeated HRV measurements and automated stress and energy scores. Murph should not be chosen for a comparable scoring engine.",
      "Welltory's specialization can be useful for wellness trends, but its scores are not medical diagnoses.",
      "Welltory says free-tier feed data older than 30 days is deleted, while personalized AI Coach access is experimental and requires both Welltory Premium and ChatGPT Plus.",
      "Phone ecosystems and connection routes differ, and sending the same metric through multiple sources can create duplicates.",
      "Murph can discuss a wider mix of context and maintain follow-up, but users who mainly want a fast measurement ritual and automatic score may prefer Welltory's narrower workflow.",
    ],
  },
  {
    aliases: ["Fitness Syncer"],
    category: "health-data",
    chooseCompetitor:
      "Choose FitnessSyncer if you need read and write routes among fitness services, archival history, or custom charts assembled from many supported sources.",
    chooseMurph:
      "Choose Murph if the data is already accessible and the unresolved job is asking questions across it, weighing a practical next step, and returning to that step through reminders or check-ins.",
    competitor: {
      clinicalRole:
        "A consumer service for consolidating, viewing, archiving, and synchronizing fitness and wellness data across supported systems.",
      followThrough:
        "On-demand or scheduled synchronization, goals, alerts, email reports, calendar export, sharing, leaderboards, archival storage, and a personal notebook; some capabilities require Pro.",
      format:
        "A web and mobile data hub with a unified stream, dashboards, custom charts, sync rules, archive tools, and Daily Analyzer.",
      hardware:
        "No proprietary hardware is required. Its purpose is to connect supported apps, platforms, and devices that users already have.",
      inputs:
        "Activity, workouts, routes, sleep, weight, nutrition, glucose, blood pressure, and other fields from more than 50 supported services, subject to source-specific permissions.",
      insightStyle:
        "Dashboards, custom visualizations, comparisons, and rule-based analysis. An MCP server can expose data to external AI clients, but FitnessSyncer is not itself a native conversational coach.",
      platforms:
        "Web, iOS, and Android.",
      pricing:
        "The free plan supports five sources or tasks, once-daily synchronization, one non-customizable dashboard, and 6 to 8 weeks of dashboard data. Pro costs $4.99 per month or $49.99 per year and adds unlimited sources, tasks, and dashboard history.",
      primaryJob:
        "Synchronize and consolidate fitness data across services that do not reliably exchange it on their own.",
    },
    competitorEvidence: {
      clinicalRole: [1],
      followThrough: [1, 3],
      format: [1, 3, 5],
      hardware: [2],
      inputs: [2],
      insightStyle: [1, 4],
      platforms: [1, 5],
      pricing: [3],
      primaryJob: [1, 2],
    },
    faqs: [
      {
        answer:
          "FitnessSyncer and Murph solve adjacent jobs rather than substituting for one another. FitnessSyncer moves and charts supported data; Murph helps interpret available context and carry a decision forward. This page does not claim that Murph replaces sync routes or that the products connect directly.",
        question: "Is FitnessSyncer an alternative to Murph?",
      },
      {
        answer:
          "FitnessSyncer lists more than 50 services, including Apple Health, Health Connect, Fitbit, Garmin, Oura, WHOOP, Withings, Samsung Health, Strava, Suunto, Polar, and Dexcom. Read and write support differs by service and metric. For example, its current WHOOP row is read-only and limited to activity, oxygen, and sleep, so every intended direction and field should be checked first.",
        question: "Which services can FitnessSyncer synchronize?",
      },
      {
        answer:
          "The documented chat experience runs in a separately configured AI assistant. FitnessSyncer's MCP server can let compatible clients such as ChatGPT, Claude, or Perplexity read and, when authorized, update selected FitnessSyncer data. It requires separate setup and is not a built-in FitnessSyncer coach.",
        question: "Does FitnessSyncer include an AI coach?",
      },
    ],
    headline: "Understand health data or move it between apps?",
    lastVerified: "2026-08-31",
    metaDescription:
      "FitnessSyncer moves and charts data across fitness services; Murph is a personal health assistant designed to interpret context and carry a decision forward.",
    name: "FitnessSyncer",
    quickComparison: [
      {
        capability: "Cross service data syncing",
        competitor: "yes",
        evidence: "primaryJob",
        murph: "limited",
      },
      {
        capability: "Archival data history",
        competitor: "limited",
        evidence: "followThrough",
        murph: "yes",
      },
      {
        capability: "Custom health dashboards",
        competitor: "limited",
        evidence: "format",
        murph: "limited",
      },
      {
        capability: "Native assistant conversation",
        competitor: "no",
        evidence: "insightStyle",
        murph: "yes",
      },
      {
        capability: "Optional group support",
        competitor: "yes",
        evidence: "followThrough",
        murph: "yes",
      },
      {
        capability: "Free start without a card",
        competitor: "yes",
        evidence: "pricing",
        murph: "yes",
      },
      {
        capability: "Reminders and check ins",
        competitor: "limited",
        evidence: "followThrough",
        murph: "yes",
      },
      {
        capability: "Handles health errands",
        competitor: "no",
        evidence: "followThrough",
        murph: "yes",
      },
      {
        capability: "Tests what works for you",
        competitor: "no",
        evidence: "followThrough",
        murph: "yes",
      },
      {
        capability: "Open source option",
        competitor: "no",
        evidence: "platforms",
        murph: "yes",
      },
    ],
    relationship: "different-role",
    slug: "fitnesssyncer",
    sources: [
      {
        label: "FitnessSyncer overview",
        url: "https://www.fitnesssyncer.com/support/fitnesssyncer-overview",
      },
      {
        label: "FitnessSyncer supported apps and services",
        url: "https://www.fitnesssyncer.com/support/supported-apps-and-services",
      },
      {
        label: "FitnessSyncer Pro pricing",
        url: "https://www.fitnesssyncer.com/go-pro",
      },
      {
        label: "FitnessSyncer MCP server",
        url: "https://www.fitnesssyncer.com/support/mcp-server",
      },
      {
        label: "FitnessSyncer downloads",
        url: "https://www.fitnesssyncer.com/downloads",
      },
    ],
    tradeoffs: [
      "FitnessSyncer has unusually broad service coverage and offers sync capabilities Murph does not. Each provider still controls which fields can be read or written.",
      "Configuring sources, destinations, duplicate handling, and metric-specific routes is part of getting value from a sync utility; Murph is not a shortcut around that work.",
      "FitnessSyncer's emphasis is fitness and wellness data routing, not clinical-record retrieval or longitudinal coaching.",
      "Its MCP server is a bridge to compatible third-party AI software rather than a native assistant inside FitnessSyncer. Murph integrates the conversation, but is not a replacement for the bridge's data portability.",
    ],
  },
  {
    aliases: ["Heads Up"],
    category: "health-data",
    chooseCompetitor:
      "Choose Heads Up Health if clinicians need unified client charts, lab and wearable integrations, cohort reporting, alerts, pre-visit briefs, and communication workflows across a practice.",
    chooseMurph:
      "Choose Murph if you are an individual who wants to discuss personal health context in familiar messaging and carry decisions into reminders, check-ins, or experiments, without buying or operating a clinic platform.",
    competitor: {
      clinicalRole:
        "A business-to-business clinical intelligence and client-management platform for health practices.",
      followThrough:
        "Targeted alerts, messaging and notifications, automated pre-visit briefs, client-facing reports, outcome tracking, and practice-level AI workflows.",
      format:
        "A clinician web workspace with unified client charts, lab and wearable dashboards, AI tools, cohort views, reports, and companion client apps.",
      hardware:
        "The software aggregates data from supported wearables, labs, EHR connections, diagnostic PDFs, and medical records rather than relying on a Heads Up sensor.",
      inputs:
        "Labs and diagnostic PDFs, supported wearable and device data, EHR and medical records, notes, journals and symptoms, medications and supplements, assessments, and activity and nutrition data.",
      insightStyle:
        "Natural-language queries, chart summaries, pre-visit briefs, biomarker trends, health scores, alerts, cohort analysis, and configurable AI workflows.",
      platforms:
        "A clinician web platform plus iOS, Android, and web experiences for clients of participating practices.",
      pricing:
        "Current clinic pricing starts at $250 per month for Professional with 40 clients and $1,000 onboarding. Premier starts at $1,000 per month for 100 clients and $3,500 onboarding. Additional clients and AI usage can add cost.",
      primaryJob:
        "Give health practices a unified longitudinal record and intelligence layer across their entire client population.",
    },
    competitorEvidence: {
      clinicalRole: [1],
      followThrough: [1, 2],
      format: [1, 2],
      hardware: [1, 3],
      inputs: [1, 2, 3],
      insightStyle: [1, 2],
      platforms: [2],
      pricing: [2],
      primaryJob: [1],
    },
    faqs: [
      {
        answer:
          "The current primary Heads Up product is clinic software, not a self-service consumer assistant. The site separately links a Heads Up Legacy app and an older consumer dashboard page. Those legacy plans should not be assumed to include the current clinic platform, AI package, or practice workflows.",
        question: "Is Heads Up Health a consumer app like Murph?",
      },
      {
        answer:
          "As of July 1, 2026 pricing, Professional starts at $250 monthly for 40 clients plus a $1,000 onboarding fee, and Premier starts at $1,000 monthly for 100 clients plus a $3,500 onboarding fee. Extra clients and AI tokens are billed separately under the published schedule.",
        question: "How much does Heads Up Health cost?",
      },
      {
        answer:
          "The live legacy page advertises $9 monthly, $79 yearly, or $199 lifetime for its consumer dashboard. The current pricing page instead sells clinic packages with required onboarding, client limits, and usage charges. The two price sets describe distinct product generations and should always be labeled accordingly.",
        question: "Why do some Heads Up Health pages show consumer pricing?",
      },
    ],
    headline: "Personal assistant or clinic platform?",
    lastVerified: "2026-08-31",
    metaDescription:
      "Heads Up Health is clinical-intelligence software for practices; Murph is a personal health assistant supporting one individual's ongoing conversation and follow-through.",
    name: "Heads Up Health",
    quickComparison: [
      {
        capability: "Individual self service",
        competitor: "limited",
        evidence: "clinicalRole",
        murph: "yes",
      },
      {
        capability: "Multi client practice workspace",
        competitor: "yes",
        evidence: "format",
        murph: "no",
      },
      {
        capability: "Cohort reporting and alerts",
        competitor: "yes",
        evidence: "insightStyle",
        murph: "no",
      },
      {
        capability: "Clinician workflow tools",
        competitor: "yes",
        evidence: "followThrough",
        murph: "no",
      },
      {
        capability: "Self service AI conversation",
        competitor: "no",
        evidence: "insightStyle",
        murph: "yes",
      },
      {
        capability: "Wearable and lab context",
        competitor: "yes",
        evidence: "inputs",
        murph: "yes",
      },
      {
        capability: "Free start without a card",
        competitor: "no",
        evidence: "pricing",
        murph: "yes",
      },
      {
        capability: "Tests what works for you",
        competitor: "limited",
        evidence: "followThrough",
        murph: "yes",
      },
      {
        capability: "Handles health errands",
        competitor: "no",
        evidence: "followThrough",
        murph: "yes",
      },
      {
        capability: "Open source option",
        competitor: "no",
        evidence: "platforms",
        murph: "yes",
      },
    ],
    relationship: "different-role",
    slug: "heads-up-health",
    sources: [
      {
        label: "Heads Up Health clinical intelligence platform",
        url: "https://headsuphealth.com/",
      },
      {
        label: "Heads Up Health clinic pricing",
        url: "https://headsuphealth.com/pricing-packages/",
      },
      {
        label: "Heads Up Health integrations",
        url: "https://headsuphealth.com/integrations/",
      },
      {
        label: "Heads Up Health legacy consumer dashboard",
        url: "https://headsuphealth.com/ultimate-fitness-dashboard/",
      },
    ],
    tradeoffs: [
      "Heads Up Health offers multi-client clinical and practice workflows that Murph does not. Its current packages are consequently priced and configured for practices rather than individual self-service use.",
      "Setup includes onboarding, client limits, and potential AI usage charges that are not comparable to a simple consumer subscription.",
      "Legacy consumer pages remain accessible, so buyers need to distinguish old dashboard plans from the current clinic platform.",
      "Murph is the more direct fit for an individual's conversation and follow-up, but it should not be used in place of a practice's chart, cohort, alerting, or clinician workflow system.",
    ],
  },
  {
    aliases: ["CommonHealth App"],
    category: "health-data",
    chooseCompetitor:
      "Choose CommonHealth if the job is downloading records from participating providers, storing and exporting health cards, or sharing a protected patient summary from Android.",
    chooseMurph:
      "Choose Murph if access is not the end of the job and you want to discuss records alongside labs, wearables, symptoms, meals, or workouts, then turn the discussion into a plan or follow-up.",
    competitor: {
      clinicalRole:
        "A nonprofit consumer health-record wallet. The Commons Project says it does not provide medical advice or administer diagnostic tests, vaccinations, or other healthcare interventions.",
      followThrough:
        "Provider-record retrieval, encrypted on-device storage, SMART Health Card storage and export, data export, sharing with approved apps or providers, and a temporary passcode-protected Patient Summary.",
      format:
        "An Android record wallet with provider connections, SMART Health Cards, record export, and user-directed sharing. Patient Summaries can be shared through a protected QR code or link.",
      hardware:
        "No proprietary hardware is needed, but a compatible Android device is required for the consumer app.",
      inputs:
        "Copies of electronic health records from supported provider systems, plus SMART Health Cards.",
      insightStyle:
        "Record organization and access rather than analysis. CommonHealth's official product materials do not describe AI coaching, correlation analysis, or lifestyle recommendations.",
      platforms:
        "Android only for the CommonHealth consumer app.",
      pricing:
        "Free. CommonHealth is developed by the nonprofit Commons Project Foundation.",
      primaryJob:
        "Put portable copies of a consumer's clinical records and verifiable health cards under that consumer's control.",
    },
    competitorEvidence: {
      clinicalRole: [1, 2],
      followThrough: [1, 2, 3, 4],
      format: [2, 3, 4],
      hardware: [2, 3],
      inputs: [2, 3],
      insightStyle: [1, 2, 3],
      platforms: [2],
      pricing: [2],
      primaryJob: [1, 2],
    },
    faqs: [
      {
        answer:
          "CommonHealth gives eligible Android users possession and portability of participating-provider records and SMART Health Cards. Its official materials focus on access, organization, and sharing. Murph addresses the later interpretive step: discussing authorized health context and continuing with a decision. No direct product connection is claimed.",
        question: "What is the difference between CommonHealth and Murph?",
      },
      {
        answer:
          "No. The consumer CommonHealth app is available for Android, and its official material does not offer an iPhone version. Apple users would need a different record-wallet option.",
        question: "Is CommonHealth available on iPhone?",
      },
      {
        answer:
          "CommonHealth advertises connections to more than 400 data sources through provider portals and health-data standards. Actual record availability depends on whether a provider participates and which record types it exposes.",
        question: "Which medical records can CommonHealth collect?",
      },
    ],
    headline: "Health assistant or Android record wallet?",
    lastVerified: "2026-08-31",
    metaDescription:
      "CommonHealth is a free Android wallet for provider records and health cards; Murph is a personal health assistant for discussing authorized context and next steps.",
    name: "CommonHealth",
    quickComparison: [
      {
        capability: "Participating provider retrieval",
        competitor: "yes",
        evidence: "followThrough",
        murph: "yes",
      },
      {
        capability: "Verifiable health card storage",
        competitor: "yes",
        evidence: "followThrough",
        murph: "no",
      },
      {
        capability: "Protected record sharing",
        competitor: "yes",
        evidence: "followThrough",
        murph: "limited",
      },
      {
        capability: "Interprets records and patterns",
        competitor: "no",
        evidence: "insightStyle",
        murph: "yes",
      },
      {
        capability: "Wearable and lifestyle context",
        competitor: "no",
        evidence: "inputs",
        murph: "yes",
      },
      {
        capability: "Free start without a card",
        competitor: "yes",
        evidence: "pricing",
        murph: "yes",
      },
      {
        capability: "Works in iMessage or Telegram",
        competitor: "no",
        evidence: "format",
        murph: "yes",
      },
      {
        capability: "Reminders and check ins",
        competitor: "no",
        evidence: "followThrough",
        murph: "yes",
      },
      {
        capability: "Handles health errands",
        competitor: "no",
        evidence: "followThrough",
        murph: "yes",
      },
      {
        capability: "Handles changing priorities",
        competitor: "limited",
        evidence: "primaryJob",
        murph: "yes",
      },
    ],
    relationship: "different-role",
    slug: "commonhealth",
    sources: [
      {
        label: "Commons Project CommonHealth app",
        url: "https://www.thecommonsproject.org/commonhealth-app",
      },
      {
        label: "CommonHealth frequently asked questions",
        url: "https://www.commonhealth.org/faqs",
      },
      {
        label: "CommonHealth Google Play listing",
        url: "https://play.google.com/store/apps/details?id=org.thecommonsproject.android.phr",
      },
      {
        label: "CommonHealth terms of use",
        url: "https://www.commonhealth.org/terms",
      },
    ],
    tradeoffs: [
      "CommonHealth is free and purpose-built for portable clinical records and SMART Health Cards. Murph should not be chosen as a substitute for that record-wallet workflow.",
      "The consumer app is Android-only, and its terms limit the service to US residents age 18 or older.",
      "Record coverage depends on provider participation and the data each connected source makes available.",
      "CommonHealth says records normally stay encrypted on the device, but an encrypted Patient Summary can remain in its AWS cloud for up to 72 hours when a user chooses to share one.",
      "CommonHealth's terms say user-controlled information in the app is not covered by HIPAA, leaving the user responsible for the privacy and security of information they store and share.",
      "CommonHealth's official materials focus on access and organization rather than analysis or coaching, which may suit someone who wants a simple wallet. Murph adds conversation and follow-up, but that is a different product commitment.",
    ],
  },
]);
