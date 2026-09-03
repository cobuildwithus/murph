import { defineComparisons } from "../types";

export const LABS_LONGEVITY_COMPARISONS = defineComparisons([
  {
    aliases: ["Function"],
    category: "labs-longevity",
    chooseCompetitor:
      "Function Health is the better fit if you want a prepaid yearly lab program. You get 100+ tests up front, 60+ more a few months later, clinician reviewed notes, and optional MRI or CT at extra cost.",
    chooseMurph:
      "Choose Murph if you want help understanding lab results you already have. Murph charts each marker against its reference band, explains it in plain words, and reminds you about the plan you agreed on.",
    competitor: {
      clinicalRole:
        "Function is a health technology company. Independent labs and clinicians do the testing and review. Function says it does not diagnose or treat disease.",
      followThrough:
        "You get a personalized protocol, written explanations of each result, clinician flags, and a midyear test. Extra tests or scans cost more.",
      format:
        "An annual testing membership. There is a first lab visit, a follow-up visit 3 to 6 months later, and a results account that tracks changes over time.",
      hardware:
        "You do not need to own a device. Samples are collected at partner labs or by mobile phlebotomy, and MRI and CT are available separately.",
      inputs:
        "Blood, urine, health history, and uploads of prior results. MRI, CT, and add-on test data are optional.",
      insightStyle:
        "Clinician reviewed explanations of each biomarker, flags on issues, trends over time, and a personalized protocol.",
      platforms:
        "A web member portal with private AI chat. You can also connect it to supported AI assistants.",
      pricing:
        "$365 charged annually on the current public site. The footer calls this a first-year price. Add-ons, scans, and some state-specific lab costs are extra.",
      primaryJob:
        "Give you a broad lab picture twice a year and make the results easy to review over time.",
    },
    competitorEvidence: {
      clinicalRole: [1],
      followThrough: [1],
      format: [1],
      hardware: [1],
      inputs: [3, 4],
      insightStyle: [1],
      platforms: [3],
      pricing: [1, 3],
      primaryJob: [1],
    },
    faqs: [
      {
        answer:
          "No. Murph does not draw blood, run lab assays, or provide MRI or CT scans. Function Health supplies those measurements. Murph can chart the results, explain them, and help you follow the plan.",
        question: "Can Murph replace Function Health testing?",
      },
      {
        answer:
          "Function Health currently lists 160+ lab tests per year. That splits into a 100+ test first visit and a 60+ test follow-up. Add-on tests and imaging are not part of that count.",
        question: "What does Function Health include during a year?",
      },
      {
        answer:
          "No. Function Health says it is not a medical provider, and Murph is not medical care either. Urgent symptoms, diagnoses, and treatment decisions belong with a licensed clinician.",
        question: "Is either Function Health or Murph primary medical care?",
      },
    ],
    headline: "Function Health runs labs twice a year. Murph works with the results in between.",
    lastVerified: "2026-08-31",
    metaDescription:
      "Function Health is an annual lab membership with 160+ tests and optional scans. Murph is a personal health assistant that charts your results and helps you follow the plan.",
    name: "Function Health",
    quickComparison: [
      {
        capability: "Broad laboratory testing",
        evidence: "inputs",
        murph: "no",
        competitor: "yes",
      },
      {
        capability: "Optional medical imaging",
        evidence: "hardware",
        murph: "no",
        competitor: "limited",
      },
      {
        capability: "Twice yearly testing visits",
        evidence: "format",
        murph: "no",
        competitor: "yes",
      },
      {
        capability: "Cross source health context",
        evidence: "inputs",
        murph: "yes",
        competitor: "yes",
      },
      {
        capability: "Daily plan follow through",
        evidence: "followThrough",
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
        capability: "Open source option",
        evidence: "platforms",
        murph: "yes",
        competitor: "no",
      },
    ],
    relationship: "complement",
    slug: "function-health",
    sources: [
      {
        label: "Function Health membership and current price",
        url: "https://www.functionhealth.com/",
      },
      {
        label: "Function Health test inventory",
        url: "https://www.functionhealth.com/what-we-test",
      },
      {
        label: "Function Health FAQ and availability",
        url: "https://www.functionhealth.com/faq",
      },
      {
        label: "Function Health terms of service",
        url: "https://www.functionhealth.com/legal/terms-of-service",
      },
    ],
    tradeoffs: [
      "Function's site calls $365 a first-year price. Check what renewal costs before you buy.",
      "The 160+ tests are spread across two visits. It is not 160 separate assays in one draw.",
      "Function runs the tests but does not replace your treating clinician. Murph runs no tests or scans at all.",
    ],
    useTogether:
      "Use Function Health for the blood draws, clinician flags, and protocol. Then upload the report to Murph. Murph charts the markers, answers your questions in plain terms, and sends reminders for the follow-up draw and the steps you agreed to.",
  },
  {
    aliases: ["Superpower Health"],
    category: "labs-longevity",
    chooseCompetitor:
      "Pick Superpower when the yearly 100+ biomarker draw is the main thing you want. It comes with an AI protocol and a marketplace for extra tests, supplements, and eligible prescriptions.",
    chooseMurph:
      "Choose Murph if you want one ongoing conversation about your health rather than a yearly lab bundle. Murph remembers what you told it, adapts the plan, and checks in between tests.",
    competitor: {
      clinicalRole:
        "Superpower is a technology platform, not a healthcare provider. Independent clinicians and labs provide the medical and testing services. Nonclinical care team members offer wellness support.",
      followThrough:
        "A personalized protocol, AI chat, and care team messaging all year. Wearable trends are shown, and you can buy extra tests, supplements, and eligible prescriptions separately.",
      format:
        "An annual membership. It starts with one draw at a partner lab, or an optional at-home collection.",
      hardware:
        "No device is required. Superpower can pull in supported wearable data and uses partner collection services.",
      inputs:
        "A 100+ biomarker blood test, your health history, and uploaded outside labs. Supported wearables include Apple Health, WHOOP, and Oura.",
      insightStyle:
        "A biological age estimate, health scores, and trends. An AI writes a lifestyle, diet, and supplement protocol.",
      platforms:
        "A web member portal. Its terms mention mobile app distribution, and it connects to supported wearables.",
      pricing:
        "Starts at $199 per year. At-home collection, repeat testing, marketplace products, prescriptions, and specialty tests can cost more.",
      primaryJob:
        "Turn one broad yearly lab baseline into a protocol and a catalog of services you might buy next.",
    },
    competitorEvidence: {
      clinicalRole: [3],
      followThrough: [1, 3],
      format: [1],
      hardware: [1],
      inputs: [1],
      insightStyle: [1],
      platforms: [1, 3],
      pricing: [1, 3],
      primaryJob: [1],
    },
    faqs: [
      {
        answer:
          "No. Murph does not order or run blood tests. You can use both: get the draw from Superpower, then bring the results and any clinician instructions into Murph for charts, plain explanations, and ongoing support.",
        question: "Does Murph replace the Superpower blood test?",
      },
      {
        answer:
          "No. The base membership includes one 100+ biomarker draw a year. At-home collection, extra tests, marketplace products, and prescriptions can cost extra.",
        question: "Are all Superpower tests and treatments included for $199?",
      },
      {
        answer:
          "No. Superpower says its AI and nonclinical care team do not diagnose or treat. Murph is educational support, not medical care. A licensed clinician stays responsible for diagnosis and treatment.",
        question: "Is Superpower's AI the same as medical care?",
      },
    ],
    headline: "Murph keeps a Superpower protocol going between yearly draws.",
    lastVerified: "2026-08-31",
    metaDescription:
      "Superpower bundles a yearly 100+ biomarker blood test, an AI protocol, and a marketplace. Murph is a personal health assistant that charts those results and keeps the plan going.",
    name: "Superpower",
    quickComparison: [
      {
        capability: "Included annual blood test",
        evidence: "format",
        murph: "no",
        competitor: "yes",
      },
      {
        capability: "Treatment marketplace access",
        evidence: "followThrough",
        murph: "no",
        competitor: "yes",
      },
      {
        capability: "Biological age and health scores",
        evidence: "insightStyle",
        murph: "no",
        competitor: "yes",
      },
      {
        capability: "Cross source health context",
        evidence: "inputs",
        murph: "yes",
        competitor: "yes",
      },
      {
        capability: "Daily plan follow through",
        evidence: "followThrough",
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
        capability: "Free start without a card",
        evidence: "pricing",
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
    relationship: "complement",
    slug: "superpower",
    sources: [
      {
        label: "Superpower membership overview",
        url: "https://superpower.com/",
      },
      {
        label: "Superpower testing overview",
        url: "https://superpower.com/landing/welcome-v2",
      },
      {
        label: "Superpower legal terms",
        url: "https://superpower.com/legal/terms",
      },
    ],
    tradeoffs: [
      "The base plan is built around one draw a year. Repeat testing through the year is not included.",
      "Marketplace access does not mean every add-on, medication, or specialty test is included.",
      "The protocol and biological age are estimates and interpretations, not diagnoses.",
      "Murph does none of Superpower's testing and offers no proprietary scores, prescriptions, or marketplace products.",
    ],
    useTogether:
      "Use Superpower for the annual panel and its protocol. Then bring the results into Murph. Murph charts the markers, explains them plainly, and keeps your tasks, questions, and retest timing in one thread.",
  },
  {
    aliases: ["Inside Tracker"],
    category: "labs-longevity",
    chooseCompetitor:
      "InsideTracker is the better fit if you want performance analytics from your blood work. It gives you optimized ranges, healthspan scores, an action plan, and imports from Apple Health, Oura, Fitbit, and Garmin.",
    chooseMurph:
      "Choose Murph if you want more than a performance dashboard. Murph reads your labs alongside sleep, meals, training, and records, explains them plainly, and keeps you on the plan you pick.",
    competitor: {
      clinicalRole:
        "A wellness analytics service. InsideTracker says its results and recommendations are not medical advice, diagnosis, or treatment.",
      followThrough:
        "Personalized recommendations, an action plan, trend tracking, and suggested retesting. Its Nutrition DeepDive uses algorithmic recommendations. InsideTracker says the tool complements a doctor's visit rather than replacing it.",
      format:
        "A yearly analytics membership. You can pair it with an InsideTracker blood test or with supported outside results.",
      hardware:
        "There is no proprietary device. It imports data from supported watches, rings, and fitness services.",
      inputs:
        "Up to 54 blood biomarkers in Ultimate, plus supported outside lab uploads, fitness and sleep trackers, and optional eligible DNA uploads.",
      insightStyle:
        "Healthspan category scores, optimized ranges, and recommendations. InnerAge and DNA insights are optional.",
      platforms:
        "Web, iOS, and Android. It supports Apple Health, Oura, Fitbit, and Garmin.",
      pricing:
        "New US and Canadian customers pay $489 for Membership plus Ultimate, and current members can buy Ultimate for $340. The standalone $149 membership is listed for international customers. InnerAge and DNA can cost extra.",
      primaryJob:
        "Turn performance-related labs and tracker data into structured recommendations and trends.",
    },
    competitorEvidence: {
      clinicalRole: [5],
      followThrough: [2, 6],
      format: [2],
      hardware: [2],
      inputs: [1, 2],
      insightStyle: [2],
      platforms: [3],
      pricing: [1, 2],
      primaryJob: [2],
    },
    faqs: [
      {
        answer:
          "No. Murph does not offer InsideTracker's blood test or its proprietary scores. Murph can chart the results, explain them, connect them to your other data, and help you carry out the plan.",
        question: "Can Murph replace InsideTracker Ultimate?",
      },
      {
        answer:
          "No. The $149 membership covers the analytics platform and supported uploads. Blood testing ordered through InsideTracker is bought separately or as part of a bundle.",
        question: "Does an InsideTracker membership include a blood test?",
      },
      {
        answer:
          "No. InsideTracker gives biomarker and model-based insights for wellness and performance. Its terms say these do not diagnose or treat disease. InnerAge is an estimate, not a directly measured age.",
        question: "Are InsideTracker recommendations medical advice?",
      },
    ],
    headline: "Keep InsideTracker for its scores. Add Murph for the plan and the reminders.",
    lastVerified: "2026-08-31",
    metaDescription:
      "InsideTracker turns blood, DNA, and wearable data into scores and ranges. Murph is a personal health assistant that explains your labs in plain terms and helps you act on them.",
    name: "InsideTracker",
    quickComparison: [
      {
        capability: "Blood biomarker testing",
        evidence: "format",
        murph: "no",
        competitor: "limited",
      },
      {
        capability: "Proprietary performance scores",
        evidence: "insightStyle",
        murph: "no",
        competitor: "yes",
      },
      {
        capability: "Optional DNA insights",
        evidence: "inputs",
        murph: "no",
        competitor: "limited",
      },
      {
        capability: "Context beyond performance",
        evidence: "primaryJob",
        murph: "yes",
        competitor: "limited",
      },
      {
        capability: "Structured action planning",
        evidence: "followThrough",
        murph: "yes",
        competitor: "yes",
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
        capability: "Open source option",
        evidence: "platforms",
        murph: "yes",
        competitor: "no",
      },
    ],
    relationship: "complement",
    slug: "insidetracker",
    sources: [
      {
        label: "InsideTracker store and pricing",
        url: "https://store.insidetracker.com/",
      },
      {
        label: "InsideTracker membership details",
        url: "https://store.insidetracker.com/products/insidetracker-membership",
      },
      {
        label: "InsideTracker Ultimate",
        url: "https://store.insidetracker.com/products/ultimate",
      },
      {
        label: "InsideTracker testing availability",
        url: "https://support.insidetracker.com/en-US/where-and-what-products-can-i-test-with-insidetracker-288949",
      },
      {
        label: "InsideTracker terms of service",
        url: "https://store.insidetracker.com/policies/terms-of-service",
      },
      {
        label: "InsideTracker recommendation methodology",
        url: "https://support.insidetracker.com/en-US/are-insights-coming-from-an-individual-provider-on-a-case-by-case-basis-or-are-they-more-algorithmic-398631",
      },
    ],
    tradeoffs: [
      "The cheapest membership does not include an InsideTracker blood draw.",
      "InnerAge and DNA analysis depend on which package you buy. Do not assume they are included.",
      "Outside lab uploads only produce analytics for supported markers. Other values in your report are not scored.",
      "Murph does not calculate InsideTracker's optimized ranges, proprietary scores, or recommendations.",
    ],
    useTogether:
      "Use InsideTracker for its scores, optimized ranges, and retest suggestions. Then bring the report into Murph. Murph charts the markers with reference bands, answers questions in plain terms, and turns the recommendations into habits and reminders.",
  },
  {
    aliases: ["SiPhox", "SiPhox Core"],
    category: "labs-longevity",
    chooseCompetitor:
      "SiPhox is the better fit if you want to test from home on a schedule. You pick the panel, collect with the EasyDraw device, mail it in, and see how each marker moves cycle to cycle.",
    chooseMurph:
      "Choose Murph if you want a running conversation about your health rather than another test cycle. Murph charts results from any lab, explains them plainly, and keeps reminders and habits in one place.",
    competitor: {
      clinicalRole:
        "Mainly a wellness testing platform. Some clinical programs use independent telehealth clinicians, but SiPhox itself says it is not a medical provider.",
      followThrough:
        "A personalized action plan, a dashboard that tracks results over time, a retest schedule, and wearable data alongside your labs. Coaching and clinical programs are optional extras.",
      format:
        "A recurring at-home test cycle, offered monthly, quarterly, or every six months. One-time specialty panels are also available.",
      hardware:
        "You collect blood with an EasyDraw upper-arm device and mail the sample in. No wearable is required.",
      inputs:
        "At-home blood samples, health information, supported outside labs, supplements you take, and compatible wearable or CGM data.",
      insightStyle:
        "Biomarker trends by panel and a personalized action plan. How deep it goes depends on the base panel and the upgrades you select.",
      platforms:
        "A digital dashboard. Integrations include Oura, Apple Watch, Fitbit, Eight Sleep, Dexcom, FreeStyle CGMs, and Google Fit.",
      pricing:
        "The introductory base-panel cycle is $124 at checkout ($99 plus $25 shipping), then $149 per renewal ($124 plus $25 shipping). Ultimate 360 is $249 for new customers and $274 on renewal. Panel add-ons and coaching cost more.",
      primaryJob:
        "Make repeat lab testing possible from home and show how results change from one cycle to the next.",
    },
    competitorEvidence: {
      clinicalRole: [4],
      followThrough: [1, 4],
      format: [1],
      hardware: [1, 6],
      inputs: [1, 4],
      insightStyle: [1],
      platforms: [5],
      pricing: [2, 6, 7],
      primaryJob: [1],
    },
    faqs: [
      {
        answer:
          "No. Murph is not a lab. It cannot replace the EasyDraw collection, the assay processing, or the SiPhox report. Once results arrive, Murph can chart them, explain them, and help you plan what to do about them.",
        question: "Can Murph do the SiPhox at-home blood test?",
      },
      {
        answer:
          "No. The base panel starts with a smaller set of markers. More markers and programs require upgrades. SiPhox pages also differ in how they count calculated versus measured outputs.",
        question: "Are all SiPhox biomarkers included in the base price?",
      },
      {
        answer:
          "Most SiPhox services are wellness testing, not medical care. Some named programs offer care through independent clinicians. Availability depends on your state and program eligibility.",
        question: "Does SiPhox Health provide medical care?",
      },
    ],
    headline: "SiPhox mails you a blood kit on a schedule. Murph keeps the plan on track.",
    lastVerified: "2026-08-31",
    metaDescription:
      "SiPhox Health mails at-home blood kits on a monthly, quarterly, or six-month cycle. Murph is a personal health assistant that explains the results and keeps the plan going.",
    name: "SiPhox Health",
    quickComparison: [
      {
        capability: "At home blood collection",
        evidence: "hardware",
        murph: "no",
        competitor: "yes",
      },
      {
        capability: "Configurable laboratory panels",
        evidence: "insightStyle",
        murph: "no",
        competitor: "yes",
      },
      {
        capability: "Recurring testing options",
        evidence: "format",
        murph: "no",
        competitor: "yes",
      },
      {
        capability: "Cross source health context",
        evidence: "inputs",
        murph: "yes",
        competitor: "yes",
      },
      {
        capability: "Reminders and check ins",
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
        competitor: "limited",
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
    slug: "siphox-health",
    sources: [
      {
        label: "SiPhox Health program overview",
        url: "https://siphoxhealth.com/",
      },
      {
        label: "SiPhox cycle pricing",
        url: "https://answers.siphoxhealth.com/about/what-is-siphox",
      },
      {
        label: "SiPhox state coverage",
        url: "https://siphoxhealth.com/policies/state-coverage",
      },
      {
        label: "SiPhox terms of service",
        url: "https://siphoxhealth.com/policies/terms-of-service",
      },
      {
        label: "SiPhox compatible wearables",
        url: "https://siphoxhealth.zendesk.com/hc/en-us/articles/48519620635668-What-wearables-are-compatible-with-SiPhox-Health",
      },
      {
        label: "SiPhox Health and InsideTracker comparison",
        url: "https://siphoxhealth.com/comparison/siphox-vs-insidetracker",
      },
      {
        label: "SiPhox shop",
        url: "https://siphoxhealth.com/shop",
      },
    ],
    tradeoffs: [
      "Base and upgraded panels cover different markers. The highest advertised count is not what the base program includes.",
      "New York and Hawaii are excluded from current services. Telehealth has further state limits.",
      "Shipping, upgrades, specialty panels, coaching, and clinical programs can push the total well past the headline cycle price.",
      "Murph does not collect samples, run the lab analysis, or produce SiPhox's biomarker results.",
    ],
    useTogether:
      "Use SiPhox for the repeat draws and its dashboard. Then bring each result into Murph. Murph charts the markers with reference bands, explains what changed, sets reminders for the actions you chose, and helps you write down questions for a clinician.",
  },
  {
    aliases: ["Lifeforce Health"],
    category: "labs-longevity",
    chooseCompetitor:
      "Pick Lifeforce when you want repeat labs plus scheduled clinician visits, coaching, and the option of prescriptions where eligible. That bundle is the product.",
    chooseMurph:
      "Choose Murph if you already have a doctor or your own data and want a private assistant on top. Murph helps you get ready for visits, remembers the instructions, and checks in on the plan.",
    competitor: {
      clinicalRole:
        "Licensed care comes from independent professional practices. The program can evaluate you for prescriptions, but it is not emergency care or full primary care.",
      followThrough:
        "Clinician consultations, a personalized program, and repeat labs. The monthly tier adds coaching, and eligible prescriptions and supplements are available.",
      format:
        "A clinical longevity membership. It comes as a high-touch monthly program or a lower-touch annual Core plan.",
      hardware:
        "No proprietary device is required. Blood can be collected at home or at a partner lab.",
      inputs:
        "Health history, goals, 50+ lab markers, repeat testing, and what comes up during clinician and coach visits.",
      insightStyle:
        "A LifeScore-style dashboard, a biological age estimate, clinician interpretation, and a personalized clinical and lifestyle program.",
      platforms:
        "A digital member dashboard, with telehealth consultations and coaching messages.",
      pricing:
        "Monthly Membership starts with a $199 payment, then $149 per month. Core Annual is $599. Medications, supplements, and specialty services are extra.",
      primaryJob:
        "Combine repeat biomarker testing with clinician access, coaching, and possible longevity treatment.",
    },
    competitorEvidence: {
      clinicalRole: [1, 4],
      followThrough: [1],
      format: [1],
      hardware: [1],
      inputs: [2],
      insightStyle: [2],
      platforms: [2],
      pricing: [1],
      primaryJob: [1],
    },
    faqs: [
      {
        answer:
          "No. Murph cannot order Lifeforce tests, prescribe medication, or stand in for its licensed clinicians. Murph can help you prepare for visits and follow a plan your clinician approved.",
        question: "Can Murph replace a Lifeforce clinician?",
      },
      {
        answer:
          "No. The monthly and Core Annual tiers differ in testing cadence, consultation access, and coaching. Prescriptions, medications, supplements, and specialty services can cost extra.",
        question: "Is everything in Lifeforce included in one membership price?",
      },
      {
        answer:
          "Yes, within limits. Eligible licensed clinicians can diagnose and treat within their scope and state rules. Lifeforce's technology entity is separate from those practices, and the service is not emergency care.",
        question: "Does Lifeforce provide medical treatment?",
      },
    ],
    headline: "Lifeforce pairs labs with a clinician. Murph remembers what they told you.",
    lastVerified: "2026-08-31",
    metaDescription:
      "Lifeforce pairs repeat labs with clinician visits and coaching. Murph is a personal health assistant that helps you prepare for visits and follow the plan afterward.",
    name: "Lifeforce",
    quickComparison: [
      {
        capability: "Recurring laboratory testing",
        evidence: "followThrough",
        murph: "no",
        competitor: "yes",
      },
      {
        capability: "Licensed clinician access",
        evidence: "clinicalRole",
        murph: "no",
        competitor: "yes",
      },
      {
        capability: "Health coaching access",
        evidence: "followThrough",
        murph: "no",
        competitor: "limited",
      },
      {
        capability: "Biological age and health score",
        evidence: "insightStyle",
        murph: "no",
        competitor: "yes",
      },
      {
        capability: "Context between appointments",
        evidence: "followThrough",
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
    relationship: "different-role",
    slug: "lifeforce",
    sources: [
      {
        label: "Lifeforce current plans",
        url: "https://www.mylifeforce.com/landers/start-now",
      },
      {
        label: "Lifeforce process",
        url: "https://www.mylifeforce.com/pages/how-it-works",
      },
      {
        label: "Lifeforce medical patient agreement",
        url: "https://www.mylifeforce.com/medical-patient-agreement",
      },
      {
        label: "Lifeforce terms and conditions",
        url: "https://www.mylifeforce.com/terms-and-conditions",
      },
    ],
    tradeoffs: [
      "The monthly program costs much more than a lab-only membership.",
      "Medical care, prescriptions, and treatment options depend on state rules and clinical eligibility.",
      "Medications, supplements, and specialty services are not in the advertised membership prices.",
      "Licensed consultations, treatment eligibility, and prescribing stay with Lifeforce. Murph cannot provide any of them.",
    ],
    useTogether:
      "Use Lifeforce for the labs and the licensed care. Use Murph to write down questions before each visit, remember what the clinician said, schedule the practical tasks, and notice when the plan is slipping.",
  },
  {
    aliases: ["Mito", "Mito Core"],
    category: "labs-longevity",
    chooseCompetitor:
      "Mito is the better fit if you want to pick individual tests or panels, see the price before you order, and get a clinician reviewed action plan with each result.",
    chooseMurph:
      "Choose Murph if you want ongoing help that is not tied to buying another test. Murph charts whatever labs you already have, explains them plainly, and follows up on the plan day to day.",
    competitor: {
      clinicalRole:
        "Mito is a technology platform, not a medical provider. Independent partner clinics order the tests and review the results. Mito describes its guidance as wellness information.",
      followThrough:
        "Trend tracking, retest reminders, an action plan, and AI concierge chat. You can escalate to a clinician in chat, and paid consultations are optional.",
      format:
        "A month-to-month membership on top of an at-cost test marketplace. Nonmembers can order too.",
      hardware:
        "No proprietary device. Samples are collected at partner labs or with selected at-home kits.",
      inputs:
        "The blood, urine, stool, genetic, or specialty tests you select, a health questionnaire, and uploaded prior lab records.",
      insightStyle:
        "Clinician reviewed explanations, a personalized wellness plan, biological age tracking, trends, and an AI health concierge.",
      platforms:
        "A web dashboard and concierge chat. The public pages do not clearly commit to a native mobile app.",
      pricing:
        "$9 per month for membership, with tests bought separately. Mito Core starts at $197.62 for members through one provider, but state and lab pricing can be much higher.",
      primaryJob:
        "Offer flexible direct testing at listed prices and keep the records and guidance together in one place.",
    },
    competitorEvidence: {
      clinicalRole: [4],
      followThrough: [1, 3],
      format: [1],
      hardware: [3],
      inputs: [1],
      insightStyle: [1],
      platforms: [3, 4],
      pricing: [1, 2],
      primaryJob: [3],
    },
    faqs: [
      {
        answer:
          "No. Murph cannot order, collect, or process Mito tests. Murph can chart a result you already have, explain it, and help you work the plan your clinician or Mito review produced.",
        question: "Can Murph replace Mito Health laboratory testing?",
      },
      {
        answer:
          "No. The $9 monthly fee gets you member pricing, tracking, guidance, and the concierge features. Tests, draw fees, specialty kits, scans, and one-to-one consultations are bought separately.",
        question: "Are Mito Health tests included in the $9 membership?",
      },
      {
        answer:
          "Mito's pages currently give several different counts for its panels. Some mix measured markers, sex-specific values, urine outputs, and calculated results. The exact product page and checkout are the safer references.",
        question: "Why do Mito Health biomarker counts vary by page?",
      },
    ],
    headline: "Mito lets you pick and price each test. Murph turns the plan into daily habits.",
    lastVerified: "2026-08-31",
    metaDescription:
      "Mito Health sells lab tests one at a time, with clinician reviewed action plans. Murph is a personal health assistant that charts the results and keeps you on the plan.",
    name: "Mito Health",
    quickComparison: [
      {
        capability: "Direct laboratory ordering",
        evidence: "primaryJob",
        murph: "no",
        competitor: "yes",
      },
      {
        capability: "Clinician reviewed action plans",
        evidence: "insightStyle",
        murph: "no",
        competitor: "yes",
      },
      {
        capability: "Biological age tracking",
        evidence: "insightStyle",
        murph: "no",
        competitor: "yes",
      },
      {
        capability: "Cross source health context",
        evidence: "inputs",
        murph: "yes",
        competitor: "yes",
      },
      {
        capability: "Support beyond test purchases",
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
        competitor: "limited",
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
        capability: "Open source option",
        evidence: "platforms",
        murph: "yes",
        competitor: "no",
      },
    ],
    relationship: "complement",
    slug: "mito-health",
    sources: [
      {
        label: "Mito Health marketplace and membership",
        url: "https://mitohealth.com/",
      },
      {
        label: "Mito Core panel and regional pricing",
        url: "https://mitohealth.com/products/mito-core",
      },
      {
        label: "How Mito Health works",
        url: "https://mitohealth.com/how-it-works",
      },
      {
        label: "Mito Health terms of service",
        url: "https://mitohealth.com/terms-of-service",
      },
    ],
    tradeoffs: [
      "The membership does not include a test. Your real total depends on what you order and where you get it collected.",
      "The current site shows inconsistent panel counts, and provider prices differ a lot by state.",
      "Mito's clinician review and wellness recommendations do not make Mito your treating clinician.",
      "Murph cannot order Mito's tests or stand in for the independent clinical review.",
    ],
    useTogether:
      "Use Mito to order the test and get its reviewed action plan. Then bring the result into Murph. Murph charts each marker against its reference band, explains it in plain terms, and turns the plan into reminders and check-ins.",
  },
  {
    aliases: ["Parsley", "Parsley Clinical Lab Review"],
    category: "labs-longevity",
    chooseCompetitor:
      "Parsley is the better fit if you want a licensed clinician to read your labs alongside your symptoms and say what medical follow-up makes sense. The visit is 30 minutes and comes with an action plan.",
    chooseMurph:
      "Choose Murph if you want a private assistant that sticks around after the visit. Murph keeps your records in one place, helps you prepare questions, and turns the clinician's plan into reminders and habits.",
    competitor: {
      clinicalRole:
        "Board-certified clinicians deliver the care through independent physician-owned medical groups. Parsley's management platform supports those groups.",
      followThrough:
        "A personalized action plan and 14 days of care team messaging. You can continue into the separate Complete Care program.",
      format:
        "A 30-minute virtual Clinical Lab Review. It uses Parsley's 80+ biomarker panel or qualifying outside labs from the prior six months. It is sold as an annual membership that auto-renews unless canceled.",
      hardware:
        "No proprietary device. The panel uses Quest collection, or optional at-home phlebotomy where available.",
      inputs:
        "Blood results, symptoms, medical history, lifestyle information, and outside records, all reviewed during a clinical visit.",
      insightStyle:
        "A clinician's interpretation plus a Functional Health Score, a Functional Age estimate, an Aging Velocity estimate, and personalized recommendations.",
      platforms:
        "A HIPAA-compliant patient portal, virtual visits, and secure care team messaging.",
      pricing:
        "$550 per year for the Advanced Lab Panel plus visit, or $250 per year if you bring recent outside labs. The Clinical Lab Review membership auto-renews unless canceled. Complete Care is separate and has its own insurance and self-pay rules.",
      primaryJob:
        "Explain broad blood results with your symptoms and history in mind, and set out the right medical and lifestyle steps to take.",
    },
    competitorEvidence: {
      clinicalRole: [1, 4],
      followThrough: [1],
      format: [5],
      hardware: [1],
      inputs: [1],
      insightStyle: [1, 2],
      platforms: [3],
      pricing: [3, 5],
      primaryJob: [1],
    },
    faqs: [
      {
        answer:
          "No. Parsley's visit is with a licensed clinician. Murph does not diagnose or treat. Murph can help you prepare questions and follow the plan, but it should not stand in for the visit.",
        question: "Can Murph replace a Parsley Clinical Lab Review?",
      },
      {
        answer:
          "No. Clinical Lab Review is self-pay: $550 per year with Parsley's panel, or $250 per year with recent eligible outside labs. The membership auto-renews unless canceled. Complete Care is a separate program with membership fees, medical billing, copays, and deductibles.",
        question: "Is Parsley Clinical Lab Review covered by the Complete Care price?",
      },
      {
        answer:
          "No. They are model outputs, informed by clinicians and derived from your lab data and trends. They are useful summaries, not directly measured ages or diagnoses.",
        question: "Are Parsley's Functional Age and Aging Velocity direct measurements?",
      },
    ],
    headline: "A Parsley clinician reads your labs. Murph helps you stick to the plan.",
    lastVerified: "2026-08-31",
    metaDescription:
      "Parsley's Clinical Lab Review pairs an 80+ biomarker panel with a clinician visit. Murph is a personal health assistant that helps you prepare for the visit and follow the plan.",
    name: "Parsley Health",
    quickComparison: [
      {
        capability: "Broad laboratory testing",
        evidence: "format",
        murph: "no",
        competitor: "limited",
      },
      {
        capability: "Licensed clinician interpretation",
        evidence: "clinicalRole",
        murph: "no",
        competitor: "yes",
      },
      {
        capability: "Functional age and health score",
        evidence: "insightStyle",
        murph: "no",
        competitor: "yes",
      },
      {
        capability: "Symptom and history context",
        evidence: "inputs",
        murph: "yes",
        competitor: "yes",
      },
      {
        capability: "Long term plan follow through",
        evidence: "followThrough",
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
    relationship: "different-role",
    slug: "parsley-health",
    sources: [
      {
        label: "Parsley Clinical Lab Review",
        url: "https://www.parsleyhealth.com/labs",
      },
      {
        label: "Parsley lab panel and health scores",
        url: "https://www.parsleyhealth.com/labs/what-we-test",
      },
      {
        label: "Parsley Complete Care pricing and insurance",
        url: "https://www.parsleyhealth.com/insurance",
      },
      {
        label: "Parsley terms of use",
        url: "https://www.parsleyhealth.com/terms-of-use",
      },
      {
        label: "Parsley Clinical Lab Review workflow and renewal",
        url: "https://www.parsleyhealth.com/labs/how-it-works",
      },
    ],
    tradeoffs: [
      "Clinical Lab Review is self-pay and auto-renews each year unless you cancel. It includes 14 days of follow-up messaging, not open-ended care.",
      "New York and New Jersey use split payment and do not offer the at-home draw for this panel.",
      "Functional Age and Aging Velocity are model-based summaries, not direct physical measurements.",
      "Murph can help you follow the plan, but it cannot extend the licensed visit or replace Parsley's interpretation.",
    ],
    useTogether:
      "Use Parsley for the labs and the clinician's read on them. Then bring the plan into Murph. Murph remembers what you agreed to, notices when it is slipping, and helps you write good questions for the next visit.",
  },
  {
    aliases: ["Wild Health Precision Medicine"],
    category: "labs-longevity",
    chooseCompetitor:
      "Wild Health is the better fit if you want licensed physicians, genetic testing, quarterly bloodwork, and regular coaching in one program. Standard starts at $362 per month.",
    chooseMurph:
      "Choose Murph if you want a light-touch assistant around the care and data you already have, not a full clinical membership. Murph reads your labs and wearables, explains them plainly, and checks in on the plan.",
    competitor: {
      clinicalRole:
        "A telehealth functional medicine service with licensed physicians and coaches. Its terms say genomic testing is not the same as genetic counseling.",
      followThrough:
        "Standard includes quarterly physician visits and bloodwork, plus ongoing coaching and messaging. Premium tiers add more testing and access.",
      format:
        "A clinical membership with Standard, Peak, and Elite service levels. The standard program has a minimum commitment.",
      hardware:
        "Standard requires no proprietary device. Higher tiers can include a device and advanced diagnostics.",
      inputs:
        "Genetic data, health history, 65+ markers on the standard panel, repeat bloodwork, and your goals. Standard includes two biological age tests, and higher tiers add specialty testing.",
      insightStyle:
        "A detailed genetics and lab report that a physician interprets, with personalized nutrition, lifestyle, supplement, and treatment planning.",
      platforms:
        "The Wild Health Clarity web and mobile experience, with messaging and virtual visits.",
      pricing:
        "Standard starts at $362 per month. Peak is $25,000 per year, and Elite requires an inquiry. Testing and access vary by tier.",
      primaryJob:
        "Provide high-touch precision medicine and coaching, informed by genetics and recurring clinical data.",
    },
    competitorEvidence: {
      clinicalRole: [1, 4],
      followThrough: [1, 2],
      format: [1, 2, 4],
      hardware: [1, 2],
      inputs: [1, 2, 3, 5],
      insightStyle: [1],
      platforms: [4],
      pricing: [1, 2],
      primaryJob: [1],
    },
    faqs: [
      {
        answer:
          "No. Murph cannot practice medicine, order Wild Health's clinical tests, or prescribe. Murph can work alongside that care by helping you prepare questions and follow a plan your physician approved.",
        question: "Can Murph replace Wild Health precision medicine?",
      },
      {
        answer:
          "No. Standard, Peak, and Elite differ in lab testing, physician access, coaching, devices, and specialty diagnostics. Do not assume the top-tier features come with Standard.",
        question: "Does every Wild Health tier include the same tests?",
      },
      {
        answer:
          "No. Wild Health's terms draw a line between genomic testing and genetic counseling. For counseling about inherited findings, see a qualified genetics professional.",
        question: "Is Wild Health genetic testing the same as genetic counseling?",
      },
    ],
    headline: "Wild Health is a precision medicine clinic. Murph is the assistant you text.",
    lastVerified: "2026-08-31",
    metaDescription:
      "Wild Health pairs genetics and quarterly labs with physicians and coaches. Murph is a personal health assistant that helps you keep up with the plan between visits.",
    name: "Wild Health",
    quickComparison: [
      {
        capability: "Recurring laboratory testing",
        evidence: "followThrough",
        murph: "no",
        competitor: "yes",
      },
      {
        capability: "Licensed physician care",
        evidence: "clinicalRole",
        murph: "no",
        competitor: "yes",
      },
      {
        capability: "Genetics informed planning",
        evidence: "insightStyle",
        murph: "no",
        competitor: "yes",
      },
      {
        capability: "Health coaching access",
        evidence: "followThrough",
        murph: "no",
        competitor: "yes",
      },
      {
        capability: "Works without clinical membership",
        evidence: "format",
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
        competitor: "limited",
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
        capability: "Open source option",
        evidence: "platforms",
        murph: "yes",
        competitor: "no",
      },
    ],
    relationship: "different-role",
    slug: "wild-health",
    sources: [
      {
        label: "Wild Health Standard program",
        url: "https://www.wildhealth.com/functional-medicine",
      },
      {
        label: "Wild Health premium memberships",
        url: "https://www.wildhealth.com/membership",
      },
      {
        label: "Wild Health laboratory panel",
        url: "https://www.wildhealth.com/labs",
      },
      {
        label: "Wild Health terms of service",
        url: "https://www.wildhealth.com/terms-of-service",
      },
      {
        label: "Wild Health biological age testing",
        url: "https://www.wildhealth.com/biological-age-test",
      },
      {
        label: "Wild Health FAQ",
        url: "https://www.wildhealth.com/faq",
      },
    ],
    tradeoffs: [
      "Wild Health's own pages disagree on the commitment. The FAQ says four months for monthly plans, while the terms still say six months for Precision Care. Confirm which applies before checkout.",
      "What you get in testing, access, and devices changes a lot from tier to tier.",
      "Genetic associations and biological age estimates can inform the plan. They are not diagnoses or guarantees about outcomes.",
      "Genetic testing, physician care, and prescribing are outside Murph's nonclinical role.",
    ],
    useTogether:
      "Use Wild Health for the physician care, genetics, and testing. Use Murph to jot down questions as they come up, remember the instructions, keep routines going, and flag what to raise at the next visit.",
  },
  {
    aliases: ["Hone", "Hone Telehealth"],
    category: "labs-longevity",
    chooseCompetitor:
      "Pick Hone when you have symptoms you want evaluated, need hormone labs on a schedule, and want a clinician who can prescribe if you qualify.",
    chooseMurph:
      "Choose Murph if you want a private assistant for the care you already have. Murph keeps your records and lab charts in one place, helps you prepare questions, and reminds you about the plan.",
    competitor: {
      clinicalRole:
        "A licensed telehealth clinic. Treatment and prescriptions depend on clinical evaluation, state licensure, eligibility, and where you are physically located during visits.",
      followThrough:
        "Lab reviews, clinician visits in eligible tiers, treatment monitoring, and repeat testing. Prescriptions are managed when appropriate.",
      format:
        "A monthly telehealth membership with Basic, Plus, and Premium tiers. The tiers differ by sex, state, panel depth, and clinician access.",
      hardware:
        "Labs are collected with an at-home kit or through a Quest lab order. No wearable is required.",
      inputs:
        "Blood tests, symptoms, medical history, health goals, and follow-up information used in telehealth care.",
      insightStyle:
        "Clinician interpretation and treatment-oriented recommendations, not a general quantified-self dashboard.",
      platforms:
        "A mobile-friendly web account, not a downloadable app. It holds lab action items and results, virtual-consult scheduling, provider notes, medications, and billing.",
      pricing:
        "Basic costs $50 to start: the first $25 membership month plus a one-time $25 onboarding fee. After that it is $25 per month. Plus and Premium cost more, and medications are extra.",
      primaryJob:
        "Evaluate hormone and metabolic concerns and manage eligible telehealth treatment over time.",
    },
    competitorEvidence: {
      clinicalRole: [1, 4],
      followThrough: [1],
      format: [2, 3],
      hardware: [5],
      inputs: [1],
      insightStyle: [1],
      platforms: [5],
      pricing: [2],
      primaryJob: [1],
    },
    faqs: [
      {
        answer:
          "No. Murph cannot diagnose hormone conditions, order Hone treatment, or prescribe medication. Murph can help you prepare for visits and follow your licensed provider's instructions.",
        question: "Can Murph replace Hone Health treatment?",
      },
      {
        answer:
          "No. Basic, Plus, and Premium differ in lab panels, test cadence, clinician access, sex eligibility, and state coverage. Medications are billed separately in every tier.",
        question: "Do all Hone memberships include the same labs and care?",
      },
      {
        answer:
          "No. A licensed provider has to review your history and results, decide whether treatment is appropriate, and follow state rules. Membership does not guarantee a prescription.",
        question: "Does joining Hone guarantee hormone medication?",
      },
    ],
    headline: "Hone handles hormone care. Murph keeps track of everything around it.",
    lastVerified: "2026-08-31",
    metaDescription:
      "Hone Health runs hormone and metabolic labs and treats eligible patients by telehealth. Murph is a personal health assistant that keeps your records, questions, and reminders in order.",
    name: "Hone Health",
    quickComparison: [
      {
        capability: "Hormone laboratory testing",
        evidence: "inputs",
        murph: "no",
        competitor: "yes",
      },
      {
        capability: "Licensed care and prescriptions",
        evidence: "clinicalRole",
        murph: "no",
        competitor: "limited",
      },
      {
        capability: "At home lab kit option",
        evidence: "hardware",
        murph: "no",
        competitor: "yes",
      },
      {
        capability: "Treatment monitoring over time",
        evidence: "followThrough",
        murph: "limited",
        competitor: "limited",
      },
      {
        capability: "Broader health context",
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
        competitor: "limited",
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
        capability: "Open source option",
        evidence: "platforms",
        murph: "yes",
        competitor: "no",
      },
    ],
    relationship: "different-role",
    slug: "hone-health",
    sources: [
      {
        label: "Hone Health current site",
        url: "https://honehealth.com/",
      },
      {
        label: "Hone membership plan comparison",
        url: "https://help.honehealth.com/hc/en-us/articles/40161781101335-Hone-Health-Membership-Overview-Compare-Basic-Plus-Premium-Plans",
      },
      {
        label: "Hone state availability",
        url: "https://help.honehealth.com/hc/en-us/articles/40162108752919-Hone-Health-Service-Availability-by-State-2026",
      },
      {
        label: "Hone telehealth location requirements",
        url: "https://help.honehealth.com/hc/en-us/articles/40162272090519-Telehealth-Location-Requirements",
      },
      {
        label: "Hone online account and lab workflow",
        url: "https://help.honehealth.com/hc/en-us/articles/40162302949527-How-to-Use-Your-Hone-Health-Account-to-Manage-Your-Care-Online",
      },
    ],
    tradeoffs: [
      "Availability varies by state, tier, and sex. You must be in an eligible state during a visit.",
      "Medications are not part of the membership fee, and treatment is not guaranteed.",
      "The narrow Plus panel and the broader Basic or Premium panels do different jobs. Do not treat them as equivalent.",
      "Murph can keep your care organized, but it cannot decide treatment eligibility or prescribe.",
    ],
    useTogether:
      "Use Hone for the testing and the treatment decisions, which stay with its licensed providers. Use Murph to keep your questions in one place, remember the instructions, keep routines going, and get ready for the follow-up visit.",
  },
  {
    aliases: ["Quest", "Quest Diagnostics", "Quest Elite Health Profile"],
    category: "labs-longevity",
    chooseCompetitor:
      "Quest Health is the better fit if you want one self-purchased panel, collected at a nearby Quest center, with results posted online. No prior doctor visit is needed.",
    chooseMurph:
      "Choose Murph if you already have the lab report and want to understand it. Murph charts each marker against its reference band, explains it in plain terms, and keeps your questions and reminders in one place.",
    competitor: {
      clinicalRole:
        "A clinical laboratory service. Independent providers order the tests and oversee results. The ordering service is not a substitute for a full primary care relationship.",
      followThrough:
        "Online results, a Health Quotient summary, and outreach when a result is urgent. You can also choose to discuss results with an independent provider.",
      format:
        "You buy tests one at a time, then get collected in person at a Quest Patient Service Center for most profiles.",
      hardware:
        "No consumer hardware. Blood, urine, and biometric collection happen at Quest facilities, or with a supported home kit where offered.",
      inputs:
        "The Elite Health Profile uses blood, urine, biometric measurements, and a health risk survey to report 85+ health indicators.",
      insightStyle:
        "Conventional reference-range results, a summary score, and optional discussion with an independent provider.",
      platforms:
        "The Quest Health purchase flow and a MyQuest results account.",
      pricing:
        "The Elite Health Profile list price is $399, plus an independent physician service fee that generally starts at $6. Promotions can temporarily lower the test price.",
      primaryJob:
        "Give direct access to established lab testing without a prior doctor visit.",
    },
    competitorEvidence: {
      clinicalRole: [3],
      followThrough: [2],
      format: [3],
      hardware: [2, 3],
      inputs: [2],
      insightStyle: [2],
      platforms: [2],
      pricing: [2],
      primaryJob: [3],
    },
    faqs: [
      {
        answer:
          "No. Murph does not collect samples or produce Quest lab results. Murph can chart the report, explain it in plain terms, help you prepare questions, and track any follow-up your clinician recommends.",
        question: "Can Murph replace a Quest Health lab panel?",
      },
      {
        answer:
          "No. The purchase includes ordering oversight and the option to discuss results, but it does not set up ongoing primary care. Your own clinician still matters for diagnosis and treatment.",
        question: "Does Quest Health include a full doctor visit?",
      },
      {
        answer:
          "No. Quest currently says consumer tests are unavailable in Arizona, Hawaii, and Puerto Rico. Individual tests also have age, sex, and state eligibility rules.",
        question: "Is Quest Health available everywhere in the United States?",
      },
    ],
    headline: "Quest runs the panel and posts the numbers. Murph puts them in plain English.",
    lastVerified: "2026-08-31",
    metaDescription:
      "Quest Health sells lab panels like the $399 Elite Health Profile with no doctor visit needed. Murph is a personal health assistant that charts the results and explains them plainly.",
    name: "Quest Health",
    quickComparison: [
      {
        capability: "Conventional laboratory testing",
        evidence: "primaryJob",
        murph: "no",
        competitor: "yes",
      },
      {
        capability: "Independent result discussion",
        evidence: "followThrough",
        murph: "limited",
        competitor: "yes",
      },
      {
        capability: "National collection network",
        evidence: "format",
        murph: "no",
        competitor: "yes",
      },
      {
        capability: "Health summary score",
        evidence: "insightStyle",
        murph: "no",
        competitor: "yes",
      },
      {
        capability: "Cross source health context",
        evidence: "inputs",
        murph: "yes",
        competitor: "no",
      },
      {
        capability: "Practical next step planning",
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
        competitor: "no",
      },
    ],
    relationship: "complement",
    slug: "quest-health",
    sources: [
      {
        label: "Quest Health preventive profile catalog",
        url: "https://www.questhealth.com/help-me-choose/shop-by-concern/general-preventative-health",
      },
      {
        label: "Quest Elite Health Profile",
        url: "https://www.questhealth.com/product/elite-health-profile/18386M.html",
      },
      {
        label: "Quest Health availability and provider oversight FAQ",
        url: "https://www.questhealth.com/faqs-the-site-wont-let-me-purchase-an-item-that-i-have-put-in-my-cart-why-is-this.html",
      },
      {
        label: "Quest biological age add-on",
        url: "https://www.questhealth.com/articles/biological-age.html",
      },
    ],
    tradeoffs: [
      "This is a one-time test purchase. It is not an ongoing coaching service or a platform that pulls in your other health data.",
      "The physician service covers ordering and result oversight. It is not ongoing medical care.",
      "Arizona, Hawaii, and Puerto Rico are excluded from current Quest Health consumer testing.",
      "Murph cannot order, collect, or process Quest's lab tests.",
    ],
    useTogether:
      "Use Quest Health for the draw and the results. Then bring the report to Murph. Murph charts the values with reference bands, explains them, and sets reminders for whatever your clinician recommends.",
  },
  {
    aliases: ["Labcorp", "Labcorp On Demand"],
    category: "labs-longevity",
    chooseCompetitor:
      "Labcorp OnDemand is the better fit when you want one specific conventional test, a nearby collection center, and a quick result. The Comprehensive Health Test is $169.",
    chooseMurph:
      "Choose Murph if you already have records and want them to make sense day to day. Murph charts your lab values against reference bands, explains them plainly, and remembers what you decided to do about them.",
    competitor: {
      clinicalRole:
        "A clinical laboratory service. Independent providers approve OnDemand orders, and certain urgent results trigger outreach. The purchase is not comprehensive medical care.",
      followThrough:
        "Online results, and contact when a result is urgent. Advisor sessions require the separate Personal Wellness Program.",
      format:
        "A one-time online test purchase, followed by in-person collection at a Labcorp location for the Comprehensive Health Test.",
      hardware:
        "No consumer hardware. The Comprehensive Health Test uses a blood and urine sample collected at a Labcorp location.",
      inputs:
        "Conventional blood and urine measurements, including CBC, metabolic, lipid, HbA1c, and urinalysis-related values.",
      insightStyle:
        "Lab results with trend tracking and AI-assisted explanations in MyLabcorp. Labcorp leaves personalized interpretation to the ordering provider.",
      platforms:
        "Results are available in the Labcorp Patient web portal and the MyLabcorp mobile app. MyLabcorp also manages appointments and billing.",
      pricing:
        "The Comprehensive Health Test is $169. Men's and Women's Health Tests are $219, and expanded panels are priced separately.",
      primaryJob:
        "Give direct access to conventional lab tests through Labcorp's national collection network.",
    },
    competitorEvidence: {
      clinicalRole: [1],
      followThrough: [1, 2],
      format: [1],
      hardware: [1],
      inputs: [1],
      insightStyle: [1, 4],
      platforms: [1, 4],
      pricing: [1],
      primaryJob: [1],
    },
    faqs: [
      {
        answer:
          "No. Murph cannot approve, collect, or process a Labcorp test. Murph can chart the result, explain it plainly, help you prepare questions for a clinician, and remember what you decided to do.",
        question: "Can Murph replace Labcorp OnDemand testing?",
      },
      {
        answer:
          "No. The Comprehensive Health Test includes provider order approval and online results. MyLabcorp adds AI-assisted explanations and trend tracking, but not ongoing personalized coaching. Advisor sessions are a separate product, and medical care stays with your clinician.",
        question: "Does the Labcorp OnDemand test include coaching?",
      },
      {
        answer:
          "The Comprehensive Health Test currently costs $169. It uses blood and urine collected in person. Sex-specific and expanded panels have different markers and higher prices.",
        question: "What does the Labcorp Comprehensive Health Test cost?",
      },
    ],
    headline: "Labcorp OnDemand runs the test. Murph reads the report with you.",
    lastVerified: "2026-08-31",
    metaDescription:
      "Labcorp OnDemand sells one-time lab tests, like the $169 Comprehensive Health Test. Murph is a personal health assistant that charts the results and helps you follow up.",
    name: "Labcorp OnDemand",
    quickComparison: [
      {
        capability: "Conventional laboratory testing",
        evidence: "primaryJob",
        murph: "no",
        competitor: "yes",
      },
      {
        capability: "Independent order approval",
        evidence: "clinicalRole",
        murph: "no",
        competitor: "yes",
      },
      {
        capability: "National collection network",
        evidence: "primaryJob",
        murph: "no",
        competitor: "yes",
      },
      {
        capability: "AI assisted result explanations",
        evidence: "insightStyle",
        murph: "yes",
        competitor: "yes",
      },
      {
        capability: "Cross source health context",
        evidence: "inputs",
        murph: "yes",
        competitor: "no",
      },
      {
        capability: "Practical plan follow through",
        evidence: "followThrough",
        murph: "yes",
        competitor: "no",
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
        competitor: "no",
      },
    ],
    relationship: "complement",
    slug: "labcorp-ondemand",
    sources: [
      {
        label: "Labcorp Comprehensive Health Test",
        url: "https://www.ondemand.labcorp.com/lab-tests/comprehensive-health-screening",
      },
      {
        label: "Labcorp annual wellness test catalog",
        url: "https://www.ondemand.labcorp.com/products/annual-wellness",
      },
      {
        label: "About Labcorp OnDemand",
        url: "https://www.ondemand.labcorp.com/about-us",
      },
      {
        label: "Labcorp test results and MyLabcorp",
        url: "https://www.labcorp.com/patients/tests/results",
      },
    ],
    tradeoffs: [
      "The test itself comes with no ongoing coaching, wearable analysis, or guidance that combines your other data over time.",
      "Independent provider approval is narrower than a full visit with a clinician who knows your history.",
      "The broadest expanded panels cost much more than the $169 Comprehensive Health Test.",
      "Murph cannot order the Labcorp panel or produce its blood and urine measurements.",
    ],
    useTogether:
      "Use Labcorp OnDemand when you need a specific measurement. Then bring the report to Murph. Murph charts the values, explains them in plain terms, and keeps your questions, appointments, and clinician-approved actions in one place.",
  },
  {
    aliases: ["Bioniq Pro"],
    category: "labs-longevity",
    chooseCompetitor:
      "Pick Bioniq when you want a custom supplement formula built from your blood work, a nutritionist review, and an app to go with it.",
    chooseMurph:
      "Choose Murph if you want help across your whole health picture, not a service built around shipping supplements. Murph reads your labs, sleep, and meals, explains them plainly, and checks in on whatever routine you choose.",
    competitor: {
      clinicalRole:
        "A personalized nutrition and supplement service, not a general medical clinic. Its nutritionist consultation does not replace diagnosis or treatment by a licensed clinician.",
      followThrough:
        "A three-month supplement supply, one nutritionist consultation, and recommendations in the app. Retesting is optional and updates the next formula.",
      format:
        "A rolling three-month supplement subscription, billed monthly and shipped quarterly. A nonrenewing starter package is also offered.",
      hardware:
        "The PRO workflow uses a lab report, not sensor hardware. Bioniq can arrange a blood test in supported locations.",
      inputs:
        "A recent blood-test report, or a Bioniq-arranged blood test where available. You also complete the app health questionnaire, and specific lab markers are required.",
      insightStyle:
        "Lab analysis focused on nutrient status, plus a personalized supplement recipe with nutrition guidance.",
      platforms:
        "The Bioniq mobile app handles the health questionnaire, lab-report upload, analyzed results, formula details, and nutritional recommendations. PRO cancellation or freeze requests go by email, not through the app.",
      pricing:
        "Pricing was not publicly verifiable on August 30, 2026. Bioniq documents a rolling three-month subscription billed monthly and shipped quarterly, plus a nonrenewing three-month starter package in supported countries. Confirm current availability and price directly.",
      primaryJob:
        "Create and deliver a personalized daily supplement formula based on your blood data.",
    },
    competitorEvidence: {
      clinicalRole: [1, 7],
      followThrough: [1, 2],
      format: [2, 3],
      hardware: [1, 5],
      inputs: [1, 4],
      insightStyle: [1, 2],
      platforms: [2, 4, 6],
      pricing: [2, 3],
      primaryJob: [1],
    },
    faqs: [
      {
        answer:
          "No. Murph does not formulate, make, or ship personalized supplements. Murph can keep track of what a clinician or nutrition professional recommended and help you notice questions worth raising.",
        question: "Can Murph replace Bioniq PRO supplements?",
      },
      {
        answer:
          "Not automatically. The supplement plan and the initial blood test or upload processing are separate parts of onboarding. Repeat testing is optional and does not come with every quarterly shipment, so confirm current testing and plan charges with Bioniq directly.",
        question: "Is blood testing included in the Bioniq monthly price?",
      },
      {
        answer:
          "No. Bioniq PRO is a nutrition and supplement service. Its app analysis and nutritionist consultation are not a diagnosis, prescription care, or a replacement for a medical clinician.",
        question: "Is Bioniq PRO medical treatment?",
      },
    ],
    headline: "Bioniq mixes a supplement from your blood test. Murph tracks how you feel on it.",
    lastVerified: "2026-08-31",
    metaDescription:
      "Bioniq PRO turns a qualifying blood report into a custom daily supplement. Murph is a personal health assistant that tracks the routine alongside your other health data.",
    name: "Bioniq",
    quickComparison: [
      {
        capability: "Custom supplement formula",
        evidence: "primaryJob",
        murph: "no",
        competitor: "yes",
      },
      {
        capability: "Recurring supplement delivery",
        evidence: "followThrough",
        murph: "limited",
        competitor: "yes",
      },
      {
        capability: "Nutritionist consultation",
        evidence: "followThrough",
        murph: "no",
        competitor: "yes",
      },
      {
        capability: "Arranged blood test option",
        evidence: "hardware",
        murph: "no",
        competitor: "limited",
      },
      {
        capability: "Broad health context",
        evidence: "inputs",
        murph: "yes",
        competitor: "limited",
      },
      {
        capability: "Product neutral health support",
        evidence: "primaryJob",
        murph: "yes",
        competitor: "no",
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
    ],
    relationship: "different-role",
    slug: "bioniq",
    sources: [
      {
        label: "Bioniq PRO process",
        url: "https://help.bioniq.com/what-is-the-bioniq-pro-process",
      },
      {
        label: "Bioniq PRO subscription structure",
        url: "https://help.bioniq.com/how-does-the-bioniq-pro-subscription-work",
      },
      {
        label: "Bioniq PRO nonrenewing packages",
        url: "https://help.bioniq.com/do-you-offer-packages-for-bioniq-pro",
      },
      {
        label: "Bioniq PRO lab-report upload",
        url: "https://help.bioniq.com/i-have-a-blood-test",
      },
      {
        label: "Bioniq blood-test availability",
        url: "https://help.bioniq.com/bioniq-blood-test-availability",
      },
      {
        label: "Bioniq PRO cancellation and freeze process",
        url: "https://help.bioniq.com/how-do-i-cancel-my-bioniq-pro-subscription",
      },
      {
        label: "Bioniq medical-scope disclaimer",
        url: "https://www.bioniq.com/legals/go-imprint",
      },
    ],
    tradeoffs: [
      "The service is built around supplements, not broad clinical evaluation or independent coaching over time.",
      "The subscription has a three-month minimum. It ships the full quarter at once while billing monthly.",
      "Testing availability and marker lists vary by country. The US partner draw is not available in New York or New Jersey.",
      "Murph does not formulate, manufacture, or deliver Bioniq's personalized supplements.",
    ],
    useTogether:
      "Use Bioniq for the formula and the nutritionist review. Use Murph to track the daily routine, note any questions or reactions, and coordinate changes your clinician approves.",
  },
  {
    aliases: ["Neko", "Neko Scan"],
    category: "labs-longevity",
    chooseCompetitor:
      "Neko is the better fit if you want an in-person scan of skin, heart, circulation, body composition, and selected blood markers, all in one visit, with a clinician there to talk it through.",
    chooseMurph:
      "Choose Murph if you want ongoing private help with your records and plans, not a yearly visit to a clinic. Murph works wherever you are, in iMessage or Telegram, and keeps everything in one thread.",
    competitor: {
      clinicalRole:
        "An in-person preventive assessment with clinician review. Neko says its clinic is not a full-service medical practice, and members should keep their ordinary clinicians.",
      followThrough:
        "A consultation during the same visit and an action plan. If a finding warrants it, specialist review or referral support is included.",
      format:
        "An appointment of roughly one hour at a Neko Health center. It is commonly positioned as an annual scan.",
      hardware:
        "Neko's center-based sensor system captures skin imagery, cardiovascular signals, circulation, body composition, grip strength, and other measurements. It uses no ionizing radiation.",
      inputs:
        "Thousands of sensor images, ECG and cardiovascular measures, circulation, body composition, grip strength, and selected blood markers such as lipids and HbA1c.",
      insightStyle:
        "A clinician-guided preventive snapshot, with an action plan and follow-up pathways for notable findings.",
      platforms:
        "The Neko app plus a required visit to a physical clinic. Apple Health and wearable syncing are advertised.",
      pricing:
        "£299 in the United Kingdom and SEK 2,750 in Sweden. The announced US price is $499, with the first New York clinic opening September 24, 2026.",
      primaryJob:
        "Collect many noninvasive physical measurements in one visit and review them with a clinician right away.",
    },
    competitorEvidence: {
      clinicalRole: [1],
      followThrough: [1],
      format: [1],
      hardware: [1],
      inputs: [1],
      insightStyle: [1],
      platforms: [1],
      pricing: [1, 4, 5],
      primaryJob: [1],
    },
    faqs: [
      {
        answer:
          "No. Murph has no scanning hardware, does not collect Neko's physical measurements, and cannot do the clinician consultation. Murph can help you prepare for the visit and follow up on the plan afterward.",
        question: "Can Murph replace a Neko Health Scan?",
      },
      {
        answer:
          "No. Neko uses a purpose-built sensor system plus selected blood tests. It is not a whole-body MRI, and it does not replace every guideline-recommended cancer screening or diagnostic test.",
        question: "Is the Neko Health Scan a whole-body MRI?",
      },
      {
        answer:
          "Not yet, as of the verification date. Neko's first US clinic, in New York, is scheduled to open September 24, 2026. As of August 30 the US offering was still pre-opening.",
        question: "Is Neko Health currently open in the United States?",
      },
    ],
    headline: "Neko scans you in an hour. Murph carries the plan through the rest of the year.",
    lastVerified: "2026-08-31",
    metaDescription:
      "Neko Health is a one-hour in-person sensor scan with selected labs and a clinician review. Murph is a personal health assistant that keeps the action plan going after you leave.",
    name: "Neko Health",
    quickComparison: [
      {
        capability: "Clinic sensor measurements",
        evidence: "hardware",
        murph: "no",
        competitor: "yes",
      },
      {
        capability: "Immediate clinician review",
        evidence: "primaryJob",
        murph: "no",
        competitor: "yes",
      },
      {
        capability: "Same visit action plan",
        evidence: "followThrough",
        murph: "no",
        competitor: "yes",
      },
      {
        capability: "Referral support when warranted",
        evidence: "followThrough",
        murph: "yes",
        competitor: "yes",
      },
      {
        capability: "Works in iMessage or Telegram",
        evidence: "format",
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
        capability: "Longitudinal history",
        evidence: "inputs",
        murph: "yes",
        competitor: "limited",
      },
      {
        capability: "Handles changing priorities",
        evidence: "primaryJob",
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
        capability: "Open source option",
        evidence: "platforms",
        murph: "yes",
        competitor: "no",
      },
    ],
    relationship: "different-role",
    slug: "neko-health",
    sources: [
      {
        label: "Neko Health Scan in the United Kingdom",
        url: "https://www.nekohealth.com/gb/en/health-scan",
      },
      {
        label: "Neko Health Scan in the United States",
        url: "https://www.nekohealth.com/us/en/health-scan",
      },
      {
        label: "Neko Health locations",
        url: "https://www.nekohealth.com/gb/en/locations",
      },
      {
        label: "Neko New York opening announcement",
        url: "https://www.nekohealth.com/us/en/press/neko-health-is-opening-in-new-york-city",
      },
      {
        label: "Neko Health Scan in Sweden",
        url: "https://www.nekohealth.com/se/en/health-scan",
      },
    ],
    tradeoffs: [
      "You have to travel to one of a small number of physical centers. On the verification date it was not yet live in the United States.",
      "It is a once-a-year snapshot, not continuous measurement or open-ended care.",
      "Incidental or abnormal findings can mean more testing with an outside specialist or your primary clinician.",
      "Murph cannot reproduce Neko's in-person sensors or clinician consultation.",
    ],
    useTogether:
      "Use Neko for the scan and the same-day clinician review. Then bring the action plan into Murph. Murph remembers it, helps you book any referrals or appointments, and keeps track of the practical tasks.",
  },
  {
    aliases: ["Fountain", "Fountain Life CORE", "Fountain Life APEX"],
    category: "labs-longevity",
    chooseCompetitor:
      "Fountain Life is the better fit if you want an extensive yearly workup, including imaging, labs, and genetics, with a physician and care team, and the price and travel are acceptable to you.",
    chooseMurph:
      "Choose Murph if you want a useful everyday assistant for your health without buying a premium diagnostic membership. Murph reads the data you already have, explains it plainly, and keeps the plan moving.",
    competitor: {
      clinicalRole:
        "A preventive diagnostics and longevity care membership. Physicians and care teams work at physical US centers.",
      followThrough:
        "Physician review, a personalized plan, ongoing monitoring, and care team access. Additional diagnostics or therapies are optional.",
      format:
        "An annual center-based membership, offered in CORE, APEX, and family configurations.",
      hardware:
        "Center-based MRI, CT, DEXA, ECG, cardiovascular imaging, and other diagnostic equipment. What is used depends on tier and location.",
      inputs:
        "Tier-specific imaging, 100+ labs, cardiovascular tests, body composition, genetics, and other advanced diagnostics.",
      insightStyle:
        "A physician and care team pull the imaging, lab, and genetic data together into a preventive plan. The Zori AI experience supports this.",
      platforms:
        "The Fountain Life member app and Zori AI, paired with required visits to a Fountain Life center.",
      pricing:
        "CORE is currently $10,500 and APEX is $21,500. APEX Family and some services require an inquiry or a separate purchase.",
      primaryJob:
        "Deliver an extensive annual preventive workup across imaging, labs, and genetics.",
    },
    competitorEvidence: {
      clinicalRole: [1],
      followThrough: [1, 4],
      format: [1],
      hardware: [1],
      inputs: [1],
      insightStyle: [4],
      platforms: [1, 4],
      pricing: [1, 2, 3],
      primaryJob: [1],
    },
    faqs: [
      {
        answer:
          "No. Murph does not provide medical imaging, lab testing, physician care, or advanced therapies. Murph can work alongside the program by helping you prepare for visits and follow the plan.",
        question: "Can Murph replace Fountain Life diagnostics?",
      },
      {
        answer:
          "No. CORE and APEX include different subsets of imaging, labs, genetics, and care services. A diagnostic listed on the general membership page is not necessarily included in every tier.",
        question: "Does every Fountain Life membership include every diagnostic?",
      },
      {
        answer:
          "No. Fountain provides clinical review, but it describes some separately offered restorative biologic services as not FDA approved. Weigh those services separately from standard labs and imaging.",
        question: "Are all Fountain Life services standard approved screening?",
      },
    ],
    headline: "Fountain Life does the annual workup. Murph is the daily check-in.",
    lastVerified: "2026-08-31",
    metaDescription:
      "Fountain Life is a center-based membership with imaging, 100+ labs, genetics, and physician review. Murph is a personal health assistant that keeps the care plan on track.",
    name: "Fountain Life",
    quickComparison: [
      {
        capability: "Advanced diagnostic imaging",
        evidence: "hardware",
        murph: "no",
        competitor: "yes",
      },
      {
        capability: "Broad laboratory testing",
        evidence: "inputs",
        murph: "no",
        competitor: "yes",
      },
      {
        capability: "Physician care team access",
        evidence: "clinicalRole",
        murph: "no",
        competitor: "yes",
      },
      {
        capability: "Ongoing plan monitoring",
        evidence: "followThrough",
        murph: "yes",
        competitor: "yes",
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
        capability: "Wearable and lab context",
        evidence: "inputs",
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
        capability: "Open source option",
        evidence: "platforms",
        murph: "yes",
        competitor: "no",
      },
    ],
    relationship: "different-role",
    slug: "fountain-life",
    sources: [
      {
        label: "Fountain Life membership comparison",
        url: "https://www.fountainlife.com/membership",
      },
      {
        label: "Fountain Life CORE purchase",
        url: "https://shop.fountainlife.com/products/core-online-purchase",
      },
      {
        label: "Fountain Life APEX purchase",
        url: "https://shop.fountainlife.com/products/apex-membership",
      },
      {
        label: "How Fountain Life works",
        url: "https://www.fountainlife.com/how-it-works",
      },
    ],
    tradeoffs: [
      "Membership prices are far above lab-only and software-only options.",
      "You have to travel to one of a small number of physical US centers.",
      "Included diagnostics vary by tier. Separately offered therapies can have different evidence and regulatory status.",
      "Imaging, lab work, physician care, and procedures are outside what Murph does.",
    ],
    useTogether:
      "Use Fountain Life for the clinical workup and the physician's plan. Use Murph to prepare questions before visits, hold onto the care plan, coordinate follow-up appointments, and keep the routines your clinician approved going.",
  },
  {
    aliases: ["Prenuvo Whole Body MRI", "Prenuvo Scan"],
    category: "labs-longevity",
    chooseCompetitor:
      "Prenuvo is the better fit when a focused or whole-body MRI is what you want, and the cost, the travel, and the chance of follow-up tests are acceptable.",
    chooseMurph:
      "Choose Murph if you want steady, private support with your health day to day rather than a scan every year or two. Murph keeps your records, questions, and reminders in one conversation.",
    competitor: {
      clinicalRole:
        "A preventive medical imaging service with radiology review and provider result consultations. It describes whole-body MRI as an adjunct to established screening, not a replacement.",
      followThrough:
        "Radiology reporting, provider result review, and comparison of images over time. Selected annual memberships add repeat labs.",
      format:
        "A standalone scan, or an annual Core, Comprehensive, or Executive membership. All happen at a physical imaging location.",
      hardware:
        "MRI scanners. Eligible higher tiers and locations add body composition and advanced brain or heart imaging.",
      inputs:
        "A focused or whole-body MRI, tier-specific blood panels, and optional advanced brain, heart, and body composition imaging.",
      insightStyle:
        "Board-certified radiology findings, image comparison over time, blood trends in memberships, and provider review.",
      platforms:
        "Digital results and a member platform, paired with in-person imaging centers in the United States and Canada.",
      pricing:
        "Core is $1,199 per year, Comprehensive is $2,499, and Executive starts at $3,999. A standalone whole-body MRI is $2,499 and a focused scan is $1,199.",
      primaryJob:
        "Use preventive MRI to look for structural findings and track them over time, with labs added in membership tiers.",
    },
    competitorEvidence: {
      clinicalRole: [1],
      followThrough: [1],
      format: [1],
      hardware: [1],
      inputs: [1],
      insightStyle: [1],
      platforms: [1],
      pricing: [1],
      primaryJob: [1],
    },
    faqs: [
      {
        answer:
          "No. Murph has no imaging hardware and cannot read scans like a radiologist. Murph can help you prepare for the appointment and manage questions or follow-up after the clinical review.",
        question: "Can Murph replace a Prenuvo MRI?",
      },
      {
        answer:
          "No. Prenuvo says whole-body MRI is an adjunct. It does not replace established screening such as mammography, colonoscopy, cervical screening, or imaging your clinician orders for a specific reason.",
        question: "Does a Prenuvo scan replace standard cancer screening?",
      },
      {
        answer:
          "No. The standalone scan includes imaging and a one-time results process. Blood panels, repeat labs, and broader ongoing review belong to specific annual membership tiers.",
        question: "Are blood tests included with every Prenuvo scan?",
      },
    ],
    headline: "Prenuvo scans your body by MRI. Murph keeps track of the follow-up.",
    lastVerified: "2026-08-31",
    metaDescription:
      "Prenuvo offers preventive MRI read by radiologists, as a one-off scan or an annual membership with labs. Murph is a personal health assistant that helps you manage the follow-up.",
    name: "Prenuvo",
    quickComparison: [
      {
        capability: "Preventive MRI imaging",
        evidence: "hardware",
        murph: "no",
        competitor: "yes",
      },
      {
        capability: "Radiologist interpretation",
        evidence: "clinicalRole",
        murph: "no",
        competitor: "yes",
      },
      {
        capability: "Annual laboratory testing",
        evidence: "inputs",
        murph: "no",
        competitor: "limited",
      },
      {
        capability: "Ongoing health context",
        evidence: "insightStyle",
        murph: "yes",
        competitor: "limited",
      },
      {
        capability: "Follow up planning support",
        evidence: "followThrough",
        murph: "yes",
        competitor: "yes",
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
        capability: "Open source option",
        evidence: "platforms",
        murph: "yes",
        competitor: "no",
      },
    ],
    relationship: "different-role",
    slug: "prenuvo",
    sources: [
      {
        label: "Prenuvo memberships and standalone pricing",
        url: "https://prenuvo.com/what-we-offer",
      },
      {
        label: "Prenuvo FAQ and screening limitations",
        url: "https://prenuvo.com/faq",
      },
      {
        label: "Prenuvo service overview",
        url: "https://prenuvo.com/",
      },
    ],
    tradeoffs: [
      "Every option means travel to a supported imaging location and costs much more than a software service.",
      "Whole-body MRI can turn up incidental findings that need more clinical workup.",
      "Blood panels and repeated provider reviews come with memberships, not with every standalone scan.",
      "Murph cannot take or interpret MRI images.",
    ],
    useTogether:
      "Use Prenuvo for the imaging and the clinical review. Then bring the report and plan into Murph. Murph holds onto the plan, helps you write questions for specialists, coordinates appointments, and reminds you about the health steps you agreed to.",
  },
  {
    aliases: ["TruAge", "TruDiagnostic TruAge", "TruHealth"],
    category: "labs-longevity",
    chooseCompetitor:
      "TruDiagnostic is the better fit when your main question is what a blood-based methylation clock says about your biological aging, and how that changes across repeat tests.",
    chooseMurph:
      "Choose Murph if you want help across your records, goals, and habits over time, not a single specialized report. Murph can hold the TruAge result next to your labs and wearable data and explain what each one says.",
    competitor: {
      clinicalRole:
        "A research, informational, and educational epigenetic testing service. TruDiagnostic says its reports do not independently diagnose, prevent, or treat disease.",
      followThrough:
        "A secure report and personalized recommendations. Repeat testing every few months is optional, and ongoing clinical care is not included.",
      format:
        "An at-home finger-prick blood test, bought once or as a subscription. You mail the sample to a lab for DNA methylation analysis.",
      hardware:
        "A disposable finger-prick collection kit. No ongoing device is required.",
      inputs:
        "A dried blood spot, analyzed at more than one million DNA methylation sites, plus registration and self-reported information.",
      insightStyle:
        "Overall biological age, pace of aging, 11 organ-system age estimates, and health-related outputs inferred from methylation.",
      platforms:
        "A secure web results portal for TruAge and TruHealth reports.",
      pricing:
        "TruAge is $499 one time, TruHealth is $499, and the combined kit is $849. A four-test subscription is marketed near $249 per test.",
      primaryJob:
        "Estimate biological aging patterns from blood DNA methylation and compare those estimates across repeat tests.",
    },
    competitorEvidence: {
      clinicalRole: [4],
      followThrough: [1, 4],
      format: [1],
      hardware: [1],
      inputs: [1],
      insightStyle: [1],
      platforms: [1],
      pricing: [1],
      primaryJob: [1],
    },
    faqs: [
      {
        answer:
          "No. Murph cannot process DNA methylation or calculate TruDiagnostic's proprietary clocks. Murph can help you understand what the report does and does not cover, and prepare questions for a qualified clinician.",
        question: "Can Murph calculate a TruAge result?",
      },
      {
        answer:
          "No. Values such as organ age, telomere length, and some inflammation or health outputs are inferred from methylation models. That is not the same as directly measuring serum LDL, glucose, or an organ's chronological age.",
        question: "Are all TruDiagnostic outputs direct measurements?",
      },
      {
        answer:
          "No. TruDiagnostic's terms describe the service as research, informational, and educational. A qualified professional should interpret the results together with your medical history and conventional clinical information.",
        question: "Does TruAge diagnose disease?",
      },
    ],
    headline: "TruDiagnostic estimates biological age. Murph compares it with your other data.",
    lastVerified: "2026-08-31",
    metaDescription:
      "TruDiagnostic estimates biological age from a $499 finger-prick DNA methylation test. Murph is a personal health assistant that reads the report alongside your labs, sleep, and habits.",
    name: "TruDiagnostic",
    quickComparison: [
      {
        capability: "DNA methylation testing",
        evidence: "inputs",
        murph: "no",
        competitor: "yes",
      },
      {
        capability: "Biological age estimates",
        evidence: "insightStyle",
        murph: "no",
        competitor: "yes",
      },
      {
        capability: "At home finger prick collection",
        evidence: "hardware",
        murph: "no",
        competitor: "yes",
      },
      {
        capability: "Cross source health context",
        evidence: "inputs",
        murph: "yes",
        competitor: "no",
      },
      {
        capability: "Personalized recommendations",
        evidence: "followThrough",
        murph: "yes",
        competitor: "yes",
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
        capability: "Open source option",
        evidence: "platforms",
        murph: "yes",
        competitor: "no",
      },
    ],
    relationship: "complement",
    slug: "trudiagnostic",
    sources: [
      {
        label: "TruAge product and pricing",
        url: "https://shop.trudiagnostic.com/products/truage-complete-epigenetic-collection",
      },
      {
        label: "TruAge and TruHealth combination kit",
        url: "https://shop.trudiagnostic.com/collections/shopfront/products/truage-truhealth",
      },
      {
        label: "TruDiagnostic report interpretation",
        url: "https://www.trudiagnostic.com/report-education",
      },
      {
        label: "TruDiagnostic terms of service",
        url: "https://www.trudiagnostic.com/terms-of-service",
      },
    ],
    tradeoffs: [
      "The $499 test is specialized around methylation. It does not replace conventional labs or a medical evaluation.",
      "Many report values are model-based estimates, so you cannot compare them directly with measured blood chemistry.",
      "Ongoing clinical interpretation or coaching is not included in the consumer test price.",
      "Murph cannot process DNA methylation or reproduce TruDiagnostic's proprietary clocks.",
    ],
    useTogether:
      "Use TruDiagnostic for the methylation assay and its report. Then bring the report into Murph. Murph keeps it with your other records, helps you write down questions, and supports the actions you agree on with a qualified clinician.",
  },
  {
    aliases: ["Tally", "TallyAge"],
    category: "labs-longevity",
    chooseCompetitor:
      "Tally Health is the better fit if you want a noninvasive aging score, a retest every six months, and a daily supplement bundled together.",
    chooseMurph:
      "Choose Murph if you want one assistant for many health questions and data sources, not a relationship built around one age score or a supplement subscription. Murph reads your labs, sleep, and food logs and explains them plainly.",
    competitor: {
      clinicalRole:
        "A wellness testing and supplement service. Tally says its reports, advice, and products are not medical advice or disease treatment.",
      followThrough:
        "A personalized lifestyle action plan and digital check-ins. Members get a repeat TallyAge test every six months and monthly supplement delivery.",
      format:
        "A monthly membership, or a one-time at-home cheek-swab test.",
      hardware:
        "A disposable cheek-swab collection kit. No ongoing device is required.",
      inputs:
        "Cheek-cell DNA methylation, plus a lifestyle survey covering diet, exercise, sleep, mental health, and habits.",
      insightStyle:
        "A single TallyAge estimate and personalized lifestyle recommendations, not conventional lab values.",
      platforms:
        "The Tally Health digital platform, for the age result, action plan, and membership management.",
      pricing:
        "$129 per month for membership, which includes a TallyAge test every six months and a daily Vitality supplement. A one-time TallyAge test is $249.",
      primaryJob:
        "Estimate epigenetic age from cheek cells and pair the result with lifestyle guidance and supplements.",
    },
    competitorEvidence: {
      clinicalRole: [4],
      followThrough: [1],
      format: [1, 2],
      hardware: [1],
      inputs: [1],
      insightStyle: [1, 2],
      platforms: [1],
      pricing: [1, 2],
      primaryJob: [1],
    },
    faqs: [
      {
        answer:
          "No. Murph cannot analyze cheek-cell methylation or produce Tally's proprietary age result. Murph can help you think through the result and keep track of the habits you choose.",
        question: "Can Murph calculate a TallyAge score?",
      },
      {
        answer:
          "No. TallyAge is a model-based estimate from cheek-cell DNA methylation and your survey answers. It is not a directly measured whole-body age or a diagnosis, and it is not equivalent to a blood-based clock.",
        question: "Is TallyAge a direct measurement of biological age?",
      },
      {
        answer:
          "No. A single TallyAge test costs $249. The $129 monthly membership adds a test every six months, an action plan, check-ins, and daily supplement delivery.",
        question: "Do I need a Tally Health membership to take the test?",
      },
    ],
    headline: "Tally scores your age twice a year. Murph works with you week to week.",
    lastVerified: "2026-08-31",
    metaDescription:
      "Tally Health pairs a cheek-swab age estimate with a lifestyle plan and a daily supplement. Murph is a personal health assistant that works with all your health data, not one score.",
    name: "Tally Health",
    quickComparison: [
      {
        capability: "Cheek swab age testing",
        evidence: "format",
        murph: "no",
        competitor: "yes",
      },
      {
        capability: "Daily supplement delivery",
        evidence: "followThrough",
        murph: "limited",
        competitor: "limited",
      },
      {
        capability: "Personalized lifestyle plan",
        evidence: "followThrough",
        murph: "yes",
        competitor: "yes",
      },
      {
        capability: "Reminders and check ins",
        evidence: "followThrough",
        murph: "yes",
        competitor: "yes",
      },
      {
        capability: "Cross source health context",
        evidence: "inputs",
        murph: "yes",
        competitor: "limited",
      },
      {
        capability: "Product neutral health support",
        evidence: "primaryJob",
        murph: "yes",
        competitor: "no",
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
    ],
    relationship: "different-role",
    slug: "tally-health",
    sources: [
      {
        label: "Tally Health membership",
        url: "https://tallyhealth.com/products/membership",
      },
      {
        label: "TallyAge one-time test pricing",
        url: "https://support.tallyhealth.com/en-US/can-i-buy-a-tallyage-test-without-a-membership-186213",
      },
      {
        label: "Tally Health shipping availability",
        url: "https://support.tallyhealth.com/en-US/where-do-you-ship-and-do-you-ship-internationally-186203",
      },
      {
        label: "Tally Health terms of service",
        url: "https://tallyhealth.com/policies/terms-of-service",
      },
    ],
    tradeoffs: [
      "The membership is expensive if all you want is the twice-yearly cheek-swab test.",
      "TallyAge is an estimate from one specific model. You cannot compare it directly with blood chemistry or a clock from another tissue.",
      "The service bundles supplements. It does not provide licensed ongoing medical care or conventional lab testing.",
      "Murph cannot run the cheek-swab assay, calculate TallyAge, or supply the bundled supplements.",
    ],
    useTogether:
      "Use Tally for the cheek-swab result and its program. Use Murph to keep the lifestyle changes realistic, write down questions as they come up, and see how the result sits next to your other health data.",
  },
] as const);
