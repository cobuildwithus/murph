import { defineComparisons } from "../types";

export const HEALTH_COACHING_APP_COMPARISONS = defineComparisons([
  {
    aliases: ["Bevel Health", "Bevel: AI Health Coach"],
    category: "health-data",
    chooseCompetitor:
      "Choose Bevel if you want your Apple Watch, Oura, Garmin, or Amazfit data reconciled into Recovery, Sleep, Strain, Stress, and Biological Age scores, with a strength builder and a Pro AI coach layered on top.",
    chooseMurph:
      "Choose Murph if you want one ongoing conversation in iMessage or Telegram that reads wearables, labs, records, meals, and symptoms together, then runs personal experiments, sends reminders, and handles practical health errands without a score dashboard.",
    competitor: {
      clinicalRole:
        "Bevel is a consumer wellness product. Its App Store listing and terms say it is not a medical device, is not intended to diagnose, treat, cure, monitor, or prevent conditions, and that AI-generated scores and recommendations are not medical advice.",
      followThrough:
        "Bevel Intelligence, the Pro AI coach, sends scheduled check-ins with insights, reminders, and daily summaries, and can generate training plans and strength templates. Follow-through stays inside the app. There is no human coach and no help with appointments or paperwork.",
      format:
        "An iPhone and Apple Watch app built around score dashboards for Recovery, Sleep, Strain, Stress, and Energy Bank, plus a Strength Builder with live watch sync, a nutrition log, a journal, and a chat-style AI coach with selectable personalities.",
      hardware:
        "Bevel sells no device of its own. It needs an iPhone on iOS 18 or later and reads data from an Apple Watch or connected wearables. The homepage names Apple Watch, Oura, Garmin, and Amazfit, and release notes add Google Health devices such as the Fitbit Air.",
      inputs:
        "Wearable sleep, heart rate, HRV, workouts, and activity from connected sources, meals by photo, barcode, description, or a database of more than six million foods, glucose readings, habits such as hydration and screen time, cycle data, and, on Pro, uploaded lab results, bloodwork, clinical notes, and imaging reports. The homepage shows lab providers such as Labcorp and LifeLabs.",
      insightStyle:
        "Bevel turns raw data into single-number scores, an Energy Bank that combines recovery, sleep, strain, and stress, and a weekly Biological Age with per-biomarker contributions. Bevel Intelligence answers questions grounded in those metrics and can point to research.",
      platforms:
        "iPhone on iOS 18 or later, Apple Watch on watchOS 10.6 or later, and Apple silicon Macs. No Android app or web dashboard is documented, and all billing runs through the App Store.",
      pricing:
        "The free plan is described as permanently free and includes the core scores and tracking. Bevel Pro was $14.99 a month or $99.99 a year when reviewed and adds Bevel Intelligence with a weekly usage allowance, Health Records, Biological Age, and Family Sharing. Extra Intelligence credits cost $4.99 to $49.99.",
      primaryJob:
        "Reconcile data from several wearables into daily readiness, sleep, strain, and stress scores, then add nutrition, strength training, records, and an AI coach so the numbers turn into training and recovery decisions.",
    },
    competitorEvidence: {
      clinicalRole: [3, 5],
      followThrough: [1, 5],
      format: [1, 5],
      hardware: [1, 5],
      inputs: [1, 5],
      insightStyle: [1, 5],
      platforms: [2, 5],
      pricing: [2, 5],
      primaryJob: [1, 5],
    },
    faqs: [
      {
        answer:
          "Bevel's scores depend on sleep, heart rate, and activity data, so an Apple Watch or a connected wearable supplies most of the signal. The homepage names Apple Watch, Oura, Garmin, and Amazfit, and release notes add Google Health devices such as the Fitbit Air. Meals, habits, and health records can be logged without a wearable, but the public pages do not define the experience with no device at all.",
        question: "Do I need a wearable to use Bevel?",
      },
      {
        answer:
          "No Android app is documented. The App Store listing covers iPhone on iOS 18 or later, Apple Watch, and Apple silicon Macs, and billing runs through the App Store. Murph works on any phone with iMessage or Telegram and adds a web account.",
        question: "Does Bevel work on Android?",
      },
      {
        answer:
          "Only if the scores are not the point. Murph does not compute Recovery, Strain, Stress, or Biological Age, and it has no Strength Builder or smart alarm. It does read many of the same wearables directly, accepts labs and records, logs meals from a photo, and keeps the follow-up in one conversation that can also run experiments and handle errands.",
        question: "Can Murph replace Bevel?",
      },
    ],
    headline:
      "Bevel scores your recovery from every wearable. Murph carries the whole picture into a conversation.",
    lastVerified: "2026-09-04",
    metaDescription:
      "Bevel merges Apple Watch, Oura, Garmin, and Amazfit data into recovery, strain, and biological age scores. Murph is a personal health assistant for records, experiments, and errands.",
    name: "Bevel",
    quickComparison: [
      { capability: "Composite recovery and strain scores", competitor: "yes", evidence: "insightStyle", murph: "no" },
      { capability: "Biological age estimate", competitor: "yes", evidence: "insightStyle", murph: "no" },
      { capability: "Strength workout builder", competitor: "yes", evidence: "format", murph: "limited" },
      { capability: "Labs and records import", competitor: "yes", evidence: "inputs", murph: "yes" },
      { capability: "Reminders and check ins", competitor: "yes", evidence: "followThrough", murph: "yes" },
      { capability: "Works in iMessage or Telegram", competitor: "no", evidence: "format", murph: "yes" },
      { capability: "Android and web access", competitor: "no", evidence: "platforms", murph: "yes" },
      { capability: "Handles health errands", competitor: "no", evidence: "followThrough", murph: "yes" },
      { capability: "Tests what works for you", competitor: "limited", evidence: "insightStyle", murph: "yes" },
      { capability: "Open source option", competitor: "no", evidence: "platforms", murph: "yes" },
    ],
    relationship: "alternative",
    slug: "bevel",
    sources: [
      { label: "Bevel product overview", url: "https://www.bevel.health/" },
      { label: "Bevel membership and pricing", url: "https://help.bevel.health/en/articles/11583937" },
      { label: "Bevel terms of service", url: "https://www.bevel.health/terms-of-service" },
      { label: "Bevel privacy policy", url: "https://www.bevel.health/privacy-policy" },
      { label: "Bevel App Store listing", url: "https://apps.apple.com/us/app/bevel-ai-health-coach/id6456176249" },
    ],
    tradeoffs: [
      "Bevel's scores and Biological Age are easy to read, but its terms say AI-generated metrics may contain errors and are not medical advice. The public pages do not publish a validation method for Biological Age.",
      "Bevel is Apple only. There is no Android app or web dashboard, and Pro is billed through the App Store.",
      "Murph has no Recovery, Strain, Stress, or Biological Age score, no Strength Builder, and no Apple Watch app. People who want a dashboard to glance at each morning will miss that in Murph.",
    ],
    useTogether:
      "Keep Bevel for the morning scores and strength workouts, then bring the question behind a low recovery day to Murph, which can read the same wearables, add labs, records, meals, and symptoms, and follow up. No connection between the two is documented.",
  },
  {
    aliases: ["Vora AI", "Vora: AI Longevity Coach"],
    category: "health-assistants",
    chooseCompetitor:
      "Choose Vora if you want a readiness score, AI workout programming, photo nutrition with 35 or more nutrients, cycle-aware plans, and a calendar-linked daily planner in one iPhone or Android app.",
    chooseMurph:
      "Choose Murph if you would rather ask questions in iMessage or Telegram than manage a daily plan, and you want records, labs, wearables, meals, and symptoms read together with experiments, reminders, and health errands handled for you.",
    competitor: {
      clinicalRole:
        "Vora is a consumer coaching app. Its App Store listing says it is not a medical device and does not diagnose or treat conditions, and its terms describe the coaching as informational and not a substitute for professional medical or fitness advice.",
      followThrough:
        "Vora builds an AI daily plan, places workouts and reminders on a calendar grid, syncs with Apple, Google, and Outlook calendars, sends Morning and Night Briefs on Pro, and offers streak rewards and referrals. It does not document human coaching or help with appointments or paperwork.",
      format:
        "An iPhone and Android app with a home screen of health scores and tiles, a daily planner, a workout coach, a nutrition log, guided meditation, cycle tracking, and voice or text chat with six AI coach personalities. Apple Watch, Mac, and Vision Pro builds exist.",
      hardware:
        "Vora sells no device. Wearables are optional and reach it through Apple Health on iPhone, Health Connect on Android, or direct connections. Release notes describe direct Oura, Fitbit, and Garmin connections and add Eight Sleep, Huawei Health, and Xiaomi as sources.",
      inputs:
        "Sleep, HRV, resting heart rate, strain, workouts, steps, body measurements, glucose, blood pressure, meals by photo, barcode, or voice, supplements, water, cycle logs, calendar events, and uploaded lab reports. The App Store listing names Apple Health, Garmin, WHOOP, Oura, Fitbit, Strava, Peloton, Eight Sleep, and Dexcom among its sources.",
      insightStyle:
        "A Readiness score that combines HRV, resting heart rate, sleep, training load, and cycle phase, plus separate sleep, recovery, strain, and nutrition scoring with personal baselines and illness detection from temperature. Lab markers are filed by body system and explained in plain language. Structured personal experiments are not documented.",
      platforms:
        "iPhone on iOS 16 or later, Android through Google Play, Apple Watch on watchOS 11.5 or later, Apple silicon Macs, and Apple Vision Pro. Data syncs through Apple Health and Health Connect.",
      pricing:
        "The free tier needs no credit card and includes ten AI chats a day, photo and barcode food logging, workout suggestions, health scores, and sleep and cycle tracking. Vora Pro was $12.99 a month or $89.99 a year when reviewed, with a seven-day trial for new subscribers, and raises the chat limit to 100 a day while adding voice chat and daily briefs.",
      primaryJob:
        "Bring wearable, nutrition, workout, sleep, and calendar data into one AI coach that plans each day around the body's current readiness.",
    },
    competitorEvidence: {
      clinicalRole: [4, 6],
      followThrough: [1, 2, 6],
      format: [1, 6],
      hardware: [1, 3, 6],
      inputs: [3, 5, 6],
      insightStyle: [1, 6],
      platforms: [1, 6],
      pricing: [2, 4, 6],
      primaryJob: [1, 3],
    },
    faqs: [
      {
        answer:
          "Both routes exist. Release notes describe direct Oura, Fitbit, and Garmin connections and list Eight Sleep, Huawei Health, and Xiaomi as sources, while most other devices arrive through Apple Health on iPhone or Health Connect on Android. The pricing table still marks direct device integrations as coming soon, so check the current connection list in the app before relying on a specific device.",
        question: "Does Vora connect directly to wearables or only through Apple Health?",
      },
      {
        answer:
          "Yes. The free tier needs no card and includes ten AI chats a day, photo and barcode food logging, workout suggestions, scores, and sleep and cycle tracking. Pro adds voice chat, daily briefs, 100 chats a day, and Google Calendar sync for $12.99 a month or $89.99 a year, with a seven-day trial.",
        question: "Is Vora free?",
      },
      {
        answer:
          "Vora is a planner. It scores readiness and schedules your day around it inside an app. Murph is a conversation in iMessage or Telegram that reads wearables, labs, records, meals, and symptoms together, answers open-ended questions, runs personal experiments, and takes on errands such as scheduling and refills. Murph has no readiness score or workout programming.",
        question: "How is Murph different from Vora?",
      },
    ],
    headline:
      "Vora plans your day around a readiness score. Murph answers the question behind it.",
    lastVerified: "2026-09-04",
    metaDescription:
      "Vora is an AI coach for iPhone and Android that scores readiness and plans workouts, meals, and recovery. Murph is a personal health assistant for labs, records, experiments, and errands.",
    name: "Vora",
    quickComparison: [
      { capability: "Readiness and health scores", competitor: "yes", evidence: "insightStyle", murph: "no" },
      { capability: "AI workout programming", competitor: "yes", evidence: "primaryJob", murph: "limited" },
      { capability: "Cycle phase tracking", competitor: "yes", evidence: "inputs", murph: "no" },
      { capability: "Calendar aware daily planner", competitor: "yes", evidence: "followThrough", murph: "limited" },
      { capability: "Photo meal logging", competitor: "yes", evidence: "inputs", murph: "yes" },
      { capability: "Free start without a card", competitor: "yes", evidence: "pricing", murph: "yes" },
      { capability: "Works in iMessage or Telegram", competitor: "no", evidence: "format", murph: "yes" },
      { capability: "Handles health errands", competitor: "no", evidence: "followThrough", murph: "yes" },
      { capability: "Tests what works for you", competitor: "no", evidence: "insightStyle", murph: "yes" },
      { capability: "Open source option", competitor: "no", evidence: "platforms", murph: "yes" },
    ],
    relationship: "alternative",
    slug: "vora",
    sources: [
      { label: "Vora product overview", url: "https://askvora.com/" },
      { label: "Vora pricing", url: "https://askvora.com/pricing" },
      { label: "Vora integrations", url: "https://askvora.com/integrations" },
      { label: "Vora terms of service", url: "https://askvora.com/terms" },
      { label: "Vora privacy policy", url: "https://askvora.com/privacy" },
      { label: "Vora App Store listing", url: "https://apps.apple.com/us/app/vora-ai-longevity-coach/id6754351240" },
    ],
    tradeoffs: [
      "Vora's readiness score and daily plan are its strength, and Murph offers neither. People who want to be told what to do each morning will find Vora more directive.",
      "Vora's public pages disagree on connections. The pricing table marks direct device integrations as coming soon while release notes describe direct Oura, Fitbit, and Garmin links. Confirm your device in the app.",
      "Vora describes itself as informational and not a medical device. Its lab reading files markers by body system but is not a clinical review.",
    ],
    useTogether:
      "Keep Vora for the readiness score, workout programming, and daily plan. Bring lab results, records, symptoms, or a decision to Murph and let it run the experiment and the follow-up. No connection between the two is documented.",
  },
  {
    aliases: ["Kim by Oculi Medical", "Kim: Personal Health Assistant"],
    category: "health-data",
    chooseCompetitor:
      "Choose Kim if you want a free iPhone app that talks over your Apple Health data by voice or text, logs food, supplements, and mood, runs Personal Wellness Experiments, and gives a recovery forecast.",
    chooseMurph:
      "Choose Murph if you want the same kind of question-first assistant in iMessage or Telegram, with direct wearable and glucose connections beyond Apple Health, a records vault, health errands, group support, and an open source option.",
    competitor: {
      clinicalRole:
        "Kim is a wellness app from Oculi Medical Corp. Its listing and privacy policy say it is not a medical device, does not diagnose, treat, cure, prevent, or monitor disease, and does not prescribe supplements or dosing.",
      followThrough:
        "Kim offers simple reminders for logging, supplements, check-ins, habits, and routines, plus Personal Wellness Experiments that track a supplement, habit, or nutrition change against sleep, recovery, mood, or energy. It does not document human coaching or help with appointments, refills, or paperwork.",
      format:
        "An iPhone app with a dashboard, a voice mode, and a text chat. You can talk to Kim hands free or type, and it draws on saved logs, Apple Health trends, and recent conversations.",
      hardware:
        "No device is required or sold. An Apple Watch or any device that syncs into Apple Health adds automatic context, and Kim states that you can use it with manual logs and check-ins alone.",
      inputs:
        "Apple Health sleep, HRV, heart rate, workouts, steps, weight, and activity, meal photos with estimated calories and macros, barcode scans, supplements, mood, energy, soreness, symptoms, habits, and uploaded lab PDFs. Devices such as Oura, WHOOP, Garmin, and Fitbit reach Kim only through Apple Health.",
      insightStyle:
        "Conversational answers backed by your data and cited web sources, pattern detection across logs, a weekly body report, a supplement stack review against bloodwork and wearable data, a recovery forecast described as self-reflection rather than prediction, and experiment verdict screens.",
      platforms:
        "iPhone on iOS 16.4 or later with an Apple Watch companion on watchOS 10 or later. No Android or web version is documented. Chat, food photo analysis, and voice run through third-party AI providers named in the privacy policy.",
      pricing:
        "Kim was free on the App Store when reviewed with no in-app purchases listed. The product page notes that optional in-app purchases may apply.",
      primaryJob:
        "Turn Apple Health data plus daily food, supplement, and mood logs into a conversation that explains patterns and tests habits one at a time.",
    },
    competitorEvidence: {
      clinicalRole: [3, 4],
      followThrough: [2, 4],
      format: [2, 4],
      hardware: [2, 4],
      inputs: [1, 3, 4],
      insightStyle: [1, 2, 4],
      platforms: [3, 4],
      pricing: [2, 4],
      primaryJob: [2, 4],
    },
    faqs: [
      {
        answer:
          "Yes. Kim says you can use manual logs and check-ins alone. An Apple Watch or any device that syncs into Apple Health adds automatic sleep, HRV, and activity context, but there is no direct connection to Oura, WHOOP, Garmin, or Fitbit outside Apple Health.",
        question: "Does Kim work without an Apple Watch?",
      },
      {
        answer:
          "Kim was free on the App Store with no in-app purchases listed when reviewed. The product page adds that optional purchases may apply, so expect that to change.",
        question: "Is Kim free?",
      },
      {
        answer:
          "Both let you test one change against your own data. Kim's Personal Wellness Experiments track a supplement, habit, or nutrition change against Apple Health sleep, recovery, mood, or energy inside the app. Murph runs experiments across every connected source, including direct wearable, glucose, and lab data, and keeps the follow-up in iMessage or Telegram.",
        question: "How do Kim's experiments compare with Murph's?",
      },
    ],
    headline:
      "Kim talks over your Apple Health data. Murph talks over everything you connect.",
    lastVerified: "2026-09-04",
    metaDescription:
      "Kim is a free iPhone app that talks over Apple Health data by voice or text and runs wellness experiments. Murph is a personal health assistant across wearables, labs, records, and errands.",
    name: "Kim",
    quickComparison: [
      { capability: "Spoken voice mode", competitor: "yes", evidence: "format", murph: "no" },
      { capability: "Recovery forecast", competitor: "yes", evidence: "insightStyle", murph: "no" },
      { capability: "Supplement stack review", competitor: "yes", evidence: "insightStyle", murph: "limited" },
      { capability: "Tests what works for you", competitor: "yes", evidence: "followThrough", murph: "yes" },
      { capability: "Lab PDF upload", competitor: "yes", evidence: "inputs", murph: "yes" },
      { capability: "Free start without a card", competitor: "yes", evidence: "pricing", murph: "yes" },
      { capability: "Works in iMessage or Telegram", competitor: "no", evidence: "format", murph: "yes" },
      { capability: "Direct wearable connections", competitor: "no", evidence: "inputs", murph: "yes" },
      { capability: "Handles health errands", competitor: "no", evidence: "followThrough", murph: "yes" },
      { capability: "Open source option", competitor: "no", evidence: "platforms", murph: "yes" },
    ],
    relationship: "alternative",
    slug: "kim",
    sources: [
      { label: "Kim product overview", url: "https://www.oculimedical.com/" },
      { label: "Kim Apple Health assistant and experiments", url: "https://www.oculimedical.com/kim/best-ai-health-app" },
      { label: "Kim privacy policy", url: "https://www.oculimedical.com/legal-pages/privacy-policy" },
      { label: "Kim App Store listing", url: "https://apps.apple.com/us/app/kim-personal-health-assistant/id6763202025" },
    ],
    tradeoffs: [
      "Kim's voice mode and recovery forecast are its own, and Murph has neither. People who want to talk out loud to their data will prefer Kim.",
      "Kim only sees what reaches Apple Health, so it is iPhone only and has no direct wearable, glucose, or records connections. Its experiments are limited to that data.",
      "Kim was free with no purchases listed, but the product page warns optional purchases may apply. Its chat, photo, and voice features run through third-party AI providers named in the privacy policy.",
    ],
  },
  {
    aliases: ["Zero Longevity", "Zero Fasting", "Zero: Fasting & Food Tracker"],
    category: "nutrition",
    chooseCompetitor:
      "Choose Zero if intermittent fasting is your main habit and you want a one-tap fasting timer with zones and streaks, a daily Protein Score, photo meal logging, hydration goals, and an Apple Watch app.",
    chooseMurph:
      "Choose Murph if food is one thread among sleep, training, labs, and symptoms, and you want to log a meal from a photo in iMessage or Telegram, ask what it means, and test a change against your own baseline.",
    competitor: {
      clinicalRole:
        "Zero is a consumer app from Zero Longevity Science. Its listing says it is not a medical device and gives no medical advice, and its terms say the service is meant for people healthy enough to change diet and lifestyle, not for minors, and not for use during pregnancy or nursing.",
      followThrough:
        "Fasting timers, streaks, badges, notifications, motivating challenges built around protein and fasting targets, meal sharing with friends, and educational articles. No human coaching or help with appointments is documented.",
      format:
        "A fasting-first app for iPhone and Android with a timer, a Today view of health pillars, a timeline, a meal log, trend views, and an Apple Watch app that can start, end, and track a fast from the wrist.",
      hardware:
        "No device is sold or required. A phone is enough, and an Apple Watch adds wrist control of fasts and complications.",
      inputs:
        "Fast start and end times, meals by photo, text description, barcode, or saved meals, water, weight, activity, sleep, mood, and mindful minutes. The privacy policy names Apple Health, Oura, Fitbit, Biosense, and Google Fit as optional sources, and release notes describe Oura syncing.",
      insightStyle:
        "A Protein Score that balances daily calorie needs with a protein target, fasting zone explanations, meal breakdowns with protein front and center, hydration progress, and pattern-based insights about what is working in your routine.",
      platforms:
        "iPhone and Apple Watch through the App Store and Android through Google Play. Family Sharing is supported for some purchases.",
      pricing:
        "A free version covers the fasting timer and basic tracking, and new users get three free meal logs before meal logging requires Plus. Zero Plus in-app purchases were listed at $9.99 a month and $69.99 or $89.99 a year when reviewed, with a free trial available.",
      primaryJob:
        "Keep an intermittent fasting routine consistent and pair it with enough protein and water so weight changes without losing muscle.",
    },
    competitorEvidence: {
      clinicalRole: [3, 4],
      followThrough: [1, 4],
      format: [1, 4],
      hardware: [4],
      inputs: [1, 2, 4],
      insightStyle: [1, 4],
      platforms: [1, 4],
      pricing: [4],
      primaryJob: [1, 4],
    },
    faqs: [
      {
        answer:
          "The fasting timer and basic tracking are free, and new users get three free meal logs. Photo meal logging and the full feature set need Zero Plus, listed at $9.99 a month and $69.99 or $89.99 a year on the App Store when reviewed, with a free trial.",
        question: "Is Zero free?",
      },
      {
        answer:
          "Its privacy policy names Apple Health, Oura, Fitbit, Biosense, and Google Fit as optional sources, and release notes describe Oura syncing. Zero uses that data for its activity and sleep pillars, not to change your fasting plan.",
        question: "Does Zero connect to wearables?",
      },
      {
        answer:
          "Not with a timer. Murph can set fasting reminders, log meals from a photo, and note how a fasting window lines up with sleep, glucose, or training, but it has no fasting timer, zones, streaks, Protein Score, or Apple Watch app.",
        question: "Can Murph track fasting like Zero?",
      },
    ],
    headline:
      "Zero keeps the fasting clock. Murph keeps the rest of your health in the conversation.",
    lastVerified: "2026-09-04",
    metaDescription:
      "Zero is a fasting timer with a Protein Score, photo meal logging, and an Apple Watch app. Murph is a personal health assistant that reads meals beside sleep, labs, and training.",
    name: "Zero",
    quickComparison: [
      { capability: "Fasting timer and zones", competitor: "yes", evidence: "primaryJob", murph: "no" },
      { capability: "Protein Score targets", competitor: "yes", evidence: "insightStyle", murph: "no" },
      { capability: "Apple Watch app", competitor: "yes", evidence: "platforms", murph: "no" },
      { capability: "Photo meal logging", competitor: "yes", evidence: "inputs", murph: "yes" },
      { capability: "Free start without a card", competitor: "yes", evidence: "pricing", murph: "yes" },
      { capability: "Wearable and lab context", competitor: "limited", evidence: "inputs", murph: "yes" },
      { capability: "Works in iMessage or Telegram", competitor: "no", evidence: "format", murph: "yes" },
      { capability: "Handles health errands", competitor: "no", evidence: "followThrough", murph: "yes" },
      { capability: "Tests what works for you", competitor: "limited", evidence: "insightStyle", murph: "yes" },
      { capability: "Open source option", competitor: "no", evidence: "platforms", murph: "yes" },
    ],
    relationship: "alternative",
    slug: "zero-longevity",
    sources: [
      { label: "Zero product overview", url: "https://zerolongevity.com/" },
      { label: "Zero privacy policy", url: "https://www.zerolongevity.com/privacy-policy" },
      { label: "Zero terms of use", url: "https://www.zerolongevity.com/terms-of-use" },
      { label: "Zero App Store listing", url: "https://apps.apple.com/us/app/zero-fasting-food-tracker/id1168348542" },
    ],
    tradeoffs: [
      "Zero's timer, zones, streaks, and Protein Score give fasting a clear structure. Murph has no fasting timer, no Protein Score, and no Apple Watch app.",
      "Photo meal logging is limited to three free meals before Plus is required, and yearly Plus prices varied between $69.99 and $89.99 on the App Store.",
      "Zero's terms say the app is not for minors or for use during pregnancy or nursing, and that people with health conditions should check with a clinician before fasting.",
    ],
    useTogether:
      "Run your fasts in Zero and bring the bigger questions to Murph: how a fasting window relates to sleep, glucose, or training, and what to change next. No connection between the two is documented.",
  },
  {
    aliases: ["Simple: AI Weight Loss Coach", "Coach Avo"],
    category: "nutrition",
    chooseCompetitor:
      "Choose Simple if you want a weight loss program with an AI coach named Avo, daily actions and check-ins, photo food feedback, a Success Score, fasting schedules, beginner workouts, and a playful mascot that keeps you logging.",
    chooseMurph:
      "Choose Murph if weight sits beside sleep, labs, symptoms, or training in your life, and you want one assistant in iMessage or Telegram that logs meals from a photo, connects the threads, runs experiments, and handles the errands around them.",
    competitor: {
      clinicalRole:
        "Simple is a behavior change program for weight, not a clinic. Its privacy policy describes an onboarding health questionnaire and support that reviews medical safety questions, but the public pages do not describe clinician visits, prescriptions, or medical-device status.",
      followThrough:
        "Coach Avo creates daily actions, reaches out with tips, and on Premium runs daily personalized check-ins. Reminders match your schedule and logging, Blinky reacts to what you log, and streak rewards keep the habit going. No human coach or help with appointments is documented.",
      format:
        "A structured weight loss app for iPhone and Android with a coach chat, a food scanner, trackers for food, water, activity, weight, and fasting, beginner workout plans for pilates, yoga, and walking, an educational library, a Home Screen widget, and Apple Watch support.",
      hardware:
        "No device is sold or required. Apple Health and Apple Watch on iPhone and Health Connect on Android can supply activity data.",
      inputs:
        "An onboarding questionnaire about goals and habits, meals and groceries by photo or text, water, activity, weight, fasting windows, chat with Avo, and Apple Health or Health Connect data such as steps.",
      insightStyle:
        "Nutrition Scores for logged meals, Avo Vision feedback on a plate, menu, or grocery haul, a real-time Success Score, a recommended fasting schedule, and daily coaching grounded in behavior change rather than calorie counting.",
      platforms:
        "iPhone on iOS 18.3 or later, Apple Watch on watchOS 10 or later, Apple Vision Pro, and Android. The company behind it is AM APPS Ltd.",
      pricing:
        "The free version includes real-time answers from Avo, Nutrition Scores, and habit trackers. Premium unlocks daily check-ins, actions, and the education library. The company says prices vary by subscription length. App Store purchases were listed from $14.99 to $59.99 when reviewed, and onboarding offers change often.",
      primaryJob:
        "Guide sustainable weight loss through daily coaching, meal feedback, fasting, and habit building without calorie counting.",
    },
    competitorEvidence: {
      clinicalRole: [3, 4],
      followThrough: [1, 4],
      format: [1, 4],
      hardware: [3, 4],
      inputs: [1, 3, 4],
      insightStyle: [1, 4],
      platforms: [3, 4],
      pricing: [1, 2, 4],
      primaryJob: [1, 4],
    },
    faqs: [
      {
        answer:
          "No. Avo is Simple's AI coach. It answers questions, creates daily actions, and on Premium sends daily check-ins. Simple also mentions live chat for customer support, but the coaching itself is automated.",
        question: "Is Coach Avo a human?",
      },
      {
        answer:
          "The free version includes Avo answers, Nutrition Scores, and trackers. Premium prices vary by plan length and promotion, and App Store purchases ranged from $14.99 to $59.99 when reviewed. Check the exact renewal price in onboarding before paying.",
        question: "What does Simple cost?",
      },
      {
        answer:
          "Murph can log meals from a photo, set reminders, and keep a weight plan moving, but it has no Success Score, fasting schedule generator, workout plans, or mascot, and it does not apply firm program pressure. Murph fits when weight is one thread among several health questions.",
        question: "Can Murph replace Simple?",
      },
    ],
    headline:
      "Simple coaches weight loss with Avo. Murph connects food to the rest of your health.",
    lastVerified: "2026-09-04",
    metaDescription:
      "Simple pairs an AI coach named Avo with photo food feedback, fasting plans, and a Success Score. Murph is a personal health assistant that reads meals beside sleep, labs, and symptoms.",
    name: "Simple",
    quickComparison: [
      { capability: "Structured weight loss plan", competitor: "yes", evidence: "primaryJob", murph: "limited" },
      { capability: "Real time Success Score", competitor: "yes", evidence: "insightStyle", murph: "no" },
      { capability: "Guided workout plans", competitor: "yes", evidence: "format", murph: "limited" },
      { capability: "Photo meal logging", competitor: "yes", evidence: "inputs", murph: "yes" },
      { capability: "Reminders and check ins", competitor: "yes", evidence: "followThrough", murph: "yes" },
      { capability: "Wearable and lab context", competitor: "limited", evidence: "inputs", murph: "yes" },
      { capability: "Works in iMessage or Telegram", competitor: "no", evidence: "format", murph: "yes" },
      { capability: "Handles health errands", competitor: "no", evidence: "followThrough", murph: "yes" },
      { capability: "Tests what works for you", competitor: "no", evidence: "insightStyle", murph: "yes" },
      { capability: "Open source option", competitor: "no", evidence: "platforms", murph: "yes" },
    ],
    relationship: "alternative",
    slug: "simple",
    sources: [
      { label: "Simple product overview and FAQ", url: "https://simple.life/" },
      { label: "Simple help center", url: "https://help.simple.life/en/" },
      { label: "Simple privacy policy", url: "https://simple.life/privacy" },
      { label: "Simple App Store listing", url: "https://apps.apple.com/us/app/simple-ai-weight-loss-coach/id1467720176" },
    ],
    tradeoffs: [
      "Simple's daily actions, Success Score, and mascot are built to keep you logging. Murph does not apply that kind of program pressure and has no Success Score or workout plans.",
      "Prices vary by subscription length and promotion, and the App Store lists several Pro and Premium price points. Read the renewal terms before subscribing.",
      "Simple sees Apple Health or Health Connect activity but not labs, records, or glucose. Murph connects those directly and reads them together.",
    ],
  },
  {
    aliases: ["Lark Health", "Lark Technologies"],
    category: "health-assistants",
    chooseCompetitor:
      "Choose Lark if you qualify through insurance or an employer for a condition program with a 24/7 chat coach, a shipped smart scale, glucometer, or blood pressure monitor, live coaching sessions, and a CDC recognized diabetes prevention curriculum.",
    chooseMurph:
      "Choose Murph if you want an assistant that is not tied to a program or a plan sponsor, reads your own wearables, labs, and records, answers open-ended questions in iMessage or Telegram, and handles errands such as refills and appointments.",
    competitor: {
      clinicalRole:
        "Lark delivers digital coaching programs for prediabetes, type 2 diabetes, hypertension, weight, GLP-1 medication support, and wellness. Its Diabetes Prevention Program is a yearlong CDC-recognized program. The app states it is not a medical device, does not give medical advice, and does not replace a clinician.",
      followThrough:
        "A digital coach that chats around the clock with daily check-ins, missions, meal and activity logging, medication reminders, and short lessons. Most programs add live coaching sessions with certified coaches and a member community. Devices earned through engagement, such as a Fitbit, depend on the plan.",
      format:
        "A smartphone and tablet app built around guided chats that take about five minutes a day, a dashboard of weight, activity, sleep, stress, meals, glucose, and blood pressure, resource libraries, and video sessions with human coaches on some programs.",
      hardware:
        "Enrolled members receive a smart scale, and program-specific devices such as a glucometer with testing supplies or a blood pressure monitor, at no extra cost. Readings sync into the app automatically.",
      inputs:
        "Meals described in plain language, activity, sleep, medications and side effects, weight from the Lark scale, glucose and blood pressure from shipped devices, survey answers, and data from Apple Health, Health Connect, Samsung Health, and connected trackers.",
      insightStyle:
        "Condition-specific tips, real-time feedback on meals and grocery lists, prompts to move after sitting, weekly progress, and education delivered in short chunks. Guidance stays inside the enrolled program's scope.",
      platforms:
        "iPhone on iOS 15.6 or later and Apple Vision Pro on the App Store. The privacy policy also covers Google Health Connect and Samsung Health data, which are Android sources. Enrollment runs through an eligibility survey tied to a health plan or employer.",
      pricing:
        "Lark advertises $0 with eligible insurance or an employer benefit. The public pages list no direct consumer price, and eligibility for the Diabetes Prevention Program requires a prediabetes risk survey and membership in a participating health plan.",
      primaryJob:
        "Coach members through a sponsored program for weight, prediabetes, diabetes, blood pressure, or GLP-1 support with shipped devices and daily chat.",
    },
    competitorEvidence: {
      clinicalRole: [1, 2, 4],
      followThrough: [2, 4],
      format: [2, 4],
      hardware: [1, 4],
      inputs: [2, 3, 4],
      insightStyle: [2, 4],
      platforms: [3, 4],
      pricing: [1, 4],
      primaryJob: [1, 2],
    },
    faqs: [
      {
        answer:
          "The public pages do not list a direct consumer price. Lark advertises $0 with eligible insurance or an employer benefit and enrolls people through an eligibility survey. Murph starts free without a card and does not depend on a plan sponsor.",
        question: "Can I buy Lark without insurance?",
      },
      {
        answer:
          "The everyday coach is automated and available around the clock. Most programs also include live sessions with certified human coaches and a member community, and the home page notes that the digital coach does not provide medical advice.",
        question: "Is the Lark coach a person?",
      },
      {
        answer:
          "Lark is a sponsored condition program with shipped devices and a curriculum. Murph is a general health assistant you keep in iMessage or Telegram. It reads your own connected glucose meters, blood pressure cuffs, wearables, labs, and records, answers questions outside any program, runs personal experiments, and handles errands. Murph ships no devices and runs no CDC recognized program.",
        question: "How is Murph different from Lark?",
      },
    ],
    headline:
      "Lark runs a sponsored condition program with shipped devices. Murph is the assistant you keep.",
    lastVerified: "2026-09-04",
    metaDescription:
      "Lark is a digital coaching program for prediabetes, diabetes, blood pressure, and weight, often $0 through insurance. Murph is a personal health assistant across your own wearables and labs.",
    name: "Lark",
    quickComparison: [
      { capability: "Shipped connected devices", competitor: "yes", evidence: "hardware", murph: "no" },
      { capability: "CDC recognized diabetes program", competitor: "yes", evidence: "clinicalRole", murph: "no" },
      { capability: "Covered by insurance plans", competitor: "yes", evidence: "pricing", murph: "no" },
      { capability: "Live human coaching", competitor: "yes", evidence: "followThrough", murph: "no" },
      { capability: "Reminders and check ins", competitor: "yes", evidence: "followThrough", murph: "yes" },
      { capability: "Optional group support", competitor: "yes", evidence: "followThrough", murph: "yes" },
      { capability: "Works in iMessage or Telegram", competitor: "no", evidence: "format", murph: "yes" },
      { capability: "Wearable and lab context", competitor: "limited", evidence: "inputs", murph: "yes" },
      { capability: "Handles health errands", competitor: "no", evidence: "followThrough", murph: "yes" },
      { capability: "Tests what works for you", competitor: "no", evidence: "insightStyle", murph: "yes" },
    ],
    relationship: "different-role",
    slug: "lark",
    sources: [
      { label: "Lark product overview", url: "https://www.lark.com/" },
      { label: "How Lark's digital coach works", url: "https://www.lark.com/resources/how-larks-digital-coach-works" },
      { label: "Lark privacy policy", url: "https://www.lark.com/privacy-policy/" },
      { label: "Lark App Store listing", url: "https://apps.apple.com/us/app/lark-health/id912530754" },
    ],
    tradeoffs: [
      "Lark's shipped scale, glucometer, or blood pressure cuff and its CDC recognized program are things Murph does not offer. Murph reads your own connected meters and cuffs but ships nothing and runs no curriculum.",
      "Access depends on eligibility. Without a participating plan or employer there is no published way to buy Lark, and device perks can require engagement minimums.",
      "Lark's coaching stays within the enrolled program's scope and is not medical advice. Questions outside the program, and the errands around care, are where Murph fits.",
    ],
  },
  {
    aliases: ["Flo Period and Cycle Tracker", "Flo Health"],
    category: "health-data",
    chooseCompetitor:
      "Choose Flo if you want period and ovulation predictions, symptom patterns, pregnancy tracking, a Symptom Checker, Secret Chats, Anonymous Mode, and a Premium Health Assistant focused on your cycle.",
    chooseMurph:
      "Choose Murph if you want one assistant in iMessage or Telegram that reads cycle symptoms beside sleep, labs, wearables, meals, and records, answers questions on any health topic, and follows through on plans and errands.",
    competitor: {
      clinicalRole:
        "Flo is an educational cycle and pregnancy tracker from Flo Health UK Limited. Its listing says it does not provide medical advice, diagnosis, or treatment, is not a method of birth control, and that predictions are informational. Content is created with more than 100 doctors and health experts.",
      followThrough:
        "Daily insight stories, symptom and cycle predictions, personalized reports that can be bundled into a summary for a doctor, a Guided Journey on Premium, the Secret Chats community, and a partner mode that shares cycle or pregnancy updates. No human coaching or help with appointments is documented.",
      format:
        "An iPhone and Android app with a calendar, cycle history, symptom logging, a pregnancy mode with week-by-week updates, Secret Chats, and, on Premium, a 24/7 chatbot called the Health Assistant, a Symptom Checker, and expert video courses. Apple Watch is supported.",
      hardware:
        "No device is sold or required. A phone is enough, with an Apple Watch companion available.",
      inputs:
        "Period dates, symptoms, mood, discharge, sex, tests, pregnancy milestones, and lifestyle logs. With permission, Apple HealthKit and Google Health Connect can import activity, weight, heart rate, steps, and sleep. Lab uploads and medical records are not part of the product.",
      insightStyle:
        "Predictions of period and ovulation timing, symptom patterns and cycle trends, a Symptom Checker that scores how closely logs match patterns for conditions such as PCOS and endometriosis, educational articles, and a Health Assistant chatbot with tips based on recent logs.",
      platforms:
        "iPhone on iOS 16 or later, Apple Watch on watchOS 9 or later, Apple Vision Pro, and Android through Google Play. Anonymous Mode lets you use the app without linking a name, email, or technical identifiers.",
      pricing:
        "The free tier includes period and ovulation predictions, symptom tracking, calendar, cycle history, Secret Chats, and Anonymous Mode. Premium comes as monthly or yearly plans with frequent promotions. App Store purchases ranged from $1.99 to $59.99 when reviewed, and Flo is FSA and HSA eligible in the US.",
      primaryJob:
        "Track and predict the menstrual cycle, support conception and pregnancy, and explain what cycle symptoms may mean.",
    },
    competitorEvidence: {
      clinicalRole: [3, 4],
      followThrough: [1, 4],
      format: [1, 4],
      hardware: [4],
      inputs: [1, 3],
      insightStyle: [1, 4],
      platforms: [3, 4],
      pricing: [1, 2, 4],
      primaryJob: [1, 4],
    },
    faqs: [
      {
        answer:
          "Flo sells monthly and yearly plans in the app and on its website and often runs promotions. App Store purchases ranged from $1.99 to $59.99 when reviewed, so the exact price depends on the plan and offer you see. Flo Premium is FSA and HSA eligible in the US.",
        question: "What does Flo Premium cost?",
      },
      {
        answer:
          "No. It is a chatbot inside Premium that offers educational tips based on your recent logs and flags patterns. Flo says it does not provide medical advice, diagnosis, or treatment.",
        question: "Is Flo's Health Assistant a doctor?",
      },
      {
        answer:
          "No. Murph does not predict periods or ovulation and has no pregnancy mode or Symptom Checker. It can log cycle symptoms as part of a wider record, connect them to sleep, labs, wearables, and meals, and follow up. Keep Flo for the predictions.",
        question: "Does Murph track cycles like Flo?",
      },
    ],
    headline:
      "Flo predicts your cycle. Murph reads the cycle beside everything else.",
    lastVerified: "2026-09-04",
    metaDescription:
      "Flo tracks periods, ovulation, and pregnancy with a Premium Health Assistant and Anonymous Mode. Murph is a personal health assistant that reads cycle symptoms beside sleep and labs.",
    name: "Flo",
    quickComparison: [
      { capability: "Cycle and ovulation predictions", competitor: "yes", evidence: "primaryJob", murph: "no" },
      { capability: "Pregnancy tracking mode", competitor: "yes", evidence: "format", murph: "no" },
      { capability: "Anonymous Mode", competitor: "yes", evidence: "platforms", murph: "no" },
      { capability: "Condition symptom matching", competitor: "yes", evidence: "insightStyle", murph: "limited" },
      { capability: "Optional group support", competitor: "yes", evidence: "followThrough", murph: "yes" },
      { capability: "Free start without a card", competitor: "yes", evidence: "pricing", murph: "yes" },
      { capability: "Works in iMessage or Telegram", competitor: "no", evidence: "format", murph: "yes" },
      { capability: "Wearable and lab context", competitor: "limited", evidence: "inputs", murph: "yes" },
      { capability: "Handles health errands", competitor: "no", evidence: "followThrough", murph: "yes" },
      { capability: "Tests what works for you", competitor: "no", evidence: "insightStyle", murph: "yes" },
    ],
    relationship: "complement",
    slug: "flo",
    sources: [
      { label: "Flo Premium overview", url: "https://flo.health/flo-premium" },
      { label: "Flo subscription pricing help article", url: "https://help.flo.health/hc/en-us/articles/4411278780564" },
      { label: "Flo privacy policy", url: "https://flo.health/privacy-policy" },
      { label: "Flo App Store listing", url: "https://apps.apple.com/us/app/flo-cycle-period-tracker/id1038369065" },
    ],
    tradeoffs: [
      "Flo's predictions, pregnancy mode, Symptom Checker, and Anonymous Mode are its own. Murph has no cycle prediction engine and does not offer anonymous use.",
      "Several features that used to be free have moved into Premium, and Premium prices depend on the plan and promotion. Check what the free tier includes today.",
      "Flo's Health Assistant is scripted around cycle topics and is educational. Murph answers questions on any health topic and connects cycle logs to sleep, labs, and wearables, but it also does not diagnose.",
    ],
    useTogether:
      "Keep Flo for predictions and pregnancy tracking. Tell Murph the cycle phase or symptom and let it connect that with sleep, wearable, lab, and meal data, then run the experiment or reminder. No connection between the two is documented.",
  },
  {
    aliases: ["NC° Birth Control", "NaturalCycles"],
    category: "wearables",
    chooseCompetitor:
      "Choose Natural Cycles if you want FDA cleared, hormone-free birth control or conception planning based on overnight temperature from the NC Band, Apple Watch, Oura, WHOOP, or Garmin, with a daily red or green fertility status.",
    chooseMurph:
      "Choose Murph if you want an educational assistant that reads your wearables, labs, and records together in iMessage or Telegram, answers open-ended questions, runs experiments, and handles errands, and you are not looking for contraception.",
    competitor: {
      clinicalRole:
        "Natural Cycles is a regulated medical device. It was FDA cleared as a contraceptive app in 2018 and is certified as a class II device in the EU, UK, Canada, Australia, Singapore, Brazil, and South Korea. It is intended for women 18 and older and reports 93 percent effectiveness with typical use and 98 percent with perfect use.",
      followThrough:
        "A daily fertility status each morning, more red days early on while the algorithm learns a cycle, educational messages, mood trackers, LH test timing, and modes that carry a member from birth control through pregnancy, postpartum, and perimenopause. No human coaching is documented.",
      format:
        "An iPhone, iPad, Apple Watch, and Mac app built around a daily red or green fertility status, a temperature graph, cycle history, and five modes: NC Birth Control, Plan Pregnancy, Follow Pregnancy, Postpartum, and Perimenopause.",
      hardware:
        "Temperature is required. The NC Band wrist wearable is included with an annual subscription and syncs directly. Alternatively an Oura Ring with membership, an Apple Watch Series 8 or later, Ultra, or SE3, a WHOOP, or a compatible Garmin can supply overnight temperature.",
      inputs:
        "Overnight temperature from the NC Band or a compatible wearable, period dates, optional LH test results, mood, and symptoms. The algorithm uses temperature and cycle data to calculate fertility status. Labs and medical records are not part of the product.",
      insightStyle:
        "A regulated algorithm turns temperature and period data into a daily fertility status and personal ovulation patterns, with extra red days as a safety buffer. Insights explain cycle trends over time and, in pregnancy and perimenopause modes, what to expect.",
      platforms:
        "iPhone on iOS 16.7 or later, iPad, Apple Watch on watchOS 9 or later, and Apple silicon Macs on the App Store. The pages reviewed did not cover an Android build. Wearable data syncs from the Oura app, Apple Health, WHOOP, or Garmin depending on the device.",
      pricing:
        "A subscription is required for the core features. The App Store listed Monthly at $21.99 and Annual at $149.99 when reviewed, with the NC Band included on the annual plan. US subscriptions are FSA and HSA eligible.",
      primaryJob:
        "Prevent or plan pregnancy without hormones by turning overnight temperature and cycle data into a daily fertility status you can act on.",
    },
    competitorEvidence: {
      clinicalRole: [1, 4],
      followThrough: [1, 2],
      format: [1, 2, 4],
      hardware: [1, 2, 4],
      inputs: [1, 4],
      insightStyle: [1, 2],
      platforms: [2, 4],
      pricing: [1, 4],
      primaryJob: [1, 2],
    },
    faqs: [
      {
        answer:
          "The NC Band syncs directly and comes with the annual plan. Otherwise you can wear an Oura Ring with an active membership, an Apple Watch Series 8 or later, Ultra, or SE3, a WHOOP, or a compatible Garmin overnight. Older Apple Watch SE models lack a temperature sensor and do not work.",
        question: "Which wearables work with Natural Cycles?",
      },
      {
        answer:
          "The App Store listed $21.99 a month or $149.99 a year when reviewed, and the annual plan includes an NC Band. There is no free tier. The company says the subscription funds a regulated device and means it does not sell user data. US subscriptions are FSA and HSA eligible.",
        question: "How much does Natural Cycles cost?",
      },
      {
        answer:
          "No. Murph is educational, is not a medical device, and does not compute fertility status. It can read temperature and cycle data from connected wearables and talk through patterns, but contraception decisions belong with Natural Cycles or a clinician.",
        question: "Can Murph be used for birth control?",
      },
    ],
    headline:
      "Natural Cycles is cleared as birth control. Murph is the assistant around it.",
    lastVerified: "2026-09-04",
    metaDescription:
      "Natural Cycles is the FDA cleared birth control app that reads overnight temperature from the NC Band, Apple Watch, Oura, WHOOP, or Garmin. Murph is a personal health assistant around it.",
    name: "Natural Cycles",
    quickComparison: [
      { capability: "FDA cleared birth control", competitor: "yes", evidence: "clinicalRole", murph: "no" },
      { capability: "Daily fertility status", competitor: "yes", evidence: "insightStyle", murph: "no" },
      { capability: "Included temperature band", competitor: "yes", evidence: "hardware", murph: "no" },
      { capability: "Symptom and mood logging", competitor: "yes", evidence: "inputs", murph: "yes" },
      { capability: "Oura WHOOP and Garmin data", competitor: "yes", evidence: "hardware", murph: "yes" },
      { capability: "Free start without a card", competitor: "no", evidence: "pricing", murph: "yes" },
      { capability: "Works in iMessage or Telegram", competitor: "no", evidence: "format", murph: "yes" },
      { capability: "Handles health errands", competitor: "no", evidence: "followThrough", murph: "yes" },
      { capability: "Tests what works for you", competitor: "no", evidence: "insightStyle", murph: "yes" },
      { capability: "Open source option", competitor: "no", evidence: "platforms", murph: "yes" },
    ],
    relationship: "different-role",
    slug: "natural-cycles",
    sources: [
      { label: "Natural Cycles FAQs", url: "https://www.naturalcycles.com/faqs" },
      { label: "Natural Cycles and Apple Watch", url: "https://www.naturalcycles.com/apple-watch" },
      { label: "Natural Cycles privacy policy", url: "https://www.naturalcycles.com/other/legal/privacy" },
      { label: "Natural Cycles App Store listing", url: "https://apps.apple.com/us/app/natural-cycles-fertility-app/id765535549" },
    ],
    tradeoffs: [
      "Natural Cycles is a regulated contraceptive with published effectiveness numbers. Murph is not a medical device and cannot tell you whether today is a fertile day.",
      "It needs a temperature source and a paid subscription, and irregular cycles or missed measurements mean more red days. Hormonal birth control must be stopped before starting.",
      "Natural Cycles stays inside cycle and fertility. Murph reads the same wearables for sleep, recovery, and training, adds labs, records, and meals, and takes on errands and experiments, but it has no fertility algorithm.",
    ],
  },
  {
    aliases: ["Tee by Talkspace", "Tee"],
    category: "sleep-mental",
    chooseCompetitor:
      "Choose Talkspace Tee if you want a clinician-built mental health guide by voice or text at any hour that remembers past sessions, monitors for risk, and can hand you to a licensed Talkspace therapist.",
    chooseMurph:
      "Choose Murph if stress, sleep, or mood are part of a wider health picture you want read together with wearables, labs, and records in iMessage or Telegram, and you are not looking for therapy.",
    competitor: {
      clinicalRole:
        "Tee is an AI guide designed by Talkspace clinicians, not a licensed professional. Talkspace says it should not replace clinical mental health care and should not be used in a crisis. Conversations are monitored automatically and a human clinician is alerted when risk appears, and Tee can route you to Talkspace therapy or psychiatry.",
      followThrough:
        "Tee remembers earlier conversations, adapts over time, and invites sessions as often as you like. If your conversations suggest you would benefit from a person, you are directed to sign up for Talkspace therapy. Reminders, plans, and practical errands are not documented.",
      format:
        "A private conversation by voice or text, delivered through a Tee web app and the Talkspace app, available around the clock. It is separate from Talkspace therapy, and conversations with Tee are not shared with a Talkspace therapist you may already have.",
      hardware:
        "No device is sold or required. A phone or browser is enough, and no wearable data is used.",
      inputs:
        "What you say or type in sessions, plus the memory of previous conversations. Tee does not document wearable, lab, sleep, or medical record inputs.",
      insightStyle:
        "Guided reflection grounded in therapy skills: naming feelings, working through anxious thoughts, seeing relationships more clearly, and building coping skills. Talkspace says Tee is designed to guide rather than simply agree, and that responses may be inaccurate or incomplete.",
      platforms:
        "Web at tee.talkspace.com plus the Talkspace app for iPhone and Android, which also delivers Talkspace therapy. Talkspace says Tee was built to meet HIPAA protections with encrypted conversations.",
      pricing:
        "Tee is free for seven days, then $19.99 a month, cancel any time, with no insurance needed. Talkspace therapy and psychiatry are billed separately and are covered by many US insurance plans.",
      primaryJob:
        "Give people a private, clinician-designed place to talk through stress, feelings, and dilemmas at any hour, with a path to human therapy when needed.",
    },
    competitorEvidence: {
      clinicalRole: [1, 2, 4],
      followThrough: [1, 3],
      format: [1, 3, 5],
      hardware: [3],
      inputs: [1, 3],
      insightStyle: [1],
      platforms: [1, 3, 5],
      pricing: [1, 5],
      primaryJob: [1, 2],
    },
    faqs: [
      {
        answer:
          "No. Talkspace says Tee is an AI, not a licensed professional, and that it cannot diagnose, treat, or handle a crisis. It was designed by Talkspace clinicians and can connect you to a licensed therapist through Talkspace when that is the better fit.",
        question: "Is Tee a therapist?",
      },
      {
        answer:
          "Tee is free for seven days and then $19.99 a month, cancel any time, with no insurance required. Talkspace therapy is a separate service that many US insurance plans cover.",
        question: "What does Tee cost?",
      },
      {
        answer:
          "Tee is built for mental health conversations and has safety monitoring and a hand-off to human therapy. Murph is a general health assistant that reads wearables, labs, records, meals, and sleep together, runs experiments, sends reminders, and handles errands. Murph is not a mental health service, has no clinician alerting, and is not for crises.",
        question: "How is Murph different from Tee?",
      },
    ],
    headline:
      "Tee is a clinician-designed place to talk. Murph is the assistant for the rest of your health.",
    lastVerified: "2026-09-04",
    metaDescription:
      "Tee by Talkspace is an AI mental health guide with voice, memory, risk monitoring, and a path to human therapy. Murph is a personal health assistant across wearables, labs, and records.",
    name: "Talkspace Tee",
    quickComparison: [
      { capability: "Clinician designed guidance", competitor: "yes", evidence: "clinicalRole", murph: "no" },
      { capability: "Automated risk detection", competitor: "yes", evidence: "clinicalRole", murph: "no" },
      { capability: "Hand off to human therapy", competitor: "yes", evidence: "primaryJob", murph: "no" },
      { capability: "Spoken voice sessions", competitor: "yes", evidence: "format", murph: "no" },
      { capability: "Longitudinal history", competitor: "yes", evidence: "inputs", murph: "yes" },
      { capability: "Available around the clock", competitor: "yes", evidence: "format", murph: "yes" },
      { capability: "Wearable and lab context", competitor: "no", evidence: "inputs", murph: "yes" },
      { capability: "Works in iMessage or Telegram", competitor: "no", evidence: "format", murph: "yes" },
      { capability: "Free start without a card", competitor: "limited", evidence: "pricing", murph: "yes" },
      { capability: "Handles health errands", competitor: "no", evidence: "followThrough", murph: "yes" },
    ],
    relationship: "different-role",
    slug: "talkspace-tee",
    sources: [
      { label: "About Tee by Talkspace", url: "https://www.talkspace.com/about-tee" },
      { label: "AI at Talkspace", url: "https://www.talkspace.com/ai-at-talkspace" },
      { label: "Tee web app", url: "https://tee.talkspace.com/" },
      { label: "Talkspace privacy policy", url: "https://www.talkspace.com/public/privacy-policy" },
      { label: "Talkspace App Store listing", url: "https://apps.apple.com/us/app/talkspace-virtual-therapy-app/id661829386" },
    ],
    tradeoffs: [
      "Tee's safety monitoring, clinician design, and hand-off to Talkspace therapy are things Murph does not have. Murph is not a mental health service and should not be used for crisis support.",
      "Tee is mental health only. It uses no wearable, sleep, or lab data and does not document reminders or practical help. Talkspace also says there is no real-time human monitoring and that responses may be wrong.",
      "Tee costs $19.99 a month after a seven-day trial, with no free tier. Murph starts free without a card and adds paid plans for more usage.",
    ],
  },
]);
