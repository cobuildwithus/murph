import { defineComparisons } from "../types";

export const HEALTH_DEVICE_COMPARISONS = defineComparisons([
  {
    aliases: ["Stelo by Dexcom", "Stelo glucose biosensor"],
    category: "wearables",
    chooseCompetitor:
      "Choose Stelo if you are an adult who does not use insulin and you want an over the counter glucose sensor with an app that shows how meals, activity, and sleep move your glucose.",
    chooseMurph:
      "Choose Murph if you want the glucose picture read beside your meals, symptoms, sleep, labs, and records in one conversation, with reminders and errands handled along the way, whether or not you keep wearing a sensor.",
    competitor: {
      clinicalRole:
        "Stelo is an over the counter integrated continuous glucose monitor for people 18 and older who do not use insulin. Dexcom says not to use it if you are on insulin or dialysis or have problematic hypoglycemia, and to consult a healthcare provider before making medication changes based on readings.",
      followThrough:
        "The Stelo app shows glucose trends, lets you log meals by barcode or photo, and includes an AI coach that gives guidance from your data. Dexcom ships a replacement if a biosensor fails before its 15 day wear ends. The pages reviewed do not describe human coaching or reminders.",
      format:
        "A small biosensor worn on the back of the upper arm for up to 15 days, read in the Stelo app on a phone. Glucose can also be viewed on Apple Watch.",
      hardware:
        "Each supply contains two biosensors with applicators and overpatches. A biosensor lasts up to 15 days with a 12 hour grace period, needs a 30 minute warmup, and is waterproof to 8 feet for 24 hours. The app needs iOS 18.6 or Android 13 or later.",
      inputs:
        "Glucose from the biosensor, meals logged by barcode or photo, and activity and sleep pulled from Apple Health or Health Connect, which the app checks every five minutes while it is open.",
      insightStyle:
        "Glucose trends and patterns over time, meal responses, and AI coach guidance. Dexcom says the system helps detect normal, low, and high glucose levels rather than diagnosing a condition.",
      platforms:
        "iPhone on iOS 18.6 or later, Android 13 or later, and Apple Watch on watchOS 11. Stelo sends glucose to Apple Health and Google Health Connect with a 3 hour delay, and Clarity Clinic lets you share data with a healthcare provider.",
      pricing:
        "When reviewed, a one time supply of two biosensors cost $99, a monthly subscription cost $89, and a three month subscription cost $252. Purchases are HSA and FSA eligible and the app is free.",
      primaryJob:
        "Give adults who do not use insulin a prescription free way to see how food, activity, and sleep affect their glucose.",
    },
    competitorEvidence: {
      clinicalRole: [1, 2],
      followThrough: [5, 1],
      format: [1, 5],
      hardware: [1, 5],
      inputs: [3, 5],
      insightStyle: [5, 2],
      platforms: [1, 3, 5],
      pricing: [1, 5],
      primaryJob: [1, 2],
    },
    faqs: [
      {
        answer:
          "No. Stelo is sold over the counter for adults 18 and older who do not use insulin. Dexcom says not to use it if you take insulin, are on dialysis, or have problematic hypoglycemia, and to talk with a healthcare provider before changing any medication.",
        question: "Do I need a prescription for Stelo?",
      },
      {
        answer:
          "Yes, on iPhone. Turn on Apple Health sharing in the Stelo app and connect Apple Health to Murph. Stelo sends glucose to Apple Health with a 3 hour delay, so Murph sees a delayed record that suits reviewing patterns rather than reacting in the moment.",
        question: "Can Murph read my Stelo glucose data?",
      },
      {
        answer:
          "Stelo cost $99 for a one time two sensor supply or $89 a month on subscription when reviewed, plus a free app. Murph is free to start with no card, and paid plans add usage. Murph has no sensor, so the two costs cover different things.",
        question: "What does Stelo cost compared with Murph?",
      },
    ],
    headline:
      "Stelo puts a glucose sensor on your arm without a prescription. Murph reads the pattern beside everything else.",
    integration: "apple-health",
    lastVerified: "2026-09-04",
    metaDescription:
      "Stelo is Dexcom's over the counter glucose biosensor for adults not on insulin. Murph is a personal health assistant that reads Stelo glucose through Apple Health beside meals and labs.",
    name: "Stelo",
    quickComparison: [
      { capability: "Continuous glucose readings", competitor: "yes", evidence: "inputs", murph: "connected" },
      { capability: "Glucose pattern insights", competitor: "yes", evidence: "insightStyle", murph: "connected" },
      { capability: "Apple Watch glucose view", competitor: "yes", evidence: "platforms", murph: "no" },
      { capability: "Photo meal logging", competitor: "yes", evidence: "inputs", murph: "yes" },
      { capability: "Clinician data sharing", competitor: "yes", evidence: "platforms", murph: "yes" },
      { capability: "Works without a sensor", competitor: "no", evidence: "hardware", murph: "yes" },
      { capability: "Wearable and lab context", competitor: "limited", evidence: "inputs", murph: "yes" },
      { capability: "Works in iMessage or Telegram", competitor: "no", evidence: "format", murph: "yes" },
      { capability: "Handles health errands", competitor: "no", evidence: "followThrough", murph: "yes" },
      { capability: "Free start without a card", competitor: "no", evidence: "pricing", murph: "yes" },
    ],
    relationship: "complement",
    slug: "dexcom-stelo",
    sources: [
      { label: "Stelo one time purchase and pricing", url: "https://www.stelo.com/en-us/buy-stelo-one-time" },
      { label: "Stelo safety information", url: "https://www.stelo.com/en-us/safety-information" },
      { label: "Stelo health app sharing FAQ", url: "https://www.stelo.com/en-us/faqs/using-stelo/how-do-i-share-my-glucose-data-with-health-apps" },
      { label: "Stelo privacy policy", url: "https://www.stelo.com/en-us/legal/privacy-policy" },
      { label: "Stelo by Dexcom App Store listing", url: "https://apps.apple.com/us/app/id6475610406" },
    ],
    tradeoffs: [
      "Stelo is for adults who do not use insulin. People who take insulin, are on dialysis, or have problematic hypoglycemia should not use it, and its readings are not a basis for medication changes without a healthcare provider.",
      "Apple Health receives Stelo glucose on a 3 hour delay, so anything downstream, including Murph, works from a delayed record rather than live values.",
      "Murph has no glucose sensor of its own and cannot show an Apple Watch glucose view. It reads the data Stelo shares and works with it in conversation.",
    ],
    useTogether:
      "Wear Stelo and keep its app for live glucose and the AI coach. Share glucose to Apple Health on iPhone and connect Apple Health to Murph. Then ask Murph to read a week of glucose next to your meals, sleep, symptoms, and labs, set a small experiment, and add the reminders to carry it out.",
  },
  {
    aliases: ["Lingo by Abbott", "Lingo biosensor"],
    category: "wearables",
    chooseCompetitor:
      "Choose Lingo if you want a 14 day over the counter glucose biosensor with a daily Lingo Count, meal logging, weekly reports, and habit challenges built around your glucose.",
    chooseMurph:
      "Choose Murph if you want one assistant that reads your Lingo glucose through Apple Health beside your meals, sleep, symptoms, labs, and records, keeps the plan going with reminders, and handles the errands around it.",
    competitor: {
      clinicalRole:
        "Lingo's terms describe the Lingo Glucose System as an FDA cleared Class II over the counter integrated continuous glucose monitor for people 18 and older who are not on insulin, located in the United States. It is not intended to diagnose disease, including diabetes, and Lingo says the data is not medical advice and should not drive medical action without a healthcare professional.",
      followThrough:
        "Lingo gives a daily Lingo Count to stay within, a weekly report with recommendations based on meals and activity, and challenges for testing new eating and exercise routines. The pages reviewed do not describe human coaching.",
      format:
        "A 14 day biosensor worn on the back of the upper arm, read in the Lingo app, which shows minute by minute glucose alongside meals and activity.",
      hardware:
        "Each biosensor is intended to last 14 days. Lingo reports that 77.1 percent of biosensors lasted the full 14 days and 14.7 percent may last less than 11 days. A compatible phone is required.",
      inputs:
        "Glucose from the biosensor, meals logged by photo or search, and height, sex, steps, weight, and workouts read from Apple Health, with workouts logged automatically on the glucose graph.",
      insightStyle:
        "A daily Lingo Count that summarizes glucose exposure, a real time glucose graph, weekly reports with recommendations, and coaching content about foods that work for your body.",
      platforms:
        "An iPhone app on the App Store. Lingo sends 5 minute glucose values in the 55 to 200 mg/dL range to Apple Health at a 3 hour delay and reads activity data back from Apple Health.",
      pricing:
        "When reviewed, a two week trial with one biosensor cost $54 and did not renew, a four week plan with two biosensors cost $89, and a twelve week subscription with six biosensors cost $249 and renewed every twelve weeks unless canceled.",
      primaryJob:
        "Show people who do not use insulin how food, exercise, and sleep affect their glucose so they can adjust habits over two to twelve weeks.",
    },
    competitorEvidence: {
      clinicalRole: [2, 1],
      followThrough: [1, 5],
      format: [1, 5],
      hardware: [1],
      inputs: [3, 5],
      insightStyle: [5, 1],
      platforms: [3, 5],
      pricing: [1],
      primaryJob: [1, 5],
    },
    faqs: [
      {
        answer:
          "Lingo's terms call the Lingo Glucose System an FDA cleared Class II over the counter integrated continuous glucose monitor for adults not on insulin. It is not intended to diagnose disease, including diabetes, and Lingo says its data is not medical advice.",
        question: "Is Lingo a medical device?",
      },
      {
        answer:
          "Yes, on iPhone. Connect Lingo to Apple Health in the app, then connect Apple Health to Murph. Lingo sends 5 minute glucose values to Apple Health at a 3 hour delay and only within its 55 to 200 mg/dL range, so Murph sees a delayed, bounded record.",
        question: "Can Murph read Lingo glucose?",
      },
      {
        answer:
          "Each biosensor is intended for 14 days. Lingo reports that 77.1 percent lasted the full 14 days and 14.7 percent may last less than 11 days. Plans run from a single two week biosensor to a twelve week subscription with six biosensors.",
        question: "How long does a Lingo biosensor last?",
      },
    ],
    headline:
      "Lingo turns two weeks of glucose into a daily count. Murph reads it next to the rest of your health.",
    integration: "apple-health",
    lastVerified: "2026-09-04",
    metaDescription:
      "Lingo by Abbott is an over the counter 14 day glucose biosensor with a daily Lingo Count. Murph is a personal health assistant that reads Lingo glucose through Apple Health beside meals.",
    name: "Lingo",
    quickComparison: [
      { capability: "Continuous glucose readings", competitor: "yes", evidence: "inputs", murph: "connected" },
      { capability: "Daily glucose exposure count", competitor: "yes", evidence: "insightStyle", murph: "no" },
      { capability: "Weekly metabolic reports", competitor: "yes", evidence: "followThrough", murph: "limited" },
      { capability: "Photo meal logging", competitor: "yes", evidence: "inputs", murph: "yes" },
      { capability: "Apple Health sync", competitor: "yes", evidence: "platforms", murph: "yes" },
      { capability: "Tests what works for you", competitor: "limited", evidence: "followThrough", murph: "yes" },
      { capability: "Works without a sensor", competitor: "no", evidence: "hardware", murph: "yes" },
      { capability: "Works in iMessage or Telegram", competitor: "no", evidence: "format", murph: "yes" },
      { capability: "Handles health errands", competitor: "no", evidence: "followThrough", murph: "yes" },
      { capability: "Free start without a card", competitor: "no", evidence: "pricing", murph: "yes" },
    ],
    relationship: "complement",
    slug: "abbott-lingo",
    sources: [
      { label: "Lingo plans and pricing", url: "https://www.hellolingo.com/products" },
      { label: "Lingo terms of use", url: "https://www.hellolingo.com/terms-of-use" },
      { label: "Lingo Apple Health support article", url: "https://support-us.hellolingo.com/hc/en-us/articles/38768258327451-How-do-I-connect-Lingo-to-Apple-Health" },
      { label: "Lingo privacy notice", url: "https://www.hellolingo.com/privacy-notice" },
      { label: "Lingo by Abbott App Store listing", url: "https://apps.apple.com/us/app/id1670445335" },
    ],
    tradeoffs: [
      "Lingo is limited to adults in the United States who do not use insulin, and it is not a diagnostic tool. Some biosensors fall short of 14 days, which changes the real cost per day.",
      "Apple Health only receives glucose between 55 and 200 mg/dL and only after a 3 hour delay, so averages in Apple Health and in Murph can differ from the Lingo app.",
      "Murph has no biosensor and no Lingo Count. It reads what Lingo shares through Apple Health and works with it in conversation rather than on a glucose graph.",
    ],
    useTogether:
      "Keep Lingo for the live graph, the Lingo Count, and its weekly report. Turn on Apple Health sharing, connect Apple Health to Murph, and ask Murph to compare glucose with your meals, sleep, and symptoms, then run a change against your own baseline and remind you to log it.",
  },
  {
    aliases: ["FreeStyle Libre 3 Plus", "FreeStyle Libre 2 Plus", "Libre by Abbott"],
    category: "wearables",
    chooseCompetitor:
      "Choose FreeStyle Libre if you have diabetes and your clinician prescribes a continuous glucose monitor with alarms, minute by minute readings, caregiver sharing, and compatibility with automated insulin dosing systems.",
    chooseMurph:
      "Choose Murph if you want your Libre glucose read beside your meals, sleep, symptoms, labs, and records in one conversation, with help on refills, appointments, and the plan you and your clinician agree on.",
    competitor: {
      clinicalRole:
        "FreeStyle Libre is a prescription only continuous glucose monitor. The Libre 3 Plus and Libre 2 Plus sensors are indicated for managing diabetes in people 2 and older, are intended to replace blood glucose testing for treatment decisions unless otherwise indicated, and can be used with compatible automated insulin dosing systems.",
      followThrough:
        "Alarms for low and high glucose, LibreLinkUp sharing with family or caregivers, LibreView reports for clinicians, and a Libre Assist feature that describes how foods affect glucose. Alarms can be silenced for up to six hours.",
      format:
        "A sensor worn for 15 days that streams readings every minute to the Libre app or a Libre reader. The Libre app for Apple Watch shows readings on the wrist when paired with the phone.",
      hardware:
        "Libre 3 Plus and Libre 2 Plus sensors last 15 days. Fingersticks are still required when readings do not match symptoms or alarms, readings can be less accurate in the first 12 hours, and more than 1,000 mg of vitamin C a day can falsely raise readings.",
      inputs:
        "Interstitial glucose from the sensor every minute, plus notes and food entries in the app. LibreView collects data for clinician review and LibreLinkUp shares it with chosen followers.",
      insightStyle:
        "Real time readings with trend arrows, alarms, interactive glucose graphs, 7 to 90 day history charts, and Libre Assist food impact insights.",
      platforms:
        "The Libre by Abbott app requires iOS 16 or later and supports Apple Watch on watchOS 10 or later. Abbott says its apps work only with certain phones and operating systems and asks users to check its compatibility list.",
      pricing:
        "Prices are not published because the sensors are prescription products billed through insurance or pharmacy pricing. Abbott says more people pay $0 to $20 for Libre than for Dexcom and offers eligible patients a first sensor at $0 copay. The app is free.",
      primaryJob:
        "Replace routine fingersticks for people with diabetes by streaming glucose readings, alarms, and reports to a phone, a reader, and their care team.",
    },
    competitorEvidence: {
      clinicalRole: [3, 1],
      followThrough: [2, 5],
      format: [1, 2, 5],
      hardware: [1, 3],
      inputs: [2, 5],
      insightStyle: [2, 5],
      platforms: [2, 5],
      pricing: [1, 2],
      primaryJob: [1, 3],
    },
    faqs: [
      {
        answer:
          "Yes. Abbott marks FreeStyle Libre as a prescription only product, and the safety information says federal law restricts the device to sale by or on the order of a physician. Dexcom Stelo and Abbott Lingo are the over the counter options for adults not on insulin.",
        question: "Do I need a prescription for FreeStyle Libre?",
      },
      {
        answer:
          "Yes. Murph offers direct connections for FreeStyle Libre and Abbott LibreView, so glucose history can sit beside your meals, sleep, labs, and records. Murph does not replace the Libre app, its alarms, or your clinician's treatment decisions.",
        question: "Can Murph read FreeStyle Libre data?",
      },
      {
        answer:
          "For most treatment decisions, yes, according to its indications. Abbott still requires a fingerstick when readings or alarms do not match how you feel, during the first 12 hours of sensor wear, and when readings are questionable.",
        question: "Does Libre replace fingersticks?",
      },
    ],
    headline:
      "FreeStyle Libre streams prescription glucose readings and alarms. Murph reads the history and helps you act on it.",
    integration: "direct",
    lastVerified: "2026-09-04",
    metaDescription:
      "FreeStyle Libre is Abbott's prescription CGM with 15 day sensors and alarms. Murph is a personal health assistant that reads Libre data beside your meals, labs, and records.",
    name: "FreeStyle Libre",
    quickComparison: [
      { capability: "Prescription CGM readings", competitor: "yes", evidence: "inputs", murph: "connected" },
      { capability: "Low and high glucose alarms", competitor: "yes", evidence: "followThrough", murph: "no" },
      { capability: "Automated insulin dosing support", competitor: "yes", evidence: "clinicalRole", murph: "no" },
      { capability: "Caregiver glucose sharing", competitor: "yes", evidence: "followThrough", murph: "limited" },
      { capability: "Food impact insights", competitor: "yes", evidence: "insightStyle", murph: "yes" },
      { capability: "Long term glucose charts", competitor: "yes", evidence: "insightStyle", murph: "yes" },
      { capability: "Wearable and lab context", competitor: "limited", evidence: "inputs", murph: "yes" },
      { capability: "Works in iMessage or Telegram", competitor: "no", evidence: "format", murph: "yes" },
      { capability: "Handles health errands", competitor: "no", evidence: "followThrough", murph: "yes" },
      { capability: "Free start without a card", competitor: "no", evidence: "pricing", murph: "yes" },
    ],
    relationship: "complement",
    slug: "freestyle-libre",
    sources: [
      { label: "FreeStyle Libre US overview", url: "https://www.freestyle.abbott/us-en/home.html" },
      { label: "Libre app features", url: "https://www.freestyle.abbott/us-en/products/freestyle-libre-app.html" },
      { label: "FreeStyle Libre safety information", url: "https://www.freestyle.abbott/us-en/safety-information.html" },
      { label: "Abbott privacy policy", url: "https://www.abbott.com/en-us/privacy-policy" },
      { label: "Libre by Abbott App Store listing", url: "https://apps.apple.com/us/app/id6670330506" },
    ],
    tradeoffs: [
      "Libre is a prescription product for people with diabetes, so access, sensor supply, and cost run through a clinician and insurance rather than a checkout page.",
      "Sensors need fingerstick confirmation when readings and symptoms disagree, can read less accurately in the first 12 hours, and are affected by high vitamin C intake.",
      "Murph has no alarms, no reader, and no role in insulin dosing. It reads Libre data through its FreeStyle Libre and LibreView connections and supports the plan your clinician sets.",
    ],
    useTogether:
      "Keep the Libre app or reader for live readings, alarms, and treatment decisions with your clinician. Connect FreeStyle Libre or LibreView to Murph so glucose history sits beside meals, sleep, labs, and records, then use Murph for refill reminders, appointment prep, and questions to bring to your next visit.",
  },
  {
    aliases: ["AliveCor Kardia", "KardiaMobile 6L", "Kardia app"],
    category: "wearables",
    chooseCompetitor:
      "Choose KardiaMobile if you want an FDA cleared personal EKG that records a single lead or six lead reading in 30 seconds, flags common rhythms, and can be sent to a cardiologist for review.",
    chooseMurph:
      "Choose Murph if you want your Kardia readings read beside your symptoms, blood pressure, medications, labs, and records in one conversation, with reminders and errands handled along the way.",
    competitor: {
      clinicalRole:
        "Kardia devices are FDA cleared and CE marked to record, store, display, and transfer EKGs and to detect common arrhythmias. KardiaMobile detects normal sinus rhythm, atrial fibrillation, bradycardia, and tachycardia, and a KardiaCare membership adds PVCs, sinus rhythm with SVE, and sinus rhythm with wide QRS, plus board certified cardiologist reviews.",
      followThrough:
        "The Kardia app stores readings, shares them with your doctor, and tracks blood pressure, weight, and symptoms. KardiaCare adds four clinician reviews a year, automatic review of abnormal EKGs, heart health reports, medication tracking, and unlimited cloud storage.",
      format:
        "A small pad you touch for 30 seconds while the Kardia app records the EKG on your phone and shows a determination right away.",
      hardware:
        "KardiaMobile records a single lead EKG and KardiaMobile 6L records six leads. The app needs iOS 15 or later or a supported Android phone. A membership is not required to record EKGs.",
      inputs:
        "EKG recordings, heart rate, symptoms and notes, blood pressure and weight entered manually or from connected devices, and Apple Health data when you allow it.",
      insightStyle:
        "An instant determination on each EKG, trends over time, and optional cardiologist reports returned within 24 hours. KardiaCare Insights show EKG, blood pressure, and symptom trends by month.",
      platforms:
        "iPhone, iPad, Apple Watch, and Apple Vision on the App Store, plus Android. The app integrates with Apple Health and shares readings with your doctor from the app.",
      pricing:
        "When reviewed, KardiaMobile cost $79 and KardiaMobile 6L cost $129 with a $10 promotion. The app is free, KardiaCare memberships start at $11.99 a month, and a one off clinician review costs $39 without membership.",
      primaryJob:
        "Let people record a clinical quality EKG at home when they feel a symptom, get an instant reading, and share it with their doctor.",
    },
    competitorEvidence: {
      clinicalRole: [5, 1, 2],
      followThrough: [3, 6],
      format: [1, 6],
      hardware: [1, 2, 6],
      inputs: [4, 6],
      insightStyle: [3, 6],
      platforms: [6],
      pricing: [1, 2, 3],
      primaryJob: [1, 6],
    },
    faqs: [
      {
        answer:
          "Yes. AliveCor says Kardia is FDA cleared and CE marked to record single channel EKGs and detect common arrhythmias including AFib, bradycardia, tachycardia, and normal sinus rhythm. More determinations come with a KardiaCare membership.",
        question: "Is KardiaMobile FDA cleared?",
      },
      {
        answer:
          "No. The device records EKGs and shows the core determinations without a membership. KardiaCare, from $11.99 a month when reviewed, adds advanced determinations, four cardiologist reviews a year, heart health reports, and medication tracking.",
        question: "Do I need KardiaCare?",
      },
      {
        answer:
          "Yes. Murph offers a direct Kardia connection, so EKG determinations and related readings can sit beside your symptoms, blood pressure, medications, labs, and records. Murph does not interpret the EKG waveform or replace a cardiologist review.",
        question: "Can Murph read my Kardia data?",
      },
    ],
    headline:
      "KardiaMobile records a clinical EKG in 30 seconds. Murph puts the result in context and keeps the follow up moving.",
    integration: "direct",
    lastVerified: "2026-09-04",
    metaDescription:
      "KardiaMobile is AliveCor's FDA cleared personal EKG with single or six lead readings. Murph is a personal health assistant that reads Kardia data beside symptoms, labs, and records.",
    name: "KardiaMobile",
    quickComparison: [
      { capability: "Personal EKG recording", competitor: "yes", evidence: "inputs", murph: "connected" },
      { capability: "Arrhythmia determinations", competitor: "yes", evidence: "insightStyle", murph: "connected" },
      { capability: "Cardiologist EKG review", competitor: "yes", evidence: "clinicalRole", murph: "no" },
      { capability: "Blood pressure and weight logs", competitor: "yes", evidence: "inputs", murph: "yes" },
      { capability: "Doctor data sharing", competitor: "yes", evidence: "followThrough", murph: "yes" },
      { capability: "Wearable and lab context", competitor: "limited", evidence: "inputs", murph: "yes" },
      { capability: "Works without dedicated hardware", competitor: "no", evidence: "hardware", murph: "yes" },
      { capability: "Works in iMessage or Telegram", competitor: "no", evidence: "format", murph: "yes" },
      { capability: "Handles health errands", competitor: "no", evidence: "followThrough", murph: "yes" },
      { capability: "Free start without a card", competitor: "no", evidence: "pricing", murph: "yes" },
    ],
    relationship: "complement",
    slug: "kardiamobile",
    sources: [
      { label: "KardiaMobile 6L product page", url: "https://kardia.com/products/kardiamobile6l" },
      { label: "KardiaMobile product page", url: "https://kardia.com/products/kardiamobile" },
      { label: "KardiaCare membership", url: "https://kardia.com/kardiacare" },
      { label: "AliveCor privacy policy", url: "https://kardia.com/privacy/en" },
      { label: "AliveCor FDA clearance and CE marking FAQ", url: "https://alivecor.zendesk.com/hc/en-us/articles/115015799808-Is-Kardia-FDA-cleared-and-CE-marked" },
      { label: "Kardia App Store listing", url: "https://apps.apple.com/us/app/id579769143" },
    ],
    tradeoffs: [
      "KardiaMobile records only when you touch it, so it catches symptoms you notice rather than events you sleep through. Advanced determinations and cardiologist reviews sit behind KardiaCare.",
      "AliveCor's policy allows de identified data to be shared for research and marketing, and its website cookies count as a sale under California law unless you opt out.",
      "Murph has no EKG sensor and cannot read a waveform. It reads Kardia's determinations through the direct connection and helps with the questions, records, and errands around them.",
    ],
    useTogether:
      "Record with KardiaMobile when you feel a symptom and keep the Kardia app for the waveform and any cardiologist review. Connect Kardia to Murph so the determinations sit beside your blood pressure, medications, symptoms, and labs, and let Murph draft the note for your next appointment and remind you to bring the readings.",
  },
  {
    aliases: ["Aktiia", "Hilo Core", "Hilo Band"],
    category: "wearables",
    chooseCompetitor:
      "Choose Hilo if you want continuous wrist blood pressure trends across the day and night, calibrated with an included cuff, with reports you can bring to your doctor.",
    chooseMurph:
      "Choose Murph if blood pressure is one signal among your symptoms, sleep, medications, labs, and records, and you want an assistant that reads the trend, helps you test a change, and handles the follow up.",
    competitor: {
      clinicalRole:
        "In the United States, Hilo says Hilo Core is designed for wellness and awareness, not medical use, and its consumer health data policy calls it a wellness product and not a medical device. In the EU and UK, Hilo sells the same system as a CE Class IIa medical device under EU MDR, validated to ISO 81060-2. The included Hilo Cuff is an FDA cleared blood pressure monitor.",
      followThrough:
        "The app shows blood pressure patterns against sleep, activity, and daily routines, prompts recalibration every 30 days, and, with membership, generates doctor ready reports and tracks medications and notes.",
      format:
        "A screen free wrist band that takes roughly 50 readings over 24 hours and sends them to the Hilo Core app, plus an upper arm cuff for calibration.",
      hardware:
        "The Hilo Band runs up to 15 days per charge and recharges in about 90 minutes. The kit includes the Hilo Cuff for initial calibration and a recalibration every 30 days. The app needs iOS 16 or later or Android 8 or later with Bluetooth 5.0.",
      inputs:
        "Wrist optical signals converted to blood pressure estimates, cuff calibration readings, heart rate, movement, temperature, respiration, and sleep related data, plus notes and medication entries.",
      insightStyle:
        "Blood pressure trends over days and weeks, comparisons between time periods, and correlations with sleep, activity, and routines. Membership unlocks full history and report generation.",
      platforms:
        "The Hilo Core app for iPhone and Android. Members can automatically share data with Apple Health or Health Connect and generate reports for a clinician.",
      pricing:
        "When reviewed in the US, the band cost $89.99 and the required membership cost $149.99 a year, for $239.98 in the first year with annual renewal. The UK page listed £79.99 for the band and cuff plus £119.99 for 12 months.",
      primaryJob:
        "Replace occasional cuff readings with continuous, calibrated blood pressure trends that show how daily life affects your numbers.",
    },
    competitorEvidence: {
      clinicalRole: [1, 4, 2],
      followThrough: [1, 5],
      format: [5, 1],
      hardware: [1],
      inputs: [3, 4],
      insightStyle: [1, 5],
      platforms: [1, 5],
      pricing: [1, 2, 5],
      primaryJob: [1, 2],
    },
    faqs: [
      {
        answer:
          "It depends where you buy it. In the United States Hilo positions Hilo Core as a wellness product rather than a medical device. In the EU and UK the system carries a CE Class IIa medical device mark under EU MDR. The calibration cuff itself is an FDA cleared blood pressure monitor.",
        question: "Is Hilo a medical device?",
      },
      {
        answer:
          "Yes. An active membership is required and cost $149.99 a year in the US when reviewed, on top of the $89.99 band. Membership covers full history, doctor ready reports, medication tracking, and sharing to Apple Health or Health Connect.",
        question: "Does Hilo require a subscription?",
      },
      {
        answer:
          "Yes, on iPhone, once you enable Apple Health sharing in the Hilo Core app, which is a membership feature, and connect Apple Health to Murph. Murph then reads the blood pressure trend beside your symptoms, medications, sleep, and labs.",
        question: "Can Murph read Hilo blood pressure data?",
      },
    ],
    headline:
      "Hilo measures blood pressure from your wrist all day. Murph reads the trend beside the rest of your health.",
    integration: "apple-health",
    lastVerified: "2026-09-04",
    metaDescription:
      "Hilo, formerly Aktiia, tracks cuffless blood pressure trends from a calibrated wrist band. Murph is a personal health assistant that reads the trend through Apple Health beside your records.",
    name: "Hilo",
    quickComparison: [
      { capability: "Cuffless blood pressure trends", competitor: "yes", evidence: "inputs", murph: "connected" },
      { capability: "Doctor ready blood pressure reports", competitor: "yes", evidence: "followThrough", murph: "limited" },
      { capability: "Medical device status", competitor: "limited", evidence: "clinicalRole", murph: "no" },
      { capability: "Medication tracking", competitor: "yes", evidence: "followThrough", murph: "yes" },
      { capability: "Notes and symptom logging", competitor: "yes", evidence: "inputs", murph: "yes" },
      { capability: "Works without dedicated hardware", competitor: "no", evidence: "hardware", murph: "yes" },
      { capability: "Wearable and lab context", competitor: "limited", evidence: "inputs", murph: "yes" },
      { capability: "Works in iMessage or Telegram", competitor: "no", evidence: "format", murph: "yes" },
      { capability: "Handles health errands", competitor: "no", evidence: "followThrough", murph: "yes" },
      { capability: "Free start without a card", competitor: "no", evidence: "pricing", murph: "yes" },
    ],
    relationship: "complement",
    slug: "hilo",
    sources: [
      { label: "Hilo Core product page", url: "https://us.hilo.com/products/hilo-core" },
      { label: "Hilo blood pressure monitor UK page", url: "https://hilo.com/en-gb/products/blood-pressure-monitor" },
      { label: "Hilo privacy policy", url: "https://us.hilo.com/policies/privacy-policy" },
      { label: "Hilo consumer health data privacy policy", url: "https://us.hilo.com/pages/consumer-health-data-privacy-policy" },
      { label: "Hilo Core App Store listing", url: "https://apps.apple.com/us/app/id6762610315" },
    ],
    tradeoffs: [
      "Hilo needs an active membership on top of the band, and the band has no screen. A cuff recalibration every 30 days is part of the routine.",
      "The same hardware is a wellness product in the US and a Class IIa medical device in Europe, so the regulatory status depends on where you buy it.",
      "Murph has no blood pressure sensor and no report generator. It reads the trend Hilo shares through Apple Health and works with it in conversation.",
    ],
    useTogether:
      "Wear the Hilo Band and keep the app for calibration, history, and doctor ready reports. Turn on Apple Health sharing and connect Apple Health to Murph. Then ask Murph to read the blood pressure trend beside your sleep, medications, symptoms, and labs, plan one change, and set the check ins to see whether it moves the numbers.",
  },
  {
    aliases: ["SleepIQ", "Sleep Number smart bed"],
    category: "sleep-mental",
    chooseCompetitor:
      "Choose Sleep Number if you want a smart bed that tracks sleep, heart rate, HRV, and breath rate with nothing to wear, gives a nightly SleepIQ score, and adjusts firmness and temperature from the app.",
    chooseMurph:
      "Choose Murph if you want sleep read beside your stress, meals, symptoms, workouts, labs, and records in one conversation, with help testing changes and following through, and you do not want to buy a bed to get started.",
    competitor: {
      clinicalRole:
        "Sleep Number says SleepIQ technology and the app are not medical devices, do not provide diagnostic data, and are not intended to diagnose, treat, cure, or prevent any disease. Its privacy policy adds that app information is for informational purposes only and not medical advice.",
      followThrough:
        "A SleepIQ score each morning, sleep trends over time, personalized sleep insights, circadian rhythm tracking that learns your schedule over seven days, and 30 day sleep health summaries you can share with a physician. The pages reviewed do not describe coaching or reminders.",
      format:
        "Sensors inside the mattress record sleep automatically. You review results and control the bed in the Sleep Number app on your phone.",
      hardware:
        "A Sleep Number smart bed is required. Nothing is worn or charged. Beds started at $1,439 for ComfortMode, $2,549 for ComfortNext, and $4,399 for Climate when reviewed, and SleepIQ is built into the bed.",
      inputs:
        "Sleep duration, bed times, bed exits, restful and restless periods, and nightly averages for heart rate, heart rate variability, and breath rate from the full body sensor, plus workout data if you connect MapMyFitness.",
      insightStyle:
        "A daily SleepIQ score from 5 to 100, 7 day and 30 day biosignal trends with minimum, average, and maximum values, and insights about habits that may affect sleep. Biosignals are averages, not real time readings.",
      platforms:
        "The free Sleep Number app on iOS 15.1 or later and Android. It connects only MapMyFitness and Apple Health, and Apple Health receives sleep session start and end times. Nest, Alexa, and Google Home are not supported.",
      pricing:
        "The app and SleepIQ are included with a smart bed. When reviewed, beds started at $1,439 during a sale advertising up to 25 percent off, and there is no separate SleepIQ subscription on the pages reviewed.",
      primaryJob:
        "Track sleep and nightly biosignals from the bed itself and turn them into a score, trends, and bed adjustments without a wearable.",
    },
    competitorEvidence: {
      clinicalRole: [1, 3, 4],
      followThrough: [1, 5],
      format: [1, 5],
      hardware: [1, 6],
      inputs: [1, 3, 2],
      insightStyle: [1, 3],
      platforms: [2, 5],
      pricing: [6, 5],
      primaryJob: [1, 3],
    },
    faqs: [
      {
        answer:
          "No. Sleep Number's support article says the Apple Health connection shares sleep session start and end times. Heart rate, HRV, and breath rate stay in the Sleep Number app, and the only other connection listed is MapMyFitness.",
        question: "Does Sleep Number share heart rate with Apple Health?",
      },
      {
        answer:
          "Only the sleep timing. Connect Apple Health in the Sleep Number app and connect Apple Health to Murph on iPhone, and Murph can read when your sleep sessions start and end. Your SleepIQ score and biosignals do not leave the Sleep Number app, so share those with Murph yourself if you want them in the conversation.",
        question: "Can Murph read my Sleep Number data?",
      },
      {
        answer:
          "No. Sleep Number says the bed and app are not medical devices and do not provide diagnostic data. Heart rate, HRV, and breath rate are nightly averages meant for trends, and Sleep Number tells users to contact a doctor about unusual patterns.",
        question: "Is SleepIQ a medical measurement?",
      },
    ],
    headline:
      "Sleep Number measures your night from the mattress. Murph reads the timing and talks through the rest.",
    integration: "apple-health",
    lastVerified: "2026-09-04",
    metaDescription:
      "Sleep Number smart beds score sleep and track heart rate, HRV, and breath rate with nothing to wear. Murph is a personal health assistant that reads sleep timing through Apple Health.",
    name: "Sleep Number",
    quickComparison: [
      { capability: "Nightly sleep timing", competitor: "yes", evidence: "platforms", murph: "connected" },
      { capability: "In mattress sleep sensing", competitor: "yes", evidence: "hardware", murph: "no" },
      { capability: "Overnight heart and breath rate", competitor: "yes", evidence: "inputs", murph: "limited" },
      { capability: "Composite sleep score", competitor: "yes", evidence: "insightStyle", murph: "no" },
      { capability: "Physician ready sleep summaries", competitor: "yes", evidence: "followThrough", murph: "yes" },
      { capability: "Longitudinal history", competitor: "yes", evidence: "inputs", murph: "yes" },
      { capability: "Works without dedicated hardware", competitor: "no", evidence: "hardware", murph: "yes" },
      { capability: "Works in iMessage or Telegram", competitor: "no", evidence: "format", murph: "yes" },
      { capability: "Handles health errands", competitor: "no", evidence: "followThrough", murph: "yes" },
      { capability: "Free start without a card", competitor: "no", evidence: "pricing", murph: "yes" },
    ],
    relationship: "complement",
    slug: "sleep-number",
    sources: [
      { label: "What is SleepIQ technology", url: "https://support.sleepnumber.com/hc/en-us/articles/115005308647-What-is-SleepIQ-Technology" },
      { label: "Connect apps to the Sleep Number app", url: "https://support.sleepnumber.com/hc/en-us/articles/235239727-Connect-Your-Apps-and-Smart-Devices-to-the-Sleep-Number-App" },
      { label: "Sleep Number biosignals explained", url: "https://support.sleepnumber.com/hc/en-us/articles/8897936353559-Sleep-Number-App-My-Biosignals-Heart-Rate-HRV-Breath-Rate-Explained" },
      { label: "Sleep Number privacy policy", url: "https://www.sleepnumber.com/pages/legal-privacy-policy" },
      { label: "Sleep Number App Store listing", url: "https://apps.apple.com/us/app/id811684463" },
      { label: "Sleep Number smart beds and pricing", url: "https://www.sleepnumber.com/" },
    ],
    tradeoffs: [
      "Sleep Number's tracking requires buying one of its beds, which started at $1,439 when reviewed, and the biosignals are nightly averages rather than real time readings.",
      "The app connects only MapMyFitness and Apple Health, and Apple Health gets just sleep session times. Your score, heart rate, HRV, and breath rate stay inside the Sleep Number app.",
      "Murph cannot sense sleep from a mattress, has no SleepIQ score, and only receives sleep timing from Sleep Number through Apple Health. Biosignals reach Murph only if you share them yourself.",
    ],
    useTogether:
      "Sleep on the bed and keep the Sleep Number app for the SleepIQ score, biosignals, and bed controls. Connect Apple Health in the app and to Murph on iPhone so sleep timing lands beside your stress, meals, workouts, symptoms, and labs. Paste in a biosignal trend when you want Murph to weigh it in a plan or an experiment.",
  },
  {
    aliases: ["Suunto Race S", "Suunto app", "Suunto Race"],
    category: "wearables",
    chooseCompetitor:
      "Choose Suunto if you want a sports watch with dual band GPS, free offline maps, 115 or more sport modes, and training load, recovery, sleep, and HRV tracking, with a free app and no subscription.",
    chooseMurph:
      "Choose Murph if you want your Suunto training, sleep, and recovery data read beside your meals, symptoms, labs, and records in one conversation, with plans, reminders, and errands handled there too.",
    competitor: {
      clinicalRole:
        "Suunto presents Race S as a sports watch for training and outdoor use. The product page, app page, and privacy policy reviewed do not describe the watch or app as a medical device or list any regulatory clearance.",
      followThrough:
        "Suunto Coach AI supervises workouts and gives advice, the watch reports training load, progress, and recovery, and the app shows long term trends, plans routes and workouts, and shares to 200 or more partner services such as Strava, TrainingPeaks, and komoot.",
      format:
        "A watch with an AMOLED display and digital crown, paired with the Suunto app on a phone for analysis, offline maps, and sharing.",
      hardware:
        "Suunto Race S weighs 60 grams, has integrated wrist heart rate, and is water resistant to 50 meters. Battery runs up to 9 days in smartwatch mode, 30 hours with all systems GNSS and multi band, and 120 hours in power saving modes.",
      inputs:
        "Wrist heart rate, HRV from sleep, sleep duration and stages, daily resource level, stress and recovery status, steps and calories, GNSS location and altitude, blood oxygen for altitude acclimation, and menstrual cycle tracking in the app.",
      insightStyle:
        "Training load and recovery feedback calculated from HRV, daily resource and stress status, sleep summaries, fatigue and recovery time charts, and heatmaps showing popular routes.",
      platforms:
        "The Suunto app is free on iOS and Android, connects with Apple Health, and links to partner services. The App Store lists iPhone, iPad, Mac, Apple Vision, and Apple Watch support and requires iOS 17 or later.",
      pricing:
        "When reviewed, Suunto Race S All Black was on sale for $279 from $349, and the Suunto app was free with no subscription mentioned on the pages reviewed.",
      primaryJob:
        "Track training, navigation, sleep, and recovery on a watch built for endurance and outdoor sports, then analyze it in a free app.",
    },
    competitorEvidence: {
      clinicalRole: [1, 2, 3],
      followThrough: [1, 2],
      format: [1, 2],
      hardware: [1],
      inputs: [1, 3, 2],
      insightStyle: [1, 4],
      platforms: [2, 4],
      pricing: [1, 2],
      primaryJob: [1, 2],
    },
    faqs: [
      {
        answer:
          "The pages reviewed present the Suunto app as free on iOS and Android with no subscription. The watch is the purchase; Race S All Black was $279 on sale from $349 when reviewed.",
        question: "Does the Suunto app cost anything?",
      },
      {
        answer:
          "Yes. Murph offers a direct Suunto connection, so workouts, sleep, HRV, and recovery can sit beside your meals, symptoms, labs, and records. Murph has no GPS or maps and does not replace the watch or the Suunto app.",
        question: "Can Murph read Suunto data?",
      },
      {
        answer:
          "Yes. Race S tracks sleep duration, bed times, deep, light, and REM sleep, heart rate during sleep, and HRV from sleep, and uses HRV for its training load and recovery feedback along with a daily resource level.",
        question: "Does Suunto track sleep and HRV?",
      },
    ],
    headline:
      "Suunto tracks the run, the climb, and the recovery. Murph reads it beside the rest of your health.",
    integration: "direct",
    lastVerified: "2026-09-04",
    metaDescription:
      "Suunto watches track dual band GPS training, sleep, HRV, and recovery with a free app. Murph is a personal health assistant that reads Suunto data beside your meals, labs, and records.",
    name: "Suunto",
    quickComparison: [
      { capability: "Dual band GPS tracking", competitor: "yes", evidence: "hardware", murph: "connected" },
      { capability: "Sleep HRV and training load", competitor: "yes", evidence: "insightStyle", murph: "connected" },
      { capability: "Offline maps and navigation", competitor: "yes", evidence: "format", murph: "no" },
      { capability: "Partner app connections", competitor: "yes", evidence: "platforms", murph: "yes" },
      { capability: "Adaptive training guidance", competitor: "yes", evidence: "followThrough", murph: "yes" },
      { capability: "Works without dedicated hardware", competitor: "no", evidence: "hardware", murph: "yes" },
      { capability: "Wearable and lab context", competitor: "limited", evidence: "inputs", murph: "yes" },
      { capability: "Works in iMessage or Telegram", competitor: "no", evidence: "format", murph: "yes" },
      { capability: "Handles health errands", competitor: "no", evidence: "followThrough", murph: "yes" },
      { capability: "Free start without a card", competitor: "no", evidence: "pricing", murph: "yes" },
    ],
    relationship: "complement",
    slug: "suunto",
    sources: [
      { label: "Suunto Race S product page", url: "https://us.suunto.com/products/suunto-race-s-all-black" },
      { label: "Suunto app overview", url: "https://us.suunto.com/pages/suunto-app" },
      { label: "Suunto privacy policy", url: "https://www.suunto.com/privacy-policy/" },
      { label: "Suunto App Store listing", url: "https://apps.apple.com/us/app/id1230327951" },
    ],
    tradeoffs: [
      "Suunto's value is the watch. The app is free, but tracking depends on wearing the hardware, and the current $279 sale price can change.",
      "Suunto's privacy policy allows partner services to access your data under their own policies and uses interest based advertising with third party partners.",
      "Murph has no GPS, no maps, and no training load model. It reads Suunto data through the direct connection and works with it in conversation.",
    ],
    useTogether:
      "Train and navigate with the watch and keep the Suunto app for maps, training load, and partner sharing. Connect Suunto to Murph so workouts, sleep, and HRV sit beside your meals, symptoms, and labs, then let Murph plan a recovery week, remind you about it, and check whether it worked against your own baseline.",
  },
  {
    aliases: ["Wahoo Fitness", "TICKR FIT", "ELEMNT", "KICKR"],
    category: "fitness",
    chooseCompetitor:
      "Choose Wahoo if you want cycling and running hardware such as TICKR heart rate monitors, ELEMNT bike computers, and KICKR trainers, with a free app that records workouts and shares them to the services you already use.",
    chooseMurph:
      "Choose Murph if you want your Wahoo workouts read beside your sleep, meals, symptoms, labs, and records in one conversation, with plans, reminders, and errands handled there.",
    competitor: {
      clinicalRole:
        "Wahoo is a sports hardware and training company. Its product pages and privacy policy reviewed do not describe any product as a medical device and do not list regulatory clearance.",
      followThrough:
        "The Wahoo app records running, cycling, and strength workouts, controls KICKR trainers, and can auto share every workout to authorized apps or email you a .FIT file. Wahoo Pro and Wahoo Core are in app purchases listed at $17.99 and $4.99.",
      format:
        "Hardware first. Heart rate monitors, bike computers, and trainers connect to the Wahoo app on a phone, and workouts flow on to partner services.",
      hardware:
        "When reviewed, the TICKR FIT optical armband cost $89.99, the TRACKR chest strap cost $99.99, the ELEMNT BOLT 3 bike computer cost $349.99, and the KICKR CORE 2 trainer cost $549.99. The app requires iOS 16 or later.",
      inputs:
        "Heart rate, cadence, speed, and power from Bluetooth sensors, workout time and distance, GPS location, and height, weight, and sleep data described in the privacy policy.",
      insightStyle:
        "Workout records and summaries in the app, with deeper analysis handled by partners such as Strava, TrainingPeaks, and Xert after auto sharing.",
      platforms:
        "iPhone, iPad, and Apple Vision on the App Store, plus Android. Authorized sharing covers adidas Running, Apple Health on iOS, Coros, Dropbox, Google Health Connect on Android, Komoot, MapMyFitness, MapMyTracks, MyFitnessPal, RideWithGPS, Strava, TrainingPeaks, and Xert.",
      pricing:
        "The Wahoo app is free to download with Wahoo Pro at $17.99 and Wahoo Core at $4.99 as in app purchases. Devices are sold separately, from $89.99 for TICKR FIT to $549.99 for KICKR CORE 2 when reviewed, with Klarna and Affirm financing offered.",
      primaryJob:
        "Sell reliable training hardware and move every workout to the app and services a cyclist or runner already uses.",
    },
    competitorEvidence: {
      clinicalRole: [1, 5],
      followThrough: [6, 4],
      format: [1, 6],
      hardware: [1, 2, 3, 6],
      inputs: [5, 6],
      insightStyle: [6, 4],
      platforms: [6, 4],
      pricing: [6, 1, 3, 5],
      primaryJob: [1, 4],
    },
    faqs: [
      {
        answer:
          "The app is free and records running, cycling, and strength workouts, and it pairs with any Bluetooth Smart sensor. Wahoo's own hardware, such as TICKR FIT, ELEMNT, and KICKR, adds the heart rate, navigation, and trainer control the company is known for.",
        question: "Do I need Wahoo hardware to use the Wahoo app?",
      },
      {
        answer:
          "Yes. Murph offers a direct Wahoo connection, so workouts and heart rate can sit beside your sleep, meals, symptoms, and labs. On iPhone, Wahoo also shares to Apple Health, which Murph reads too.",
        question: "Can Murph read Wahoo workouts?",
      },
      {
        answer:
          "Wahoo's support article lists adidas Running, Apple Health on iOS, Coros, Dropbox, Google Health Connect on Android, Komoot, MapMyFitness, MapMyTracks, MyFitnessPal, RideWithGPS, Strava, TrainingPeaks, and Xert, with auto sharing per app and a .FIT file email option.",
        question: "Which apps does Wahoo share with?",
      },
    ],
    headline:
      "Wahoo builds the sensors, computers, and trainers. Murph reads the workouts beside the rest of your health.",
    integration: "direct",
    lastVerified: "2026-09-04",
    metaDescription:
      "Wahoo sells TICKR heart rate monitors, ELEMNT computers, and KICKR trainers with a free app. Murph is a personal health assistant that reads Wahoo workouts beside sleep, meals, and labs.",
    name: "Wahoo",
    quickComparison: [
      { capability: "Workout heart rate recording", competitor: "yes", evidence: "inputs", murph: "connected" },
      { capability: "Smart trainer control", competitor: "yes", evidence: "followThrough", murph: "no" },
      { capability: "Bike computer navigation", competitor: "yes", evidence: "hardware", murph: "no" },
      { capability: "Workout sharing to other apps", competitor: "yes", evidence: "platforms", murph: "yes" },
      { capability: "Strength workout logging", competitor: "yes", evidence: "followThrough", murph: "yes" },
      { capability: "Free start without a card", competitor: "yes", evidence: "pricing", murph: "yes" },
      { capability: "Works without dedicated hardware", competitor: "limited", evidence: "hardware", murph: "yes" },
      { capability: "Wearable and lab context", competitor: "limited", evidence: "inputs", murph: "yes" },
      { capability: "Works in iMessage or Telegram", competitor: "no", evidence: "format", murph: "yes" },
      { capability: "Handles health errands", competitor: "no", evidence: "followThrough", murph: "yes" },
    ],
    relationship: "complement",
    slug: "wahoo",
    sources: [
      { label: "Wahoo heart rate monitors", url: "https://www.wahoofitness.com/devices/running/heart-rate-monitors" },
      { label: "Wahoo ELEMNT bike computers", url: "https://www.wahoofitness.com/devices/bike-computers" },
      { label: "Wahoo KICKR bike trainers", url: "https://www.wahoofitness.com/devices/indoor-cycling/bike-trainers" },
      { label: "Wahoo app authorized apps", url: "https://support.wahoofitness.com/hc/en-us/articles/14467471126802-Authorized-Apps-Wahoo-app" },
      { label: "Wahoo privacy policy", url: "https://www.wahoofitness.com/privacy-policy" },
      { label: "Wahoo App Store listing", url: "https://apps.apple.com/us/app/id391599899" },
    ],
    tradeoffs: [
      "Wahoo's strengths are in hardware, and the app's analysis is light by design. Deeper review happens in partner services after sharing.",
      "Wahoo's privacy policy describes collecting location periodically while the app is open and sharing with social networks and authorized apps you approve.",
      "Murph has no sensors, no bike computer, and no trainer control. It reads Wahoo workouts through the direct connection and works with them in conversation.",
    ],
    useTogether:
      "Ride and run with Wahoo hardware and keep the Wahoo app for recording, trainer control, and sharing to Strava or TrainingPeaks. Connect Wahoo to Murph so workouts and heart rate sit beside your sleep, meals, symptoms, and labs, then ask Murph to plan the week, remind you, and check whether a change helped.",
  },
  {
    aliases: ["RENPHO Health", "RENPHO Elis 1", "Renpho scale"],
    category: "health-data",
    chooseCompetitor:
      "Choose RENPHO if you want an inexpensive Bluetooth scale that reports weight and 13 body composition metrics to a free app with unlimited profiles and Apple Health sync.",
    chooseMurph:
      "Choose Murph if you want your weight and body composition trend read beside your meals, workouts, sleep, labs, and records in one conversation, with a plan, reminders, and errands handled there.",
    competitor: {
      clinicalRole:
        "RENPHO says its scales are for daily use at home and should not be considered for medical purposes, and that a medical professional should be consulted before dietary or exercise changes. Its terms say the services do not provide medical advice, diagnosis, or treatment.",
      followThrough:
        "The RENPHO Health app charts each metric over time, produces reports you can share by email, and offers personalized insights and recommendations. The pages reviewed do not describe reminders, coaching, or accountability features.",
      format:
        "A Bluetooth scale that recognizes each user automatically and sends readings to the RENPHO Health app on a phone.",
      hardware:
        "The Elis 1 smart body scale cost $24.99 when reviewed and measures weight plus 12 more metrics. RENPHO also sells other scales and devices that pair with the same app.",
      inputs:
        "Weight, BMI, body fat percent, body water percent, skeletal muscle, fat free body weight, muscle mass, bone mass, protein, BMR, subcutaneous fat, visceral fat, and metabolic age from the scale, plus steps, exercise, sleep, and blood pressure from connected apps and devices.",
      insightStyle:
        "Trend charts for each body composition metric, cloud based analysis turned into charts and reports, and AI generated insights that RENPHO describes as informational rather than medical.",
      platforms:
        "iPhone on iOS 15.1 or later plus Mac, Apple Vision, and Apple Watch on the App Store, and Android. The app syncs body fat percent, BMI, and lean body mass to Apple Health and supports Google Health, Samsung Health, Fitbit, and MyFitnessPal connections.",
      pricing:
        "The RENPHO Health app is free. The Elis 1 scale cost $24.99 when reviewed and other models cost more.",
      primaryJob:
        "Give households a cheap connected scale that tracks weight and body composition for every member in one free app.",
    },
    competitorEvidence: {
      clinicalRole: [1, 4, 3],
      followThrough: [5, 3],
      format: [1, 5],
      hardware: [1, 5],
      inputs: [1, 3],
      insightStyle: [5, 3],
      platforms: [5, 2],
      pricing: [1, 5],
      primaryJob: [1, 5],
    },
    faqs: [
      {
        answer:
          "No. RENPHO says the scale is for daily use at home and should not be considered for medical purposes. Body fat, visceral fat, and metabolic age are estimates from bioimpedance, and RENPHO's terms say the services do not provide medical advice or diagnosis.",
        question: "Are RENPHO body composition readings medical measurements?",
      },
      {
        answer:
          "Yes. Murph offers a direct Renpho connection, so weight and body composition trends can sit beside your meals, workouts, sleep, and labs. On iPhone, RENPHO also syncs body fat percent, BMI, and lean body mass to Apple Health, which Murph reads too.",
        question: "Can Murph read RENPHO weight data?",
      },
      {
        answer:
          "Yes. The Elis 1 supports unlimited profiles with automatic user recognition, and the app keeps each person's data separate. Murph, by contrast, is one private conversation per person.",
        question: "Can several people use one RENPHO scale?",
      },
    ],
    headline:
      "RENPHO weighs and measures for $24.99. Murph reads the trend beside your meals, labs, and records.",
    integration: "direct",
    lastVerified: "2026-09-04",
    metaDescription:
      "RENPHO makes Bluetooth body composition scales with a free app and Apple Health sync. Murph is a personal health assistant that reads RENPHO data beside your meals, labs, and records.",
    name: "RENPHO",
    quickComparison: [
      { capability: "Body composition metrics", competitor: "yes", evidence: "inputs", murph: "connected" },
      { capability: "Weight trend charts", competitor: "yes", evidence: "insightStyle", murph: "connected" },
      { capability: "Multiple user profiles", competitor: "yes", evidence: "format", murph: "no" },
      { capability: "Apple Health sync", competitor: "yes", evidence: "platforms", murph: "yes" },
      { capability: "Free start without a card", competitor: "yes", evidence: "pricing", murph: "yes" },
      { capability: "Tests what works for you", competitor: "limited", evidence: "insightStyle", murph: "yes" },
      { capability: "Works without dedicated hardware", competitor: "no", evidence: "hardware", murph: "yes" },
      { capability: "Wearable and lab context", competitor: "limited", evidence: "inputs", murph: "yes" },
      { capability: "Works in iMessage or Telegram", competitor: "no", evidence: "format", murph: "yes" },
      { capability: "Handles health errands", competitor: "no", evidence: "followThrough", murph: "yes" },
    ],
    relationship: "complement",
    slug: "renpho",
    sources: [
      { label: "RENPHO Elis 1 smart body scale", url: "https://renpho.com/products/elis-1-smart-body-scale" },
      { label: "RENPHO Health app sync guide", url: "https://renpho.com/blogs/wellness-fitness-blog/can-t-sync-your-data-to-the-renpho-health-app-here-s-how" },
      { label: "RENPHO privacy policy", url: "https://renpho.com/pages/privacy-policy" },
      { label: "RENPHO terms of service", url: "https://renpho.com/policies/terms-of-service" },
      { label: "RENPHO Health App Store listing", url: "https://apps.apple.com/us/app/id1543340610" },
    ],
    tradeoffs: [
      "Bioimpedance estimates such as body fat, visceral fat, and metabolic age are home use figures, not clinical measurements, and RENPHO says so.",
      "RENPHO's privacy policy describes using data for personalized insights and targeted advertising and sharing it with service providers and marketing partners, though it says personal data is not sold.",
      "Murph has no scale and no household profiles. It reads RENPHO data through the direct connection and works with it in conversation for one person.",
    ],
    useTogether:
      "Step on the RENPHO scale and keep its app for the metric charts and household profiles. Connect Renpho to Murph so weight and body composition sit beside your meals, workouts, sleep, and labs, then ask Murph to track one change over a few weeks and remind you to weigh in on the same days.",
  },
  {
    aliases: ["Omron blood pressure monitors", "HeartGuide", "OMRON Platinum"],
    category: "health-data",
    chooseCompetitor:
      "Choose OMRON connect if you own or plan to buy an Omron blood pressure monitor and want readings synced over Bluetooth into color coded graphs you can share with family or a physician.",
    chooseMurph:
      "Choose Murph if blood pressure is one signal among your medications, symptoms, sleep, labs, and records, and you want an assistant that reads the trend, sets reminders, and handles the follow up.",
    competitor: {
      clinicalRole:
        "Omron describes its monitors as clinically validated, with the Platinum model screening for AFib on every measurement and the Complete model combining blood pressure with FDA cleared personal EKG technology from AliveCor. The app stores and displays readings; the pages reviewed do not describe clinician review or telehealth.",
      followThrough:
        "The free tier keeps a detailed history with basic reports and lets you share readings with family or physicians. Premium adds detailed reports with health insights, medication tracking with reminders, a care team, historic EKG data, and rewards for meeting goals, after a 30 day trial.",
      format:
        "A companion app for Omron cuffs, scales, thermometers, and EKG devices. Readings sync over Bluetooth and appear as color coded graphs and trends.",
      hardware:
        "Compatible devices include the Complete BP7900, Evolv BP7000, 10 Series BP7465, 5 Series BP7255, 3 Series BP7150, and Gold Wrist BP4350 monitors plus the BCM-500 body composition monitor and SC-150 scale, and Omron's support pages mark compatible products as OMRON connect compatible. When reviewed, the Platinum cuff listed at $90.99, Evolv at $119.99, and Complete at $163.99.",
      inputs:
        "Blood pressure, pulse, and irregular heartbeat or AFib flags from the cuff, single lead EKG from the Complete monitor, weight and BMI from Omron scales, temperature, and activity and sleep from the phone or Apple Health.",
      insightStyle:
        "Color coded graphs, trend views, and averages, with premium detailed reports and insights. Omron positions the app around managing high blood pressure over time.",
      platforms:
        "iPhone, iPad, and Apple Vision on iOS 17 or later, plus Android. The app integrates with Apple Health and is available only in the United States and Canada. Omron publishes a separate consumer health data privacy policy alongside its general privacy policy.",
      pricing:
        "The app is free to download. When reviewed, premium in app purchases were listed at $9.99 a month or $98.99 a year for blood pressure, $13.49 a month or $139.99 a year for blood pressure plus EKG, and $4.99 a month or $49.99 a year for EKG only, with a 30 day trial.",
      primaryJob:
        "Get readings off an Omron cuff and into a long term record that a person, their family, and their physician can review.",
    },
    competitorEvidence: {
      clinicalRole: [2, 3, 1],
      followThrough: [1, 6],
      format: [1, 6],
      hardware: [1, 2, 3, 5],
      inputs: [1, 2, 3, 6],
      insightStyle: [1, 6],
      platforms: [1, 6, 4],
      pricing: [6, 1],
      primaryJob: [1, 2],
    },
    faqs: [
      {
        answer:
          "Yes. The app is free and keeps unlimited readings with basic reports. Premium plans listed at $9.99 a month for blood pressure, $13.49 for blood pressure plus EKG, or $4.99 for EKG only when reviewed, after a 30 day trial, and add detailed reports, medication reminders, and a care team.",
        question: "Is the OMRON connect app free?",
      },
      {
        answer:
          "Yes. Murph offers a direct Omron connection, so blood pressure readings can sit beside your medications, symptoms, sleep, and labs. On iPhone, OMRON connect also writes to Apple Health, which Murph reads too. Murph does not replace the cuff or a clinician's review.",
        question: "Can Murph read my Omron readings?",
      },
      {
        answer:
          "Omron lists the Complete BP7900, Evolv BP7000, 10 Series BP7465, 5 Series BP7255, 3 Series BP7150, and Gold Wrist BP4350 monitors, along with the BCM-500 body composition monitor and SC-150 scale. The app is available in the United States and Canada.",
        question: "Which Omron monitors work with the app?",
      },
    ],
    headline:
      "OMRON connect keeps every cuff reading in one graph. Murph reads the trend beside the rest of your health.",
    integration: "direct",
    lastVerified: "2026-09-04",
    metaDescription:
      "OMRON connect syncs Omron blood pressure cuffs into graphs, reports, and Apple Health. Murph is a personal health assistant that reads Omron readings beside medications, labs, and records.",
    name: "OMRON connect",
    quickComparison: [
      { capability: "Validated blood pressure readings", competitor: "yes", evidence: "inputs", murph: "connected" },
      { capability: "AFib screening on the cuff", competitor: "yes", evidence: "clinicalRole", murph: "no" },
      { capability: "Blood pressure trend graphs", competitor: "yes", evidence: "insightStyle", murph: "connected" },
      { capability: "Physician report sharing", competitor: "yes", evidence: "followThrough", murph: "yes" },
      { capability: "Free start without a card", competitor: "yes", evidence: "pricing", murph: "yes" },
      { capability: "Reminders and check ins", competitor: "limited", evidence: "followThrough", murph: "yes" },
      { capability: "Works without dedicated hardware", competitor: "no", evidence: "hardware", murph: "yes" },
      { capability: "Wearable and lab context", competitor: "limited", evidence: "inputs", murph: "yes" },
      { capability: "Works in iMessage or Telegram", competitor: "no", evidence: "format", murph: "yes" },
      { capability: "Handles health errands", competitor: "no", evidence: "followThrough", murph: "yes" },
    ],
    relationship: "complement",
    slug: "omron-connect",
    sources: [
      { label: "OMRON connect app overview", url: "https://omronhealthcare.com/omron-connect-app" },
      { label: "OMRON Platinum upper arm monitor", url: "https://omronhealthcare.com/products/platinum-upper-arm-blood-pressure-monitor-bp5465" },
      { label: "OMRON Complete blood pressure and EKG monitor", url: "https://omronhealthcare.com/products/complete-wireless-upper-arm-blood-pressure-monitor-ekg-bp7900" },
      { label: "OMRON Healthcare privacy policy", url: "https://omronhealthcare.com/privacy-policy" },
      { label: "OMRON Healthcare support", url: "https://omronhealthcare.com/support" },
      { label: "OMRON connect App Store listing", url: "https://apps.apple.com/us/app/id1166317885" },
    ],
    tradeoffs: [
      "Medication reminders, detailed reports, and the care team sit in the premium tier, and the app is available only in the United States and Canada.",
      "The app keeps readings in its own graphs. Labs, symptoms, sleep from other devices, and records need another tool to sit beside the blood pressure trend.",
      "Murph has no cuff and cannot screen for AFib. It reads Omron readings through the direct connection and works with them in conversation.",
    ],
    useTogether:
      "Take readings with your Omron cuff and keep OMRON connect for the graphs and physician reports. Connect Omron to Murph so blood pressure sits beside your medications, symptoms, sleep, and labs. Then let Murph remind you to measure at the same times, track a change over a few weeks, and prepare the summary for your next visit.",
  },
  {
    aliases: ["Helio Ring", "Zepp Helio Ring"],
    category: "wearables",
    chooseCompetitor:
      "Choose the Amazfit Helio Ring if you want a titanium smart ring that tracks sleep, heart rate, SpO2, HRV, readiness, EDA stress, and skin temperature for $149.99 with no subscription.",
    chooseMurph:
      "Choose Murph if you want your ring data read beside your meals, symptoms, labs, and records in one conversation, with plans, reminders, and errands handled there, and you do not want to buy hardware to start.",
    competitor: {
      clinicalRole:
        "Amazfit says the Helio Ring and the Zepp app are not medical devices and cannot be used for medical purposes or as a basis for diagnosing any medical condition.",
      followThrough:
        "The Zepp app delivers sleep reports, readiness insights, and Zepp Aura content such as sleep sounds that adjust to you. The pages reviewed describe automated insights rather than coaching, reminders, or accountability.",
      format:
        "A screenless ring worn day and night, with all data and insights in the Zepp app on a phone.",
      hardware:
        "A titanium alloy outer ring with a resin inner ring, a BioTracker PPG heart rate sensor, an EDA sensor, and a temperature sensor. Battery lasts up to 4 days.",
      inputs:
        "Sleep stages including REM, sleep breathing quality, heart rate, blood oxygen saturation, heart rate variability, electrodermal activity, and temperature, plus meals logged by photo in the Zepp app. The Amazfit and Zepp website privacy policies say device and app data fall under separate product privacy policies.",
      insightStyle:
        "A readiness score with insights, sleep stage and breathing quality reports, HRV recovery trends, and stress readings from the EDA sensor.",
      platforms:
        "The Zepp app runs on iPhone on iOS 15 or later, plus Mac and Apple Vision, and on Android. Data syncs to Apple Health, Google Fit, Strava, adidas Running, komoot, and Relive.",
      pricing:
        "The ring cost $149.99 when reviewed with no subscription required, and the product page said Zepp Aura features are included. In the Zepp app, Zepp Aura Premium is listed separately at $9.99 a month or $29.99 to $49.99 a year and Zepp Fitness at $3.99 a month. Amazfit's US terms point to separate refund and warranty policies.",
      primaryJob:
        "Track sleep, recovery, and stress from a ring with no screen and no subscription, and pass the data to the apps people already use.",
    },
    competitorEvidence: {
      clinicalRole: [1],
      followThrough: [1, 5],
      format: [1],
      hardware: [1],
      inputs: [1, 5, 2, 4],
      insightStyle: [1, 5],
      platforms: [1, 5],
      pricing: [1, 5, 3],
      primaryJob: [1, 5],
    },
    faqs: [
      {
        answer:
          "No. The ring cost $149.99 when reviewed and Amazfit says no subscription is required for its features. The Zepp app does sell optional Zepp Aura Premium and Zepp Fitness plans, but the product page says Aura features come with the ring.",
        question: "Does the Amazfit Helio Ring need a subscription?",
      },
      {
        answer:
          "Yes. Murph offers a direct Zepp and Amazfit connection, so sleep, heart rate, HRV, and readiness can sit beside your meals, symptoms, labs, and records. On iPhone, Zepp also syncs to Apple Health, which Murph reads too.",
        question: "Can Murph read Helio Ring data?",
      },
      {
        answer:
          "No. Amazfit says the ring and the Zepp app are not medical devices and cannot be used for medical purposes or to diagnose any condition. Treat SpO2, HRV, temperature, and stress readings as wellness trends.",
        question: "Is the Helio Ring a medical device?",
      },
    ],
    headline:
      "Amazfit Helio Ring tracks sleep and recovery from your finger. Murph reads it beside the rest of your health.",
    integration: "direct",
    lastVerified: "2026-09-04",
    metaDescription:
      "Amazfit Helio Ring tracks sleep, HRV, SpO2, readiness, and stress for $149.99 with no subscription. Murph is a personal health assistant that reads Zepp data beside meals, labs, and records.",
    name: "Amazfit Helio Ring",
    quickComparison: [
      { capability: "Ring based sleep tracking", competitor: "yes", evidence: "inputs", murph: "connected" },
      { capability: "Readiness and HRV scores", competitor: "yes", evidence: "insightStyle", murph: "connected" },
      { capability: "Screenless ring form factor", competitor: "yes", evidence: "format", murph: "no" },
      { capability: "Photo meal logging", competitor: "yes", evidence: "inputs", murph: "yes" },
      { capability: "Third party fitness app sync", competitor: "yes", evidence: "platforms", murph: "yes" },
      { capability: "Works without dedicated hardware", competitor: "no", evidence: "hardware", murph: "yes" },
      { capability: "Wearable and lab context", competitor: "limited", evidence: "inputs", murph: "yes" },
      { capability: "Works in iMessage or Telegram", competitor: "no", evidence: "format", murph: "yes" },
      { capability: "Handles health errands", competitor: "no", evidence: "followThrough", murph: "yes" },
      { capability: "Free start without a card", competitor: "no", evidence: "pricing", murph: "yes" },
    ],
    relationship: "complement",
    slug: "amazfit-helio-ring",
    sources: [
      { label: "Amazfit Helio Ring product page", url: "https://us.amazfit.com/products/amazfit-helio-ring" },
      { label: "Amazfit US privacy policy", url: "https://us.amazfit.com/pages/privacy-policy" },
      { label: "Amazfit US terms of service", url: "https://us.amazfit.com/policies/terms-of-service" },
      { label: "Zepp privacy policy", url: "https://www.zepp.com/privacy-policy" },
      { label: "Zepp App Store listing", url: "https://apps.apple.com/us/app/id1127269366" },
    ],
    tradeoffs: [
      "Battery life is up to 4 days, shorter than many rings, and the ring has no screen, so everything runs through the Zepp app.",
      "The website privacy policies for Amazfit and Zepp cover their websites. Device and app data fall under separate product policies you have to find inside the app.",
      "Murph has no ring, no readiness score, and no EDA or temperature sensor. It reads Zepp data through the direct connection and works with it in conversation.",
    ],
    useTogether:
      "Wear the ring and keep the Zepp app for readiness, sleep reports, and Aura content. Connect Zepp to Murph so sleep, HRV, and stress sit beside your meals, symptoms, and labs, then ask Murph to test a bedtime change against your own baseline and remind you to keep it.",
  },
]);
