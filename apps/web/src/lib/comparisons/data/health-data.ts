import { defineComparisons } from "../types";

export const HEALTH_DATA_COMPARISONS = defineComparisons([
  {
    aliases: ["Guava Health"],
    category: "health-data",
    chooseCompetitor:
      "Choose Guava if you mainly want provider records pulled in and a medication and symptom history kept in order. It also gives you correlation charts, a packet for your next visit, and an assistant that can search and analyze what Guava holds.",
    chooseMurph:
      "Choose Murph if you want to ask plain questions about your records, labs, sleep data, and meals and get a straight answer. Murph then sets reminders, checks in, and can run a short experiment to see what helps.",
    competitor: {
      clinicalRole:
        "Guava is a consumer personal health record and tracker. It organizes health information. It does not replace a licensed clinician or emergency care.",
      followThrough:
        "Guava keeps structured medication and symptom logs and sends reminders. It also offers goals, visit preparation, controlled sharing, and a Premium Emergency Card.",
      format:
        "Guava's mobile and web apps hold a health timeline, a record library, trackers, charts, correlations, and an assistant.",
      hardware:
        "No special device is needed. Data can come from connected patient portals, apps, wearables, and glucose monitors.",
      inputs:
        "Guava takes in medical records, labs, imaging documents, medications, symptoms, food, mood, menstrual cycle, activity, sleep, and data from connected devices.",
      insightStyle:
        "Charts and correlations sit next to an AI assistant. The assistant can log entries and reminders, search and analyze your Guava data, answer questions about your history, help you find features, and prepare for visits. Guava warns that its generative AI is not always perfect.",
      platforms:
        "Guava runs on iOS, Android, and the web, including a progressive web app.",
      pricing:
        "There is a free plan. Guava Premium is listed at $8 per month or $78 per year.",
      primaryJob:
        "Guava brings clinical records and everyday health tracking into one health profile that you control.",
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
          "Guava is built around the record: it retrieves, organizes, tracks, and shares your health information, and its assistant works with the data stored in Guava. Murph is built around a conversation in iMessage or Telegram, backed by a records vault. It turns what you learn into plans, reminders, and check-ins.",
        question: "What is the difference between Murph and Guava?",
      },
      {
        answer:
          "Guava lists MyChart, CommonWell, Medicare, Veterans Affairs, athenahealth, and Healow, plus Apple Health, Health Connect, Fitbit, Garmin, Oura, WHOOP, Withings, and Dexcom. The direct Connect Provider feature is US only, but people elsewhere can still upload documents and use the other sources. Check the exact provider, metric, and route you need.",
        question: "What data sources does Guava support?",
      },
      {
        answer:
          "Yes, there is a free plan. It includes portal and device sync, tracking, summaries and correlations, sharing, and uploads. Premium costs $8 per month or $78 per year and adds automatic insights, the Guava Assistant AI, automatic lab extraction, family profile managers, photo food analysis, and an Emergency Card.",
        question: "Is Guava free?",
      },
    ],
    headline:
      "Guava organizes your records. Murph stores them and explains them.",
    lastVerified: "2026-08-31",
    metaDescription:
      "Guava builds a health record from patient portals, devices, and logs. Murph is a personal health assistant that also imports records, then explains them and follows up over chat.",
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
      "Guava is built for pulling in provider records and putting together a packet for a visit. Murph imports records and keeps them in a vault, but Guava is the more complete tool for a shareable visit packet.",
      "Guava's structured logs give you a consistent history if you keep them current. That means you have to keep entering data.",
      "Guava's direct Connect Provider feature works only with US providers. Guava says people elsewhere can still upload records and enter information by hand.",
      "Murph puts explanation, reminders, and check-ins first. If you want charts, documents, and shareable summaries front and center, Guava is the better fit.",
      "Guava's assistant, automatic insights, lab extraction, family profile managers, photo food analysis, and Emergency Card all require Premium.",
    ],
  },
  {
    category: "health-data",
    chooseCompetitor:
      "Choose CareClinic if you want to record symptoms, medications, mood, sleep, nutrition, activity, and care-plan adherence on a set schedule. It is especially useful if you need reports to bring to appointments.",
    chooseMurph:
      "Choose Murph if you would rather talk than keep a diary, and ask how your symptoms, sleep, meals, labs, and records fit together. Murph then sends the reminders and check-ins that go with whatever you decide.",
    competitor: {
      clinicalRole:
        "CareClinic is a consumer self-management app for recording and organizing symptoms, medications, routines, and other health information. Its terms say it does not provide medical advice, diagnosis, or treatment and is not a clinical system.",
      followThrough:
        "CareClinic offers reminders, care plans, recurring check-ins, caregiver participation, goals, adherence tracking, and reports for appointments.",
      format:
        "CareClinic is a configurable mobile diary with trackers, schedules, correlations, assessments, reports, and caregiver features.",
      hardware:
        "No special hardware is required. Phone and wearable health platforms can supply selected measurements.",
      inputs:
        "CareClinic records symptoms, medications, treatments, mood, sleep, nutrition, activity, vitals, menstrual cycle, notes, documents, and data from supported health platforms.",
      insightStyle:
        "CareClinic's product pages advertise AI-powered pattern detection and personalized recommendations next to charts and correlations. Its terms limit those insights to informational self-management and say the tools do not perform clinical analysis.",
      platforms:
        "CareClinic runs on iOS, Android, and Apple Watch. It also documents a limited legacy web interface for basic logging.",
      pricing:
        "A free version with core features is available. Premium adds advanced analytics, PDF reports, caregiver sharing, and more integrations, sold as monthly, annual, or lifetime plans. The cited pages do not publish current amounts, so confirm the price at checkout.",
      primaryJob:
        "CareClinic helps a person document symptoms, treatments, behaviors, and outcomes in a consistent condition-management routine.",
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
          "CareClinic is a structured self-management system: you log the day, follow a care plan, review adherence, and export a report. Murph is led by conversation: you bring a question or a choice you are weighing, and Murph connects it to the data you have authorized. The work then continues as a plan with reminders and check-ins.",
        question: "How is CareClinic different from Murph?",
      },
      {
        answer:
          "CareClinic documents connections to Apple Health, Google Fit or Health Connect, Fitbit, and Apple Watch. Its integrations page advertises Garmin, Oura, WHOOP, and Dexcom, but the FAQ on the same page says direct integrations for those four are still coming soon. Check that a route you can use today covers the fields you need before picking CareClinic for one of those devices.",
        question: "Which devices and health apps work with CareClinic?",
      },
      {
        answer:
          "CareClinic is mainly a mobile product. Its support center describes a legacy web interface for basic diary entries. The full experience and newer features live in the iOS and Android apps.",
        question: "Does CareClinic have a web version?",
      },
    ],
    headline:
      "CareClinic tracks your condition day by day. Murph explains and follows up.",
    lastVerified: "2026-08-31",
    metaDescription:
      "CareClinic is a condition diary with reminders, care plans, and appointment reports. Murph is a personal health assistant that explains your health data and checks in by chat.",
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
      "CareClinic has more purpose-built symptom scales, schedules, adherence views, and appointment reports. Murph does not replace a carefully set up condition journal.",
      "CareClinic's structured history is valuable when details matter, but building it can take a lot of daily input.",
      "The mobile apps hold the full experience. Desktop access is documented as a limited legacy interface.",
      "CareClinic's integrations page contradicts itself about whether direct Garmin, Oura, WHOOP, and Dexcom connections are live or coming soon. Check the exact device and metric before relying on one of those routes.",
      "CareClinic documents monthly, annual, and lifetime Premium plans, but the cited pages do not publish stable current amounts. Confirm the final price at checkout.",
    ],
  },
  {
    category: "health-data",
    chooseCompetitor:
      "Pick Bearable if you want to decide exactly what to rate each day and log it quickly. Its charts show how symptoms move alongside medications, routines, and other factors over time.",
    chooseMurph:
      "Choose Murph if you want to ask why a pattern might matter, using sleep data, meals, labs, and records as well as symptoms. The answer leads to a plan, a short experiment, a reminder, or a check-in.",
    competitor: {
      clinicalRole:
        "Bearable is a consumer symptom and wellbeing tracker, often used for chronic illness, pain, fatigue, mood, and self-management. It is not a medical record system or a clinician.",
      followThrough:
        "Bearable offers daily check-ins, medication and routine reminders, goals, experiments, reports, and data export.",
      format:
        "Bearable is a customizable mobile tracker with a daily timeline, symptom and factor ratings, charts, correlations, and experiment tools.",
      hardware:
        "No special hardware is needed. Bearable reads selected connected data through Health Connect on Android and Apple Health on iPhone. Fitbit and Google Health data reach it through those hubs.",
      inputs:
        "Bearable tracks symptoms, mood, energy, pain, sleep, medications, nutrition, habits, events, menstrual cycle, custom factors, and connected health data.",
      insightStyle:
        "Correlation and trend views compare symptoms with treatments, habits, and other factors. Bearable's current official support material points users to CSV export for analysis in outside AI tools rather than describing a built-in AI assistant.",
      platforms:
        "Bearable runs on iOS and Android phones and tablets. There is no full web or desktop app, and Bearable advises using one device at a time to avoid conflicts or data loss.",
      pricing:
        "Most features are free. Bearable's pricing page lists Premium at $6.99 per month or $34.99 per year and says the annual price is often discounted to $18.99.",
      primaryJob:
        "Bearable makes daily symptom and lifestyle tracking flexible enough to show possible personal patterns.",
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
          "Bearable helps you build and inspect a structured dataset of what you report each day. Murph helps you talk through a health question using the data you have authorized, then carries the conclusion into action. Bearable suits people for whom the tracker itself is the job, and Murph suits interpretation and follow-up, with or without a tracking history.",
        question: "What is the difference between Bearable and Murph?",
      },
      {
        answer:
          "Bearable's current official pages do not describe a built-in AI coach. They describe charts, correlations, goals, and experiments, and Bearable's support material suggests exporting CSV data to an outside AI tool such as ChatGPT. Murph is different because the ongoing assistant conversation is the product.",
        question: "Does Bearable have an AI health coach?",
      },
      {
        answer:
          "Yes, through the phone's health hub. Bearable reads selected data through Health Connect on Android and Apple Health on iPhone, and Fitbit and Google Health data go through those hubs. Fitbit data may currently be unavailable to Bearable on iPhone because Google Health does not yet write it into Apple Health.",
        question: "Can Bearable import wearable data?",
      },
    ],
    headline:
      "Bearable tracks symptoms in detail. Murph explains patterns and follows up.",
    lastVerified: "2026-08-31",
    metaDescription:
      "Bearable turns daily symptom ratings into correlation charts. Murph is a personal health assistant that explains patterns across sleep, meals, labs, and records, then follows up by chat.",
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
      "Bearable is finer grained and built for repeatable symptom scoring. Murph does not offer the same configurable tracker screens or correlation charts.",
      "Useful Bearable correlations depend on consistent self-reporting. An association can raise a question without proving what caused a symptom.",
      "Bearable's current official pages center on user-entered and mobile-hub data. They do not document patient portal retrieval or a built-in assistant conversation.",
      "There is no full Bearable desktop or web app. Connected metrics vary by mobile health platform, and Fitbit data may not currently reach Bearable on iPhone.",
      "Bearable advises using one device at a time because using two at once can cause conflicts or data loss.",
    ],
  },
  {
    aliases: ["Exist.io"],
    category: "health-data",
    chooseCompetitor:
      "Choose Exist if you like running a quantified-self setup with many integrations. It gives you custom attributes, daily and weekly summaries, and standard statistical correlations across health and non-health data.",
    chooseMurph:
      "Choose Murph if you would rather ask a health question in a chat and look at records, labs, wearable data, symptoms, meals, and workouts together. Murph turns the answer into a short experiment, a reminder, or a check-in.",
    competitor: {
      clinicalRole:
        "Exist is a consumer quantified-self analytics service focused on personal trends and correlations. Its official materials do not present it as clinical care.",
      followThrough:
        "Exist offers daily insights, weekly summaries, mood prompts, custom tracking, and self-directed personal experiments.",
      format:
        "Exist is a full web dashboard with iOS and Android companion apps. It has integration feeds, charts, correlations, and custom attributes.",
      hardware:
        "No special device is required. Exist depends on connected services and manual custom tracking.",
      inputs:
        "Exist takes in activity, sleep, workouts, weight, mood, productivity, tasks, calendar, weather, location, media, social activity, and custom numeric or tagged data.",
      insightStyle:
        "Daily observations and long-term trends sit beside correlations with strength and confidence indicators. Exist says it uses traditional statistics rather than generative AI, and it warns that correlation does not establish cause.",
      platforms:
        "Exist is a full web app with iOS and Android companion apps for mood, custom tracking, and summaries.",
      pricing:
        "Exist is listed at $6.99 per month or $62.90 per year after a 30-day free trial.",
      primaryJob:
        "Exist finds measurable relationships across many parts of a person's digital and physical life.",
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
          "Exist shows what moves together across your connected services and custom attributes. Murph helps you think through a health question and stick with what you decide. Murph is not a more detailed quantified-self dashboard, and Exist is not an open-ended health conversation.",
        question: "How does Exist compare with Murph?",
      },
      {
        answer:
          "No. Exist says it uses traditional statistical analysis rather than generative AI. Its insights come from the attributes you track and the correlations between them, not from an open-ended assistant conversation.",
        question: "Does Exist use generative AI?",
      },
      {
        answer:
          "Exist needs at least three weeks of data for an attribute and recalculates correlations weekly. More overlapping history can improve confidence. Exist itself warns that a correlation cannot establish cause.",
        question: "How long does Exist need before showing correlations?",
      },
    ],
    headline:
      "Exist charts correlations across your life. Murph talks through your health.",
    lastVerified: "2026-08-31",
    metaDescription:
      "Exist finds statistical correlations across sleep, activity, mood, and productivity. Murph is a personal health assistant that explains your health data by chat and follows up.",
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
      "Murph does not reproduce Exist's non-health integrations or its statistics dashboard. If you want to inspect the numbers yourself, Exist's dashboard-first approach may suit you better.",
      "Useful correlations need enough overlapping history. A statistical association is not proof of cause.",
      "Each attribute can use only one source at a time, so you may have to choose when services overlap.",
      "Exist deliberately avoids generative AI. That suits people who prefer a purely statistical interface and frustrates people who want open-ended explanation. Murph takes the opposite approach and makes conversation central.",
      "After the 30-day trial, Exist has one paid plan at $6.99 per month or $62.90 per year. It does not advertise a permanent free tier.",
    ],
  },
  {
    category: "health-data",
    chooseCompetitor:
      "Choose Gyroscope if you want Daily Reports, a Health Score, photo food logging, and location and productivity views built on your iPhone and Apple Watch data. Optional human coaching is available on Max plans.",
    chooseMurph:
      "Choose Murph if you want health help in iMessage or Telegram, not an iPhone-only app. Each chat ends in a plan, reminder, check-in, or errand, though Murph does not offer Gyroscope's Health Score, Food XRAY, or Max human coaching.",
    competitor: {
      clinicalRole:
        "Gyroscope is a consumer wellness dashboard and coaching product. It is not an electronic health record or a substitute for medical diagnosis and treatment.",
      followThrough:
        "Gyroscope offers daily reports, goals, meditations, AI coaching, and optional human coaching on Max plans.",
      format:
        "Gyroscope is an iPhone-first visual dashboard with a Health Score, Daily Reports, timelines, photo food logging, and coaching layers.",
      hardware:
        "No Gyroscope-branded sensor is required, but the full app needs an iPhone running iOS 18 or newer. Apple Watch, Oura, Garmin, and other supported sources are optional.",
      inputs:
        "Gyroscope takes in food photos, sleep, workouts, steps, mood, places, productivity, blood biomarkers, and data from supported connected services.",
      insightStyle:
        "Automated Daily Reports and Health Score summaries come with an AI coach. Max memberships can add a human coach.",
      platforms:
        "The full app requires an iPhone running iOS 18 or newer. Members can view their data on the web, and Apple Watch data is supported. There is no Android app at present.",
      pricing:
        "Basic is free with 30 days of storage and five daily tokens. One is listed at $1 per day with unlimited storage and 20 tokens. Max is listed at $3 to $8 per day with unlimited storage, 100 tokens, and AI coaching, human coaching, or both.",
      primaryJob:
        "Gyroscope turns Apple-centered lifestyle and biometric data into a polished daily health dashboard and coaching program.",
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
          "Gyroscope turns Apple-centered lifestyle and biometric data into a visual daily report and a coaching membership. Murph turns the health data you authorize into an ongoing conversation with practical follow-up. Gyroscope is the stronger dashboard, and Murph is designed so you need a dashboard less.",
        question: "What is the biggest difference between Gyroscope and Murph?",
      },
      {
        answer:
          "No. Gyroscope is iPhone-first and supports Apple Watch and a web dashboard, but its official product material does not offer an Android app. That matters if you use Android.",
        question: "Is Gyroscope available on Android?",
      },
      {
        answer:
          "Oura connects directly, but WHOOP goes through Apple Health, which leaves out WHOOP HRV, Strain, Recovery, and full sleep-stage detail. Keep the WHOOP app if those scores are why you use it. Apple Watch, Garmin, Fitbit, Dexcom, and other sources are also advertised, but each metric can take a different route, so check exactly what Gyroscope receives.",
        question: "Which wearables work with Gyroscope?",
      },
    ],
    headline:
      "Gyroscope scores your day on iPhone. Murph explains your health on any phone.",
    lastVerified: "2026-08-31",
    metaDescription:
      "Gyroscope is an iPhone dashboard with a Health Score, AI coaching, and optional human coaches. Murph is a personal health assistant that explains your data over chat and follows up.",
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
      "Gyroscope is built for people motivated by visual scores, photo food logs, and optional human accountability. Murph does not reproduce that dashboard or the human coaching program.",
      "Gyroscope's consumer app is limited to Apple's mobile devices. Murph needs no particular device and also has a web account.",
      "Basic is limited to 30 days of storage and five daily tokens. One costs $1 per day and Max costs $3 to $8 per day, with more tokens and storage, and human coaching only on Max.",
      "WHOOP data reaches Gyroscope indirectly through Apple Health, which leaves out WHOOP HRV, Strain, Recovery, and full sleep-stage detail.",
      "Gyroscope's terms say AI responses may be inaccurate, outdated, or wrong for your situation, and that the Health Score is an estimate, not a clinical diagnosis.",
      "Murph keeps explanation and follow-up inside a conversation, which suits people who are tired of dashboards. People who enjoy reading a well-designed daily report may prefer Gyroscope.",
    ],
  },
  {
    category: "health-data",
    chooseCompetitor:
      "Choose Welltory if you want camera or wearable HRV readings turned into stress and energy scores, sleep and workout reports, and automatic recommendations based on those measurements.",
    chooseMurph:
      "Choose Murph if a low HRV or recovery score usually leaves you with a bigger question about symptoms, meals, training, labs, or records. Murph talks it through and then runs a short experiment or checks in later.",
    competitor: {
      clinicalRole:
        "Welltory is a consumer wellness analytics app focused on HRV, stress, energy, recovery, sleep, and activity. Welltory states that it is not a medical app.",
      followThrough:
        "Welltory offers lifestyle recommendations, breathing and measurement routines, personal experiments, activity guidance, automated health reports, and an experimental AI Coach delivered through ChatGPT.",
      format:
        "Welltory's iOS and Android apps are built around HRV readings, a data feed, charts, and automated reports. The experimental AI Coach runs through ChatGPT rather than as the app's main interface.",
      hardware:
        "A phone camera can take HRV readings. Apple Watch, Samsung Watch, Pixel Watch 2 or later, and compatible Bluetooth heart-rate monitors can also supply HRV. Many other trackers contribute activity data only.",
      inputs:
        "Welltory takes in HRV, heart rate, blood pressure, sleep, workouts, activity, weight, body measurements, lifestyle factors, weather, and data from supported apps and devices.",
      insightStyle:
        "Welltory gives HRV-based wellness scores plus sleep, activity, workout, and personalized reports, with names and availability that differ by platform. The separate ChatGPT-based AI Coach is an experimental beta, and access to your personal data through it requires Welltory Premium plus ChatGPT Plus.",
      platforms:
        "Welltory runs on iOS 16 or later and Android 9 or later. It recommends sticking to one phone platform because using the same account on both can make reports inaccurate. Features and device routes also differ by platform.",
      pricing:
        "Welltory lists Premium at $99 billed annually or $599 for lifetime access. In the free tier, feed data older than 30 days is deleted. Full AI Coach access to your Welltory data also requires ChatGPT Plus.",
      primaryJob:
        "Welltory turns HRV and connected wellness data into daily stress, energy, recovery, and lifestyle feedback you can understand.",
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
          "Welltory is the better fit when you want the measurement routine itself: HRV readings become scores, reports, and automatic guidance. Murph is the better fit when a reading raises a wider question and you want the answer to lead to a plan and later follow-up.",
        question: "How is Welltory different from Murph?",
      },
      {
        answer:
          "No. Welltory says plainly that it is not a medical app. Its stress, energy, and recovery feedback is meant for wellness and self-understanding, not diagnosis or treatment.",
        question: "Is Welltory a medical app?",
      },
      {
        answer:
          "Welltory receives data through Apple Health, Health Connect, and Samsung Health, and it documents direct routes for services including Fitbit, Garmin, Oura, Withings, and Strava. Its current direct-connection table does not list WHOOP, so WHOOP users should check the indirect route and the exact fields. Welltory also warns against connecting the same source both directly and through an aggregator, because that can create duplicate data.",
        question: "What can Welltory connect to?",
      },
    ],
    headline:
      "Welltory scores your stress from HRV. Murph explains your health and follows up.",
    lastVerified: "2026-08-31",
    metaDescription:
      "Welltory turns camera or wearable HRV readings into stress, energy, and recovery scores. Murph is a personal health assistant that explains your health data by chat and follows up.",
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
      "Welltory is built for repeated HRV measurements and automatic stress and energy scores. Murph has no comparable scoring engine.",
      "Welltory's focus is useful for wellness trends, but its scores are not medical diagnoses.",
      "Welltory says free-tier feed data older than 30 days is deleted. Personalized AI Coach access is experimental and requires both Welltory Premium and ChatGPT Plus.",
      "Phone platforms and connection routes differ, and sending the same metric through more than one source can create duplicates.",
      "Murph can discuss a wider mix of data and keep following up. If you mainly want a fast measurement ritual and an automatic score, Welltory's narrower workflow may suit you better.",
    ],
  },
  {
    aliases: ["Fitness Syncer"],
    category: "health-data",
    chooseCompetitor:
      "Choose FitnessSyncer if you need data read from or written to other fitness services. It also archives your history and builds custom charts from many supported sources.",
    chooseMurph:
      "Choose Murph if your data is already where it needs to be and you want to ask questions across it. Murph helps you weigh a practical change, then comes back to it with reminders and check-ins.",
    competitor: {
      clinicalRole:
        "FitnessSyncer is a consumer service for bringing together, viewing, archiving, and syncing fitness and wellness data across supported systems.",
      followThrough:
        "FitnessSyncer offers on-demand or scheduled syncing, goals, alerts, email reports, calendar export, sharing, leaderboards, archival storage, and a personal notebook. Some of these require Pro.",
      format:
        "FitnessSyncer is a web and mobile data hub with a unified stream, dashboards, custom charts, sync rules, archive tools, and a Daily Analyzer.",
      hardware:
        "No special hardware is required. Its purpose is to connect the apps, platforms, and devices you already have.",
      inputs:
        "FitnessSyncer handles activity, workouts, routes, sleep, weight, nutrition, glucose, blood pressure, and other fields from more than 50 supported services, subject to each source's permissions.",
      insightStyle:
        "FitnessSyncer offers dashboards, custom charts, comparisons, and rule-based analysis. An MCP server can expose your data to outside AI clients, but FitnessSyncer is not itself a conversational coach.",
      platforms: "FitnessSyncer runs on the web, iOS, and Android.",
      pricing:
        "The free plan supports five sources or tasks, once-daily syncing, one fixed dashboard, and 6 to 8 weeks of dashboard data. Pro costs $4.99 per month or $49.99 per year and adds unlimited sources, tasks, and dashboard history.",
      primaryJob:
        "FitnessSyncer syncs and consolidates fitness data across services that do not reliably exchange it on their own.",
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
          "Not really. The two do neighboring jobs: FitnessSyncer moves and charts supported data, while Murph helps you understand what you have and carry a plan forward. This page does not claim that Murph replaces sync routes or that the two products connect directly.",
        question: "Is FitnessSyncer an alternative to Murph?",
      },
      {
        answer:
          "FitnessSyncer lists more than 50 services, including Apple Health, Health Connect, Fitbit, Garmin, Oura, WHOOP, Withings, Samsung Health, Strava, Suunto, Polar, and Dexcom. Read and write support differs by service and metric. For example, its current WHOOP row is read-only and limited to activity, oxygen, and sleep, so check every direction and field you plan to use.",
        question: "Which services can FitnessSyncer sync?",
      },
      {
        answer:
          "Not a built-in one. FitnessSyncer's MCP server can let compatible clients such as ChatGPT, Claude, or Perplexity read and, when authorized, update selected FitnessSyncer data. That chat experience runs in a separately configured AI assistant and needs its own setup.",
        question: "Does FitnessSyncer have an AI coach?",
      },
    ],
    headline:
      "FitnessSyncer moves data between fitness apps. Murph explains your health data.",
    lastVerified: "2026-08-31",
    metaDescription:
      "FitnessSyncer syncs and charts data across more than 50 fitness services. Murph is a personal health assistant that explains your health data in a chat and follows up with reminders.",
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
      "FitnessSyncer covers an unusually wide range of services and offers sync features Murph does not. Each provider still controls which fields can be read or written.",
      "Setting up sources, destinations, duplicate handling, and metric-specific routes is part of using a sync tool. Murph is not a shortcut around that work.",
      "FitnessSyncer is about routing fitness and wellness data, not retrieving clinical records or coaching over time.",
      "Its MCP server is a bridge to compatible third-party AI software, not an assistant inside FitnessSyncer. Murph has the conversation built in, but it does not replace the bridge's data portability.",
    ],
  },
  {
    aliases: ["Heads Up"],
    category: "health-data",
    chooseCompetitor:
      "Choose Heads Up Health if you run a practice and need unified client charts across it. It adds lab and wearable integrations, cohort reporting, alerts, pre-visit briefs, and communication workflows for clinicians.",
    chooseMurph:
      "Choose Murph if you are an individual, not a practice, and want to talk about your own health in iMessage or Telegram. Murph turns those talks into reminders, check-ins, or experiments with no clinic platform to buy or run.",
    competitor: {
      clinicalRole:
        "Heads Up Health is a business-to-business clinical intelligence and client-management platform for health practices.",
      followThrough:
        "Heads Up Health provides targeted alerts, messaging and notifications, automated pre-visit briefs, client-facing reports, outcome tracking, and practice-level AI workflows.",
      format:
        "Heads Up Health is a clinician web workspace with unified client charts, lab and wearable dashboards, AI tools, cohort views, reports, and companion apps for clients.",
      hardware:
        "There is no Heads Up sensor. The software pulls in data from supported wearables, labs, EHR connections, diagnostic PDFs, and medical records.",
      inputs:
        "Heads Up Health takes in labs and diagnostic PDFs, supported wearable and device data, EHR and medical records, notes, journals and symptoms, medications and supplements, assessments, and activity and nutrition data.",
      insightStyle:
        "Heads Up Health offers natural-language queries, chart summaries, pre-visit briefs, biomarker trends, health scores, alerts, cohort analysis, and configurable AI workflows.",
      platforms:
        "Heads Up Health is a clinician web platform. Clients of participating practices get iOS, Android, and web experiences.",
      pricing:
        "Current clinic pricing starts at $250 per month for Professional with 40 clients and $1,000 onboarding. Premier starts at $1,000 per month for 100 clients and $3,500 onboarding. Extra clients and AI usage can add cost.",
      primaryJob:
        "Heads Up Health gives health practices one longitudinal record and an intelligence layer across their whole client population.",
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
          "No, the current main Heads Up product is clinic software, not a self-service consumer assistant. The site separately links a Heads Up Legacy app and an older consumer dashboard page. Do not assume those legacy plans include the current clinic platform, AI package, or practice workflows.",
        question: "Is Heads Up Health a consumer app like Murph?",
      },
      {
        answer:
          "As of the July 1, 2026 pricing, Professional starts at $250 a month for 40 clients plus a $1,000 onboarding fee. Premier starts at $1,000 a month for 100 clients plus a $3,500 onboarding fee. Extra clients and AI tokens are billed separately under the published schedule.",
        question: "How much does Heads Up Health cost?",
      },
      {
        answer:
          "The live legacy page advertises $9 a month, $79 a year, or $199 for lifetime access to its consumer dashboard. The current pricing page instead sells clinic packages with required onboarding, client limits, and usage charges. The two price lists describe different product generations and should always be labeled that way.",
        question: "Why do some Heads Up Health pages show consumer pricing?",
      },
    ],
    headline:
      "Heads Up Health is built for clinics. Murph is built for one person.",
    lastVerified: "2026-08-31",
    metaDescription:
      "Heads Up Health is clinical intelligence software sold to health practices. Murph is a personal health assistant for one person, working from a chat in iMessage or Telegram.",
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
      "Heads Up Health offers multi-client clinical and practice workflows that Murph does not. Its current packages are priced and set up for practices, not for one person using it alone.",
      "Setup includes onboarding fees, client limits, and possible AI usage charges. That is not comparable to a simple consumer subscription.",
      "Legacy consumer pages are still reachable, so buyers need to tell the old dashboard plans apart from the current clinic platform.",
      "Murph is the more direct fit for one person's conversation and follow-up. It should not be used in place of a practice's chart, cohort, alerting, or clinician workflow system.",
    ],
  },
  {
    aliases: ["CommonHealth App"],
    category: "health-data",
    chooseCompetitor:
      "Choose CommonHealth if you want to download records from participating providers, store and export health cards, or share a protected patient summary from an Android phone.",
    chooseMurph:
      "Choose Murph if holding your records is only the start. Murph imports records from supported portals and talks them through next to your labs, wearable data, symptoms, and meals, then follows up.",
    competitor: {
      clinicalRole:
        "CommonHealth is a nonprofit consumer health-record wallet. The Commons Project says it does not provide medical advice or administer diagnostic tests, vaccinations, or other healthcare interventions.",
      followThrough:
        "CommonHealth retrieves provider records and stores them encrypted on the device. It also stores and exports SMART Health Cards, exports data, shares with approved apps or providers, and creates a temporary passcode-protected Patient Summary.",
      format:
        "CommonHealth is an Android record wallet with provider connections, SMART Health Cards, record export, and sharing that you direct. Patient Summaries can be shared through a protected QR code or link.",
      hardware:
        "No special hardware is needed, but the consumer app requires a compatible Android device.",
      inputs:
        "CommonHealth takes in copies of electronic health records from supported provider systems, plus SMART Health Cards.",
      insightStyle:
        "CommonHealth is about organizing and accessing records rather than analyzing them. Its official product materials do not describe AI coaching, correlation analysis, or lifestyle recommendations.",
      platforms: "The CommonHealth consumer app is Android only.",
      pricing:
        "CommonHealth is free. It is developed by the nonprofit Commons Project Foundation.",
      primaryJob:
        "CommonHealth puts portable copies of your clinical records and verifiable health cards under your own control.",
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
          "CommonHealth gives eligible Android users their own portable copies of participating-provider records and SMART Health Cards, and its official materials focus on access, organization, and sharing. Murph also imports records from supported portals, but its main job is the step after access: talking through the records you have authorized and carrying a plan forward. No direct product connection is claimed.",
        question: "What is the difference between CommonHealth and Murph?",
      },
      {
        answer:
          "No. The consumer CommonHealth app is for Android, and its official material does not offer an iPhone version. Apple users need a different record wallet.",
        question: "Is CommonHealth available on iPhone?",
      },
      {
        answer:
          "CommonHealth advertises connections to more than 400 data sources through provider portals and health-data standards. What you actually get depends on whether your provider participates and which record types it exposes.",
        question: "Which medical records can CommonHealth collect?",
      },
    ],
    headline:
      "CommonHealth is a free Android record wallet. Murph explains your records.",
    lastVerified: "2026-08-31",
    metaDescription:
      "CommonHealth is a free Android wallet for provider records and health cards. Murph is a personal health assistant that also imports records, then explains them and follows up.",
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
      "CommonHealth is free and built for portable clinical records and SMART Health Cards. Murph imports records and keeps a vault, but it is not a substitute for that record-wallet workflow.",
      "The consumer app is Android only, and its terms limit the service to US residents age 18 or older.",
      "Record coverage depends on provider participation and on the data each connected source makes available.",
      "CommonHealth says records normally stay encrypted on the device. An encrypted Patient Summary can stay in its AWS cloud for up to 72 hours when you choose to share one.",
      "CommonHealth's terms say the information you control in the app is not covered by HIPAA. You are responsible for the privacy and security of what you store and share.",
      "CommonHealth's official materials focus on access and organization rather than analysis or coaching, which suits someone who wants a simple wallet. Murph adds conversation and follow-up, but that is a different kind of product to commit to.",
    ],
  },
]);
