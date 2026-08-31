import { defineComparisons } from "../types";

export const HEALTH_ASSISTANT_COMPARISONS = defineComparisons([
  {
    aliases: [
      "BodyBuddy: Better Health",
      "BodyBuddy: Daily Health Coach",
      "BodyBuddy HQ",
    ],
    bestFor:
      "Adults whose main problem is execution: they have a goal, professional plan, or program and want proactive daily texts, quick logging, and visible accountability.",
    bottomLine:
      "Choose BodyBuddy when you want a coach to keep a defined goal or plan moving every day. Choose Murph when you want one private assistant to carry changing health questions through context, decisions, practical actions, and later follow-through.",
    category: "health-assistants",
    chooseCompetitor:
      "Choose BodyBuddy when the desired product is an opinionated daily accountability loop: bring a plan, log what happened by text, photo, or voice, and use check-ins and game mechanics to stay engaged.",
    chooseMurph:
      "Choose Murph when the work will not stay inside one plan, such as when a wearable or lab result raises a question, the answer changes a decision, and you want the reasoning, next step, reminder, and later outcome to remain connected.",
    competitor: {
      clinicalRole:
        "A consumer wellness and accountability coach. BodyBuddy says it does not provide medical advice, diagnose conditions, or independently validate instructions from a health professional.",
      followThrough:
        "Daily text check-ins, persistent plans, action tracking, reminders, progress views, points, badges, leaderboards, and optional plan sharing.",
      format:
        "An AI accountability coach built around proactive text messages, with app and web access for plans, logs, documents, and progress.",
      hardware:
        "No proprietary hardware is required. Texting works without installing an app; the iPhone app adds Apple Health and Dynamic Island features.",
      inputs:
        "Text, photos, voice, meals, movement, sleep, hydration, appointment audio, uploaded care or training documents, and authorized Apple Health data.",
      insightStyle:
        "Turns stated goals and imported instructions into action items, then responds to daily logs with encouragement, summaries, and accountability prompts.",
      platforms:
        "iPhone and iMessage with iOS 15.1 or later, plus web access described in BodyBuddy's terms. The service is for adults age 18 and older.",
      pricing:
        "BodyBuddy advertises $29 per month with a seven-day trial. Its App Store listing shows multiple in-app purchase amounts, and its terms say the selected price and billing period are shown at checkout.",
      primaryJob:
        "Turn a health goal, professional plan, or program into daily execution through proactive messages, easy logging, and visible accountability.",
    },
    competitorEvidence: {
      clinicalRole: [3],
      followThrough: [1],
      format: [1, 3],
      hardware: [1],
      inputs: [1, 2],
      insightStyle: [1],
      platforms: [2, 3],
      pricing: [1, 2, 3],
      primaryJob: [1],
    },
    faqs: [
      {
        answer:
          "This comparison covers BodyBuddy's health-coaching app from BodyBuddy HQ, currently listed in the US App Store as BodyBuddy: Better Health. Please Clap, LLC is the App Store seller. It does not cover the similarly named EMS controller, pregnancy course, or Apple Health utility.",
        question: "Which BodyBuddy does this comparison cover?",
      },
      {
        answer:
          "Yes. BodyBuddy can record an appointment, create a transcript or summary, and turn the instructions into action items. It says generated material can contain errors, the original professional instructions remain authoritative, and the user is responsible for obtaining any required recording consent.",
        question: "Can BodyBuddy summarize a medical appointment?",
      },
      {
        answer:
          "BodyBuddy documents Apple Health access for steps, workouts, weight, sleep, active energy, and dietary calories. It says Fitbit, Garmin, Oura, and WHOOP data can reach BodyBuddy through Apple Health; that relay is different from a documented native connection to each service.",
        question: "What health data can BodyBuddy use?",
      },
    ],
    headline: "Daily plan accountability or help across changing health needs?",
    lastVerified: "2026-08-31",
    metaDescription:
      "Murph is a personal health assistant for changing questions and follow-through; BodyBuddy specializes in proactive texts and daily accountability for a defined plan.",
    name: "BodyBuddy",
    overview:
      "BodyBuddy's strongest case is focus: bring a goal, clinician or trainer plan, or program; log by text, photo, or voice; and let proactive check-ins keep the week moving. Appointment recording and plan import make it more substantial than a simple habit tracker. Murph overlaps on reminders, but its center is continuity as the health question changes: authorized wearable and lab context, records, decisions, practical tasks, experiments, and later outcomes can remain part of the same thread.",
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
      "BodyBuddy's opinionated daily text loop is a real advantage for executing a defined plan. Murph does not reproduce its points, badges, streaks, leaderboards, or game-like daily accountability loop.",
      "Appointment transcripts, imported-plan summaries, and other AI output can be inaccurate and need comparison with the original source.",
      "Several advertised device connections depend on data first reaching Apple Health rather than a direct BodyBuddy integration.",
    ],
    useTogether:
      "Keep BodyBuddy on the defined plan and daily check-ins. Use Murph when an unexpected symptom, lab result, or tradeoff changes the question, then bring the agreed decision back to BodyBuddy's plan manually. The products do not document a direct connection.",
  },
  {
    aliases: ["Ada - your health portal", "Ada Health"],
    bestFor:
      "People with a current symptom who want a structured assessment built on Ada's clinical knowledge base, with possible causes and guidance on what kind of care to consider next.",
    bottomLine:
      "Use Ada when the immediate job is assessing a symptom. Use Murph for the broader work before and after that episode: keeping relevant context together, understanding information, deciding what to do, and following through. Murph does not reproduce Ada's regulated assessment.",
    category: "health-assistants",
    chooseCompetitor:
      "Choose Ada when you want its structured symptom questions, possible-cause report, and guidance about possible next steps, including whether medical support may be needed. Its Class IIa status under EU MDR is a meaningful distinction that Murph does not claim.",
    chooseMurph:
      "Choose Murph when the symptom is only one part of the thread and you want records, wearable or lab context, routines, questions, decisions, reminders, and later outcomes to stay connected in one private conversation.",
    competitor: {
      clinicalRole:
        "Ada identifies its consumer assessment as a Class IIa medical device under EU MDR. It provides possible explanations and care guidance but does not diagnose a condition or replace professional or emergency care.",
      followThrough:
        "Keeps an assessment history and allows users to review, export, or share reports. It does not center the experience on daily coaching or habit accountability.",
      format:
        "A structured conversational symptom assessment that asks follow-up questions and produces a personalized report.",
      hardware:
        "No proprietary device or wearable is required for Ada's symptom assessment.",
      inputs:
        "Current symptoms, age, demographic information, health profile, risk factors, and answers to follow-up questions.",
      insightStyle:
        "Compares the reported presentation with a clinical knowledge base to rank possible explanations and provide possible next steps, including whether medical support may be needed.",
      platforms:
        "iPhone, Android phones and tablets, Chromebooks, and a web symptom assessment. Ada advertises support for seven languages.",
      pricing:
        "Ada says its consumer symptom assessment is free. Its current official app listings also present the consumer app as free.",
      primaryJob:
        "Help a person think through a current symptom and decide what kind of care or next step may be appropriate.",
    },
    competitorEvidence: {
      clinicalRole: [5, 6],
      followThrough: [3],
      format: [2],
      hardware: [1],
      inputs: [2],
      insightStyle: [2, 3, 5],
      platforms: [3, 4, 5],
      pricing: [1, 3, 4],
      primaryJob: [1, 2],
    },
    faqs: [
      {
        answer:
          "No. Ada identifies its consumer assessment as a Class IIa medical device under EU MDR, but says its possible causes and suggested next steps are not a diagnosis, clinical decision support, or a replacement for professional care.",
        question: "Can Ada diagnose a medical condition?",
      },
      {
        answer:
          "Ada asks about symptoms, basic profile information, and relevant risk factors. Its current consumer materials do not document Apple Health, Health Connect, wearable, or medical-record input for the symptom assessment.",
        question: "Does Ada use wearable or medical-record data?",
      },
      {
        answer:
          "Ada's distinctive job is a bounded symptom assessment that ends in a possible-cause report and next-step guidance. Murph keeps the wider health thread alive across questions, data, plans, reminders, and what happens later, without ranking conditions or replacing Ada's assessment flow.",
        question: "How is Ada's role different from Murph's?",
      },
    ],
    headline: "Symptom assessment now or health support over time?",
    lastVerified: "2026-08-31",
    metaDescription:
      "Murph is a personal health assistant for ongoing context and follow-through; Ada is a regulated symptom-assessment tool that ranks possible causes.",
    name: "Ada",
    overview:
      "Ada's strength is discipline: it asks follow-up questions about a current symptom, compares the answers with its clinical knowledge base, and returns possible explanations and care guidance in a shareable report. That bounded flow is the stronger choice when symptom assessment is the job. Murph earns its place around the episode by preserving broader context, helping with the next question or plan, and supporting the practical follow-through over time.",
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
      "Ada's structured, finite assessment is its advantage for a current symptom. Murph does not reproduce that regulated assessment or rank possible causes.",
      "Natural-language symptom entry and some product details vary by country, language, and app version.",
    ],
    useTogether:
      "Use Ada for the bounded symptom assessment and keep its report for a clinician. Use Murph to organize the questions that remain and the non-clinical follow-through around appointments, reminders, or records. No direct Ada-Murph sync is documented.",
  },
  {
    aliases: ["Hume", "Hume Pod", "Hume Band"],
    bestFor:
      "People who specifically want Hume's body-composition scale and screenless wearable to produce a steady stream of recovery, sleep, activity, and body-composition estimates in one app.",
    bottomLine:
      "Choose Hume Health when you want Hume to generate the measurements. Choose Murph when you already have health information, or questions no device can measure, and want one conversation to connect it with decisions and follow-through. These are different primary jobs.",
    category: "health-assistants",
    chooseCompetitor:
      "Choose Hume Health when owning the Pod or Band 2.0, collecting their measurements, and reviewing Hume's recovery, body-composition, and longevity scores are the experience you want.",
    chooseMurph:
      "Choose Murph when the useful question crosses beyond what a scale or band measures, such as how a trend fits with symptoms, records, labs, routines, constraints, or a prior attempt, and you want help deciding and revisiting the next move.",
    competitor: {
      clinicalRole:
        "A consumer wellness system. Hume says its Pod and Band are not medical devices and are not intended to diagnose, monitor, or manage medical conditions.",
      followThrough:
        "Daily briefings, trend views, weekly reports, personalized guidance, and subscription-level coaching features.",
      format:
        "A mobile dashboard and AI insight layer paired with a multi-frequency body-composition scale and a screenless continuous wearable.",
      hardware:
        "Hume Pod and Hume Band 2.0 are the core advertised data sources. The app can also read selected phone health-platform data, but the distinctive body-composition and continuous wearable measurements come from Hume hardware.",
      inputs:
        "Estimated body composition from Hume Pod, sleep and recovery signals from Hume Band, and selected Apple Health or Google Fit data.",
      insightStyle:
        "Presents metric trends, recovery and activity scores, daily recommendations, and proprietary outputs such as Pace of Aging and metabolic scores.",
      platforms:
        "iPhone and iPad with iOS 15 or later, Android phones and tablets, and Chromebook, used with supported Hume hardware.",
      pricing:
        "Hume's pages list a $229 one-time reference price for Pod and $249 for Band 2.0, with changing promotional discounts. Core scores and data are marketed as subscription-free, while the App Store lists optional Hume Plus Annual at $99.99.",
      primaryJob:
        "Combine Hume body-composition and wearable measurements into a single wellness dashboard with trend-based guidance.",
    },
    competitorEvidence: {
      clinicalRole: [1, 2],
      followThrough: [2, 3],
      format: [1, 2],
      hardware: [1, 2, 4],
      inputs: [1, 2, 3],
      insightStyle: [1, 2],
      platforms: [3, 4],
      pricing: [1, 2, 3],
      primaryJob: [1, 2],
    },
    faqs: [
      {
        answer:
          "Yes. Hume's current Google Play listing says Body Pod or Band is required. Pod supplies body-composition estimates and Band supplies continuous sleep, recovery, and activity signals; selected Apple Health or Google Fit data do not reproduce those proprietary measurements.",
        question: "Do I need Hume hardware to use Hume Health?",
      },
      {
        answer:
          "No. Hume describes Pod body composition as an estimate rather than a DEXA-equivalent clinical measurement. It also describes Band blood-pressure insights as directional PPG trends, not cuff readings or a replacement for a validated cuff.",
        question: "Are Hume's measurements clinical readings?",
      },
      {
        answer:
          "No for core scores and data, according to Hume's current product pages. Hume Plus is optional and adds deeper coaching and reports, while the App Store lists a $99.99 annual purchase. Hardware and promotional offers still change, so check checkout terms.",
        question: "Does Hume Health require a subscription?",
      },
    ],
    headline: "Dedicated measurements or help across the wider context?",
    lastVerified: "2026-08-31",
    metaDescription:
      "Murph is a personal health assistant that connects health context to decisions; Hume Health pairs dedicated sensors with body-composition and recovery estimates.",
    name: "Hume Health",
    overview:
      "Hume Health is better at creating its own data stream: Pod estimates body composition, Band 2.0 records sleep and recovery signals, and the app turns those readings into trends, scores, and guidance. Murph does not replace either sensor. It can start from a question and, when measurements matter, put authorized or manually shared signals beside records, labs, symptoms, routines, goals, and day-to-day constraints, then help decide what is worth acting on and revisit what happened afterward. Hume's aging and metabolic outputs remain wellness estimates rather than established clinical measurements.",
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
    ],
    tradeoffs: [
      "The distinctive Hume experience requires an upfront Pod or Band purchase and continued device use, but Hume markets core scores and data without a required ongoing subscription. Murph cannot generate Pod body-composition or Band sleep and recovery measurements.",
      "Pod bioelectrical-impedance estimates can vary with hydration, timing, and calibration; Band outputs are directional wellness estimates rather than clinical readings.",
      "Hume's proprietary aging, recovery, and metabolic scores should not be interpreted as diagnoses or guaranteed outcome changes.",
    ],
    useTogether:
      "Keep Hume for Pod and Band measurements. Bring a trend to Murph when you want to consider it beside authorized or manually shared records, labs, symptoms, routines, or constraints, then keep the resulting decision and later check-in in the conversation. No direct Hume-Murph connection is documented.",
  },
  {
    aliases: ["HUMANITY - AI Health Coach", "Humanity Health"],
    bestFor:
      "People motivated by a simple Rate of Aging score, game-like daily actions, wearable data, and optional blood-test analysis inside a longevity-focused program.",
    bottomLine:
      "Choose Humanity when its longevity scorecard and game-like daily actions help you act. Choose Murph when you want the relationship to remain useful even when the question is not about lowering a biological-age estimate, and broader context matters more than the scorecard.",
    category: "health-assistants",
    chooseCompetitor:
      "Choose Humanity when you want phone and wearable signals distilled into Rate of Aging, Biological Age, and H Score, with streaks, daily actions, and optional blood-based analysis to keep the longevity goal visible.",
    chooseMurph:
      "Choose Murph when a score is only one clue and you want to weigh it with records, symptoms, routines, labs, goals, tradeoffs, and lived constraints, then carry the decision into a plan, reminder, check-in, or personal experiment.",
    competitor: {
      clinicalRole:
        "A consumer wellness and longevity app. Humanity says its scores and guidance are informational and are not medical advice, diagnosis, treatment, or a reason to change medication or care without a professional.",
      followThrough:
        "Recommended actions across movement, nutrition, mind, and recovery, plus streaks, weekly reports, and optional social Circles.",
      format:
        "A mobile longevity dashboard and AI coach organized around proprietary aging scores, daily actions, and optional blood-test analysis.",
      hardware:
        "No proprietary hardware is required. A supported phone, Apple Watch, or other data source connected through Apple Health or Health Connect can contribute signals.",
      inputs:
        "Phone and wearable movement, steps, heart-rate patterns, resting heart rate, sleep, manually completed actions, and optional recent blood-test results.",
      insightStyle:
        "Summarizes inputs as Rate of Aging, Biological Age, H Score, and Blood Age, then recommends wellness actions intended to move those estimates.",
      platforms:
        "iPhone with iOS 16 or later, Apple Watch with watchOS 9.3 or later, and Android with supported Health Connect data.",
      pricing:
        "A free account can generate a Rate of Aging score. The US App Store lists Premium purchases including $49.99 and a separate Pro purchase; Humanity's terms allow several billing periods, so confirm the duration and price at checkout.",
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
          "No. Humanity's Biological Age and Rate of Aging are model-generated wellness estimates. They can make direction and daily actions easier to see, but Humanity does not establish them as a clinical diagnosis or a precise forecast for one person.",
        question: "Is Humanity's Biological Age a clinical measurement?",
      },
      {
        answer:
          "Humanity can generate its core Rate of Aging from compatible phone and wearable signals. Its Pro features can add recent blood-test data to produce blood-based insights, so laboratory input is optional rather than required for the basic experience.",
        question: "Does Humanity require a blood test?",
      },
      {
        answer:
          "Humanity turns compatible data into an aging-focused score and action loop. Murph keeps different health threads in one continuing conversation, so a wearable trend, record, symptom, decision, and later result can inform one another without making longevity the required frame.",
        question: "What is the central difference between Humanity and Murph?",
      },
    ],
    headline: "A longevity scorecard or help across the wider health story?",
    lastVerified: "2026-08-31",
    metaDescription:
      "Murph is a personal health assistant for questions, decisions, and follow-through; Humanity centers longevity scores, wearable inputs, and daily actions.",
    name: "Humanity",
    overview:
      "Humanity makes longevity easy to see: it turns compatible phone, wearable, and optional blood-test data into proprietary aging scores, then ties those scores to daily actions across movement, nutrition, mind, and recovery. That simplicity is the appeal. Murph starts from the person's question rather than a required score and can keep authorized data, records, preferences, constraints, decisions, and outcomes together as the health thread changes. Humanity's outputs remain wellness estimates rather than clinical biological-age measurements.",
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
    ],
    tradeoffs: [
      "Humanity's aging scores make a longevity goal concrete and easy to revisit, but a proprietary wellness estimate can feel more precise than its non-clinical role supports. Murph does not calculate Humanity's Rate of Aging, Biological Age, H Score, or Blood Age.",
      "Blood-based features and deeper analysis sit outside the free core experience and may require a higher-priced plan.",
      "Recommendations are general wellness guidance and should not drive medication, diagnosis, or treatment decisions.",
    ],
    useTogether:
      "Keep Humanity if its aging scores and daily actions motivate you. Bring a score or weekly pattern to Murph when it raises a wider question involving records, symptoms, labs, routines, or tradeoffs, then keep the decision and follow-up there. No direct Humanity-Murph connection is documented.",
  },
  {
    aliases: ["Health Tracker: Healthily", "Your.MD"],
    bestFor:
      "People who prefer a structured iPhone self-care journal for manually tracking symptoms, mood, medication, and habits alongside reminders, short plans, reports, and health content.",
    bottomLine:
      "Keep Healthily if its structured journal, reports, and plans work for you. Add Murph when you want those observations considered alongside wider context and carried into a decision and later follow-through. Switch only if you no longer need Healthily's dedicated tracker. Do not count on its advertised AI symptom checker today.",
    category: "health-assistants",
    chooseCompetitor:
      "Choose Healthily when a predictable tracker is the point: record selected factors, set goals and reminders, follow a 28-day plan, and review weekly reports and self-care content in an iPhone app.",
    chooseMurph:
      "Choose Murph when logging is not the end goal and you want a private conversation to put a pattern beside records, wearable or lab context, routines, and constraints, then help with the question, decision, plan, reminder, or later check-in.",
    competitor: {
      clinicalRole:
        "A consumer self-care and wellness app. Healthily says its content and tools do not provide medical advice, diagnosis, or treatment and do not replace a health professional.",
      followThrough:
        "Goals, reminders, manual trackers, notes, weekly reports, and 28-day plans covering activity, mind, nutrition, and sleep.",
      format:
        "A structured mobile health journal with trackers, plans, reports, reminders, a back-pain hub, and a health-information library.",
      hardware:
        "No proprietary hardware is required. The current iPhone listing documents Apple Health and Fitbit connections, although supported fields and connection paths can vary.",
      inputs:
        "Manual activity, sleep, mental wellbeing, symptoms, medication, habits, goals, notes, and selected connected health or Fitbit data.",
      insightStyle:
        "Shows logs, progress, reminders, and weekly self-care reports. The store listings still advertise a DOT AI checker, but its live consumer availability is not established.",
      platforms:
        "iPhone with iOS 14 or later. Healthily retired and discontinued its Android app on March 31, 2026.",
      pricing:
        "Healthily advertises a seven-day trial. Its App Store list includes $4.99 weekly, $6.49 and $24.99 subscription entries, and a $29.99 lifetime entry, but some durations are unclear and checkout terms control.",
      primaryJob:
        "Help a user record wellness factors, follow short self-care plans, and review progress in a structured mobile journal.",
    },
    competitorEvidence: {
      clinicalRole: [4],
      followThrough: [2],
      format: [2],
      hardware: [2],
      inputs: [2],
      insightStyle: [2, 5],
      platforms: [2, 3],
      pricing: [2],
      primaryJob: [2],
    },
    faqs: [
      {
        answer:
          "Not from the current official evidence. The iPhone listing still advertises Healthily's DOT chatbot and symptom checker, but Healthily's consumer symptom-checker page says the feature has been temporarily removed.",
        question: "Is Healthily's AI symptom checker currently available?",
      },
      {
        answer:
          "Healthily supports manual trackers for activity, sleep, mental wellbeing, symptoms, medication, and custom habits. Its iPhone listing also advertises Apple Health and Fitbit connections, although supported fields and connection paths can vary.",
        question: "What can I track in Healthily?",
      },
      {
        answer:
          "Healthily's terms exclude emergency use and say the service is not intended for children under 16, pregnancy, immunosuppression, or management of long-term conditions such as diabetes. A qualified professional remains the right source for medical decisions.",
        question: "Who should not rely on Healthily for self-care guidance?",
      },
    ],
    headline: "A structured self-care journal or an ongoing conversation?",
    lastVerified: "2026-08-31",
    metaDescription:
      "Murph is a personal health assistant for contextual decisions and follow-through; Healthily is an iPhone self-care journal with trackers, reports, and plans.",
    name: "Healthily",
    overview:
      "Healthily's strength is structure: it gives iPhone users a defined place to record selected factors, compare trackers, set reminders, follow short plans, and review weekly reports and self-care content. Healthily keeps interpretation inside that tracker-and-content workflow. Murph adds an open-ended private conversation that can bring authorized records, wearable or lab context, routines, and constraints into a decision and revisit it later. Healthily's store copy still mentions DOT and a symptom checker, but its official consumer page says the checker is temporarily removed.",
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
        label: "Healthily Android retirement notice",
        url: "https://www.healthily.ai/legal-pages/health-tracker-app-for-android-retirement-notice",
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
      "Healthily offers a predictable journal, reports, guided plans, and a content library, but its advertised AI checker cannot be treated as a verified live feature. Murph does not provide Healthily's dedicated tracker screens, weekly reports, or 28-day plans.",
      "Manual tracking can reveal patterns only when entries are consistent enough to support a meaningful report.",
      "Healthily retired and discontinued its Android app on March 31, 2026, so the current consumer tracker is an iPhone-only choice.",
      "Healthily's terms exclude children under 16, pregnancy, immunosuppression, and management of long-term conditions such as diabetes from its intended self-care use.",
    ],
    useTogether:
      "Keep symptoms, mood, medication, and habits logged in Healthily. When a weekly report shows a pattern, bring the relevant summary to Murph with any authorized records, labs, or wearable context, then decide on a next step and schedule a later check-in. No automatic Healthily-Murph connection is documented.",
  },
]);
