import { defineComparisons } from "../types";

export const LABS_LONGEVITY_COMPARISONS = defineComparisons([
  {
    aliases: ["Function"],
    bestFor:
      "US adults who want a broad laboratory baseline, a second testing point later in the year, and optional imaging in one account.",
    bottomLine:
      "Keep Function Health for the broad laboratory baseline and optional scans. Add Murph when the harder job begins after the results: connecting them with the rest of your history, preparing better questions, and following through between tests. Murph does not order or perform those tests.",
    category: "labs-longevity",
    chooseCompetitor:
      "Choose Function when the immediate need is a prepaid annual lab program with clinician reviewed explanations and access to add-on imaging.",
    chooseMurph:
      "Choose Murph when the main need is a continuing conversation that connects health context across time and helps turn an existing plan into practical next steps.",
    competitor: {
      clinicalRole:
        "Function is a health technology company. Independent laboratories and clinicians provide testing and review; Function says it does not diagnose or treat disease.",
      followThrough:
        "A personalized protocol, result explanations, clinician flags, a midyear test, and optional tests or scans at added cost.",
      format:
        "An annual testing membership with an initial lab visit, a follow-up visit 3 to 6 months later, and a longitudinal results account.",
      hardware:
        "No owned device is required. Samples are collected through partner labs or mobile phlebotomy, with MRI and CT available separately.",
      inputs:
        "Blood, urine, health history, prior result uploads, and optional MRI, CT, or add-on test data.",
      insightStyle:
        "Clinician reviewed biomarker explanations, issue flags, longitudinal trends, and a personalized protocol.",
      platforms:
        "Web member portal with private AI chat and optional connections to supported AI assistants.",
      pricing:
        "$365 charged annually on the current public site. The footer calls this a first-year price; add-ons, scans, and some state-specific lab costs are extra.",
      primaryJob:
        "Provide a broad twice-yearly laboratory view and make the results easier to inspect over time.",
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
          "No. Murph does not draw blood, run laboratory assays, or provide MRI or CT scans. Function can supply those measurements, while Murph can help organize the resulting context and support follow-through.",
        question: "Can Murph replace Function Health testing?",
      },
      {
        answer:
          "Function currently describes 160+ annual lab tests split across an initial 100+ test visit and a 60+ test follow-up. Add-on tests and imaging are not part of the base testing count.",
        question: "What does Function Health include during a year?",
      },
      {
        answer:
          "No. Function says it is not a medical provider, and Murph is also not medical care. Urgent symptoms, diagnoses, and treatment decisions belong with a licensed clinician.",
        question: "Is either Function Health or Murph primary medical care?",
      },
    ],
    headline: "Function Health measures broadly. Murph helps carry the context forward.",
    lastVerified: "2026-08-31",
    metaDescription:
      "Function Health provides broad annual labs and optional scans. Murph is a personal health assistant for connecting those results to context, questions, and follow-through.",
    name: "Function Health",
    overview:
      "Function Health is strongest when you want a broad, repeatable measurement program in one account. Murph works one layer above the testing event: it keeps the records and plans you choose to share in a continuing conversation, so a flagged result can become a clinician question, a realistic next step, and something you actually revisit. Function supplies the measurements; Murph carries their useful context forward.",
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
      "The public site calls $365 a first-year price, so renewal cost should be confirmed before purchase.",
      "The 160+ annual figure spans two testing points and should not be read as 160 unique assays in one draw.",
      "Function generates results but does not replace a treating clinician, while Murph does not generate laboratory or scan data at all.",
    ],
    useTogether:
      "Use Function for measurements and clinician reviewed result notes, then bring the relevant report, questions, and agreed next steps into Murph for reminders, planning, and ongoing context.",
  },
  {
    aliases: ["Superpower Health"],
    bestFor:
      "US consumers who want an annual broad lab draw, wearable context, an AI generated protocol, and access to a health marketplace at a relatively low entry price.",
    bottomLine:
      "Choose Superpower for its annual blood test, protocol, and connected marketplace. Choose Murph when you already have measurements or recommendations and need them connected to the rest of your health context and daily life. Murph does not provide testing or a treatment marketplace.",
    category: "labs-longevity",
    chooseCompetitor:
      "Choose Superpower when a yearly 100+ biomarker blood draw and its connected marketplace are the core purchase.",
    chooseMurph:
      "Choose Murph when ongoing conversation, remembered context, adaptable plans, and support between health events matter more than buying a lab bundle.",
    competitor: {
      clinicalRole:
        "Superpower is a technology platform, not a healthcare provider. Independent clinicians and labs provide medical and testing services, while nonclinical care team members offer wellness support.",
      followThrough:
        "A personalized protocol, AI chat, year-round care team messaging, wearable trends, and access to separately purchased tests, supplements, and eligible prescriptions.",
      format:
        "An annual membership beginning with one partner lab draw or an optional at-home collection.",
      hardware:
        "No ongoing device is required. It can incorporate supported wearable data and uses partner collection services.",
      inputs:
        "A 100+ biomarker blood test, health history, uploaded outside labs, and supported wearable data including Apple Health, WHOOP, and Oura.",
      insightStyle:
        "A biological age estimate, health scores, trends, and an AI generated lifestyle, diet, and supplement protocol.",
      platforms:
        "Web member portal with mobile app distribution referenced in its terms and supported wearable connections.",
      pricing:
        "Starts at $199 per year. At-home collection, repeat testing, marketplace products, prescriptions, and specialty tests can cost more.",
      primaryJob:
        "Turn one broad annual lab baseline into a protocol and a catalog of possible next services.",
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
          "No. Murph does not order or perform Superpower's blood test. Someone can use the products together by bringing relevant results and clinician instructions into Murph for ongoing support.",
        question: "Does Murph replace the Superpower blood test?",
      },
      {
        answer:
          "The base membership starts with one annual 100+ biomarker draw. Additional tests, at-home collection, products, and prescriptions can carry separate charges.",
        question: "Are all Superpower tests and treatments included for $199?",
      },
      {
        answer:
          "Superpower says its AI and nonclinical care team do not diagnose or treat. Murph is also educational support rather than medical care, so a licensed clinician remains responsible for diagnosis and treatment.",
        question: "Is Superpower's AI the same as medical care?",
      },
    ],
    headline: "Superpower sells an annual health baseline. Murph stays with the plan between tests.",
    lastVerified: "2026-08-31",
    metaDescription:
      "Superpower bundles an annual biomarker test, protocol, and marketplace. Murph is a personal health assistant for carrying the plan into daily life, not a testing service.",
    name: "Superpower",
    overview:
      "Superpower's advantage is a relatively low starting price for one broad annual draw, scores, an AI protocol, wearable syncing, care team messaging, and access to separately priced products. Murph is useful during the months between measurements, when questions, routines, and practical follow-through determine whether a protocol fits real life. For many people, the products are more useful together than as substitutes.",
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
      "The base program centers on one annual draw rather than repeated included testing through the year.",
      "Marketplace access is not the same as having every add-on, medication, or specialty test included.",
      "Its protocol and biological age outputs are interpretations and estimates, not independent diagnoses.",
      "Murph supplies none of Superpower's testing, proprietary scores, prescriptions, or marketplace products.",
    ],
    useTogether:
      "Use Superpower to obtain the annual panel and its reviewed protocol, then use Murph to keep relevant tasks, questions, habits, and follow-up timing in one continuing conversation.",
  },
  {
    aliases: ["Inside Tracker"],
    bestFor:
      "Performance-oriented users who want to combine blood results with fitness trackers, sleep data, and optional DNA information.",
    bottomLine:
      "InsideTracker is the better fit for proprietary performance analytics across supported blood, DNA, and wearable signals. Murph is the better fit when you want those findings connected to a wider health story and translated into an ongoing conversation and practical follow-through. It does not supply InsideTracker's blood draw or scores.",
    category: "labs-longevity",
    chooseCompetitor:
      "Choose InsideTracker when performance analytics, supported wearable integrations, and a structured biomarker action plan are the main job.",
    chooseMurph:
      "Choose Murph when you want a private assistant to connect health questions and plans beyond a performance dashboard and help with follow-through over time.",
    competitor: {
      clinicalRole:
        "A wellness analytics service that says its results and recommendations are not medical advice, diagnosis, or treatment.",
      followThrough:
        "Personalized recommendations, an action plan, trend tracking, and suggested retesting; its Nutrition DeepDive uses algorithmic recommendations, and InsideTracker says the tool complements rather than replaces a doctor's visit.",
      format:
        "A yearly analytics membership that can be paired with an InsideTracker blood test or supported outside results.",
      hardware:
        "No proprietary device. It imports data from supported watches, rings, and fitness services.",
      inputs:
        "Up to 54 blood biomarkers in Ultimate, supported outside lab uploads, fitness and sleep trackers, and optional eligible DNA uploads.",
      insightStyle:
        "Healthspan category scores, optimized ranges, recommendations, and optional InnerAge and DNA insights.",
      platforms:
        "Web, iOS, and Android with Apple Health, Oura, Fitbit, and Garmin support.",
      pricing:
        "For new US and Canadian customers, Membership plus Ultimate is $489. The standalone $149 membership is listed for international customers; current members can buy Ultimate for $340. InnerAge and DNA can cost extra.",
      primaryJob:
        "Translate performance-related labs and tracker data into structured recommendations and trends.",
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
          "No. Murph does not provide InsideTracker's blood test or proprietary scores. Murph can help a person discuss the results, connect them with other context, and carry out an agreed plan.",
        question: "Can Murph replace InsideTracker Ultimate?",
      },
      {
        answer:
          "No. The $149 membership provides the analytics platform and supported uploads, while InsideTracker-ordered blood testing is purchased separately or through a bundle.",
        question: "Does an InsideTracker membership include a blood test?",
      },
      {
        answer:
          "InsideTracker presents biomarker and model-based insights for wellness and performance. Its terms say these do not diagnose or treat disease, and InnerAge is an estimate rather than a directly measured age.",
        question: "Are InsideTracker recommendations medical advice?",
      },
    ],
    headline: "InsideTracker structures performance data. Murph connects it to the rest of life.",
    lastVerified: "2026-08-31",
    metaDescription:
      "InsideTracker turns supported blood, DNA, and wearable data into proprietary analytics. Murph is a personal health assistant for wider context and ongoing follow-through.",
    name: "InsideTracker",
    overview:
      "InsideTracker gives quantified-performance users something Murph does not try to recreate: a structured dashboard, optimized ranges, and proprietary recommendations from supported biomarker and tracker data. Murph earns its place after that analysis, when a recommendation needs to be weighed against other records, turned into a workable routine, remembered, and revisited. It complements the test and dashboard; neither product replaces a clinician.",
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
      "The lowest-priced membership does not include an InsideTracker blood draw.",
      "InnerAge and DNA analysis depend on the purchased package and should not be assumed to be included.",
      "Outside lab uploads only produce analytics for supported markers, not every value in the original report.",
      "Murph does not calculate InsideTracker's optimized ranges, proprietary scores, or recommendations.",
    ],
    useTogether:
      "Use InsideTracker for its supported lab and performance analytics, then bring the useful findings into Murph to plan habits, remember context, and review what changed.",
  },
  {
    aliases: ["SiPhox", "SiPhox Core"],
    bestFor:
      "People who prefer collecting repeat blood samples at home and want a modular panel with wearable and outside-lab context.",
    bottomLine:
      "Choose SiPhox Health when convenient repeat blood collection is the missing piece. Choose Murph when you already have the measurements and need a private place to connect the result with other context, decide what matters, and carry the plan between test cycles. Murph does not collect or analyze the sample.",
    category: "labs-longevity",
    chooseCompetitor:
      "Choose SiPhox when at-home collection, configurable lab panels, and recurring test cycles are the central requirement.",
    chooseMurph:
      "Choose Murph when the central requirement is a continuing assistant for questions, decisions, habits, reminders, and context across multiple health sources.",
    competitor: {
      clinicalRole:
        "Primarily a wellness testing platform. Certain clinical programs use independent telehealth clinicians, while SiPhox itself says it is not a medical provider.",
      followThrough:
        "A personalized action plan, longitudinal dashboard, retest cadence, wearable context, and optional coaching or clinical programs.",
      format:
        "A recurring at-home test cycle offered monthly, quarterly, or every six months, with one-time specialty panels also available.",
      hardware:
        "An EasyDraw upper-arm collection device is used for mailed samples. No ongoing wearable is required.",
      inputs:
        "At-home blood samples, health information, supported outside labs, supplements, and compatible wearable or CGM data.",
      insightStyle:
        "Panel-based biomarker trends and a personalized action plan, with depth determined by the base panel and selected upgrades.",
      platforms:
        "Digital dashboard with integrations that include Oura, Apple Watch, Fitbit, Eight Sleep, Dexcom, FreeStyle CGMs, and Google Fit.",
      pricing:
        "The introductory base-panel cycle is $124 at checkout ($99 plus $25 shipping), then $149 per renewal ($124 plus $25 shipping). Ultimate 360 is $249 for new customers and $274 on renewal; panel add-ons and coaching cost more.",
      primaryJob:
        "Make repeat laboratory testing possible from home and show changes across test cycles.",
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
          "No. Murph is not a laboratory and cannot replace the EasyDraw collection, assay processing, or SiPhox report. It can support planning and follow-through after the results arrive.",
        question: "Can Murph do the SiPhox at-home blood test?",
      },
      {
        answer:
          "No. The base panel starts with a smaller included set, while additional markers and programs require upgrades. SiPhox pages also vary in how they count calculated and measured outputs.",
        question: "Are all SiPhox biomarkers included in the base price?",
      },
      {
        answer:
          "Most SiPhox services are wellness testing. Some named programs offer care through independent clinicians, with availability determined by state and program eligibility.",
        question: "Does SiPhox Health provide medical care?",
      },
    ],
    headline: "SiPhox brings repeat lab collection home. Murph supports what happens next.",
    lastVerified: "2026-08-31",
    metaDescription:
      "SiPhox Health provides repeat at-home blood collection and biomarker trends. Murph is a personal health assistant for questions and plans between test cycles, not a lab.",
    name: "SiPhox Health",
    overview:
      "SiPhox Health's advantage is concrete: repeat blood testing from an upper-arm collection kit, configurable panels, and a dashboard built to compare cycles. Murph adds continuity beyond that dashboard. It can keep the questions raised by a result beside other records, routines, reminders, and clinician guidance, so the next test is not the first time you revisit the plan.",
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
      "Base and upgraded panels include different markers, so the highest advertised count is not the base program.",
      "New York and Hawaii are excluded from current services, and telehealth has additional state limits.",
      "Shipping, upgrades, specialty panels, coaching, and clinical programs can raise the total beyond the headline cycle price.",
      "Sample collection, laboratory analysis, and SiPhox's biomarker results remain outside Murph's role.",
    ],
    useTogether:
      "Use SiPhox for repeat measurements, then bring the reviewed result and selected actions into Murph for practical routines, reminders, and questions to take to a clinician.",
  },
  {
    aliases: ["Lifeforce Health"],
    bestFor:
      "US adults seeking repeat labs, clinician consultations, health coaching, and possible prescription treatment in one longevity program.",
    bottomLine:
      "Choose Lifeforce when you need recurring labs, coaching, and access to licensed clinical care through its independent practices. Add Murph when you want the resulting plan, questions, routines, and obstacles to stay connected between appointments. Murph cannot replace Lifeforce's clinicians or tests.",
    category: "labs-longevity",
    chooseCompetitor:
      "Choose Lifeforce when recurring labs, scheduled clinical consultation, coaching, and treatment eligibility are the main purchase.",
    chooseMurph:
      "Choose Murph when you already have care or data and want an ongoing private assistant for context, preparation, decisions, and follow-through.",
    competitor: {
      clinicalRole:
        "Licensed care is delivered through independent professional practices. The program can evaluate prescriptions, but it is not emergency or full primary care.",
      followThrough:
        "Clinician consultations, a personalized program, coaching in the monthly tier, repeat labs, and access to eligible prescriptions and supplements.",
      format:
        "A clinical longevity membership offered as a monthly high-touch program or a lower-touch annual Core plan.",
      hardware:
        "No proprietary device is required. Blood can be collected at home or through a partner laboratory.",
      inputs:
        "Health history, goals, 50+ laboratory markers, repeat testing, and information reviewed during clinician and coach visits.",
      insightStyle:
        "A LifeScore-style dashboard, biological age estimate, clinician interpretation, and a personalized clinical and lifestyle program.",
      platforms:
        "Digital member dashboard with telehealth consultations and coaching communication.",
      pricing:
        "Monthly Membership starts with a $199 payment and then $149 per month. Core Annual is $599. Medications, supplements, and specialty services are extra.",
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
          "No. Murph cannot order Lifeforce tests, prescribe medication, or replace its licensed clinicians. Murph can help someone prepare for visits and follow a clinician-approved plan.",
        question: "Can Murph replace a Lifeforce clinician?",
      },
      {
        answer:
          "No. The monthly and Core Annual tiers include different testing cadence, consultation access, and coaching. Prescriptions, medications, supplements, and specialty services can cost extra.",
        question: "Is everything in Lifeforce included in one membership price?",
      },
      {
        answer:
          "Eligible licensed clinicians can diagnose and treat within their scope and state rules. Lifeforce's technology entity is separate from those practices, and the service is not emergency care.",
        question: "Does Lifeforce provide medical treatment?",
      },
    ],
    headline: "Lifeforce combines labs with clinical care. Murph supports the work between visits.",
    lastVerified: "2026-08-31",
    metaDescription:
      "Lifeforce combines recurring labs, coaching, and licensed clinical care. Murph is a personal health assistant for continuity around visits, not a clinician or prescriber.",
    name: "Lifeforce",
    overview:
      "Lifeforce is closer to a telehealth longevity clinic than a dashboard, and that clinical access is its decisive advantage. Murph occupies the nonclinical space around the visits: gathering the questions worth asking, retaining instructions, making routines workable, and noticing what is getting in the way. The clean comparison is licensed care versus continuity around care, not one service replacing the other.",
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
      "The monthly program costs substantially more than a lab-only membership.",
      "Medical, prescription, and treatment availability depends on state rules and clinical eligibility.",
      "Medication, supplements, and specialty services are not included in the advertised membership prices.",
      "Licensed consultations, treatment eligibility, and prescribing remain Lifeforce functions that Murph cannot provide.",
    ],
    useTogether:
      "Use Lifeforce for its measurements and licensed care, while using Murph to prepare questions, remember clinician instructions, schedule practical tasks, and notice barriers to the plan.",
  },
  {
    aliases: ["Mito", "Mito Core"],
    bestFor:
      "US consumers who want flexible pay-as-you-go testing, member-priced panels, a longitudinal record, and clinician reviewed wellness guidance.",
    bottomLine:
      "Choose Mito Health when you want to shop for specific tests and receive a reviewed action plan. Choose Murph when you want that plan connected to records, goals, routines, and future questions without the relationship revolving around the next test purchase. Murph does not order or run Mito tests.",
    category: "labs-longevity",
    chooseCompetitor:
      "Choose Mito when you want to select individual tests or panels, compare transparent prices, and receive a clinician reviewed action plan.",
    chooseMurph:
      "Choose Murph when you want ongoing context and practical support that is not tied to ordering another test or buying a specific panel.",
    competitor: {
      clinicalRole:
        "Mito is a technology platform rather than a medical provider. Independent partner clinics order tests and review results, while Mito describes its guidance as wellness information.",
      followThrough:
        "Trend tracking, retest reminders, an action plan, AI concierge chat, in-chat clinician escalation, and optional paid consultations.",
      format:
        "A month-to-month membership layered onto an at-cost test marketplace, with nonmember ordering also available.",
      hardware:
        "No ongoing proprietary device. Collection can occur at partner laboratories or through selected at-home kits.",
      inputs:
        "Selected blood, urine, stool, genetic, or specialty tests, a health questionnaire, and uploaded prior laboratory records.",
      insightStyle:
        "Clinician reviewed explanations, a personalized wellness plan, biological age tracking, trends, and an AI health concierge.",
      platforms:
        "Digital web dashboard and concierge experience. A current native mobile app commitment is not clearly stated on the public pages.",
      pricing:
        "$9 per month for membership, with tests purchased separately. Mito Core starts at $197.62 for members through one provider, but state and laboratory pricing can be much higher.",
      primaryJob:
        "Offer flexible direct testing at listed prices and keep the resulting records and guidance together.",
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
          "No. Murph cannot order, collect, or process Mito tests. It can help someone work with an existing result and the plan their clinician or Mito review produced.",
        question: "Can Murph replace Mito Health laboratory testing?",
      },
      {
        answer:
          "No. The $9 monthly fee unlocks member pricing, tracking, guidance, and concierge features. Tests, draw fees, specialty kits, scans, and one-to-one consultations are purchased separately.",
        question: "Are Mito Health tests included in the $9 membership?",
      },
      {
        answer:
          "Mito pages currently use several different counts for curated panels, sometimes mixing measured markers, sex-specific values, urine outputs, and calculated results. The exact product page and checkout are the safer references.",
        question: "Why do Mito Health biomarker counts vary by page?",
      },
    ],
    headline: "Mito makes testing modular. Murph makes the follow-through continuous.",
    lastVerified: "2026-08-31",
    metaDescription:
      "Mito Health sells separately priced tests with clinician-reviewed action plans. Murph is a personal health assistant for connecting those results to records and daily follow-through.",
    name: "Mito Health",
    overview:
      "Mito Health's current model is flexible: a low-cost membership, separately priced tests, member pricing, a longitudinal record, clinician reviewed action plans, and concierge support. Murph is useful after the purchase, when one result needs to be placed beside other records and turned into actions that survive daily life. It does not replace Mito's test or review; it makes the selected next steps easier to carry forward.",
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
      "The membership does not include a test, so the useful total price depends on what is ordered and where it is collected.",
      "The current site shows inconsistent panel counts and materially different provider prices by state.",
      "Mito's clinician review and wellness recommendations do not create a treating relationship with Mito itself.",
      "Murph cannot order Mito's tests or stand in for the independent clinical review.",
    ],
    useTogether:
      "Use Mito to order the appropriate test and obtain its reviewed action plan, then use Murph to carry selected next steps, reminders, and questions into everyday life.",
  },
  {
    aliases: ["Parsley", "Parsley Clinical Lab Review"],
    bestFor:
      "People who want a board-certified functional medicine clinician to interpret broad labs in the context of symptoms, history, and lifestyle.",
    bottomLine:
      "Choose Parsley Clinical Lab Review when you want a licensed functional medicine clinician to interpret broad labs with your symptoms and history. Add Murph to arrive better prepared and keep the agreed plan workable afterward. Murph is not a clinician and should not replace or overrule Parsley's interpretation.",
    category: "labs-longevity",
    chooseCompetitor:
      "Choose Parsley when live clinician interpretation, symptom context, and a medical care pathway are the essential needs.",
    chooseMurph:
      "Choose Murph when you want a private ongoing assistant to help prepare for care, organize records, and carry clinician-approved actions into daily life.",
    competitor: {
      clinicalRole:
        "Clinical care is delivered by board-certified clinicians through independent physician-owned medical groups supported by Parsley's management platform.",
      followThrough:
        "A personalized action plan, 14 days of care team messaging, and an option to continue into the separate Complete Care program.",
      format:
        "A 30-minute virtual Clinical Lab Review using Parsley's 80+ biomarker panel or qualifying outside labs from the prior six months, sold as an annual membership that auto-renews unless canceled.",
      hardware:
        "No proprietary device. The panel uses Quest collection or optional at-home phlebotomy where available.",
      inputs:
        "Blood results, symptoms, medical history, lifestyle information, and outside records reviewed during a clinical visit.",
      insightStyle:
        "Clinician interpretation plus a Functional Health Score, Functional Age estimate, Aging Velocity estimate, and personalized recommendations.",
      platforms:
        "HIPAA-compliant patient portal, virtual visits, and secure care team messaging.",
      pricing:
        "$550 per year for the Advanced Lab Panel plus visit, or $250 per year to bring recent outside labs. The Clinical Lab Review membership auto-renews unless canceled; Complete Care is separate, with insurance and self-pay rules.",
      primaryJob:
        "Explain broad blood results in clinical context and define appropriate medical and lifestyle next steps.",
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
          "No. Parsley's visit is with a licensed clinician, while Murph does not diagnose or treat. Murph can help prepare questions and follow a plan but should not substitute for the visit.",
        question: "Can Murph replace a Parsley Clinical Lab Review?",
      },
      {
        answer:
          "Clinical Lab Review is self-pay at $550 per year with Parsley's panel or $250 per year with recent eligible outside labs. The membership auto-renews unless canceled. Complete Care is a different program with membership fees, medical billing, copays, and deductibles.",
        question: "Is Parsley Clinical Lab Review covered by the Complete Care price?",
      },
      {
        answer:
          "No. They are clinician-informed model outputs derived from lab data and trends. They are useful summaries, not directly measured ages or diagnoses.",
        question: "Are Parsley's Functional Age and Aging Velocity direct measurements?",
      },
    ],
    headline: "Parsley provides clinical interpretation. Murph helps make the plan workable.",
    lastVerified: "2026-08-31",
    metaDescription:
      "Parsley Clinical Lab Review pairs broad labs with a licensed clinician. Murph is a personal health assistant for visit preparation and follow-through, not medical care.",
    name: "Parsley Health",
    overview:
      "Parsley's live clinician is the meaningful difference here: the service interprets broad testing or eligible outside results in the context of symptoms, history, and lifestyle. Murph belongs before and after that encounter. It can help gather the timeline and questions that make limited visit time more useful, then keep recommendations, reminders, barriers, and follow-up questions from scattering again.",
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
      "Clinical Lab Review is self-pay, auto-renews annually unless canceled, and includes 14 days of follow-up messaging rather than open-ended care.",
      "New York and New Jersey use split payment and do not offer the at-home draw for this panel.",
      "Functional Age and Aging Velocity are model-based summaries rather than direct physiological measurements.",
      "Murph can support follow-through but cannot extend the licensed visit or replace Parsley's interpretation.",
    ],
    useTogether:
      "Use Parsley for testing and licensed clinical interpretation, then use Murph to remember the agreed plan, surface barriers, and prepare informed follow-up questions.",
  },
  {
    aliases: ["Wild Health Precision Medicine"],
    bestFor:
      "People seeking a genetics-informed functional medicine relationship with recurring physician visits, bloodwork, and health coaching.",
    bottomLine:
      "Choose Wild Health for a genetics-informed relationship with physicians, recurring labs, and coaching. Add Murph when you want the plan to remain present between those care interactions, alongside the questions, routines, and day-to-day context that shape whether it works. Murph cannot replace Wild Health's clinicians, testing, or prescriptions.",
    category: "labs-longevity",
    chooseCompetitor:
      "Choose Wild Health when licensed clinical care, genetics, quarterly labs, and regular coaching are the core requirements.",
    chooseMurph:
      "Choose Murph when you need a lower-friction, ongoing assistant around existing health context without enrolling in a high-touch clinical membership.",
    competitor: {
      clinicalRole:
        "A telehealth functional medicine service with licensed physicians and coaches. Genomic testing is explicitly not the same as genetic counseling.",
      followThrough:
        "Quarterly physician visits and bloodwork in Standard, ongoing coaching and messaging, and expanded testing and access in premium tiers.",
      format:
        "A clinical membership with Standard, Peak, and Elite service levels and a minimum commitment on the standard program.",
      hardware:
        "No proprietary device is required in Standard. Higher tiers can include a device and advanced diagnostics.",
      inputs:
        "Genetic data, health history, 65+ standard panel markers, repeat bloodwork, goals, two included biological age tests with Standard membership, and tier-specific specialty testing.",
      insightStyle:
        "A detailed genetics and lab report interpreted by a physician, with personalized nutrition, lifestyle, supplement, and treatment planning.",
      platforms:
        "Wild Health Clarity web and mobile experience with messaging and virtual visits.",
      pricing:
        "Standard starts at $362 per month. Peak is $25,000 per year, while Elite requires an inquiry. Testing and access vary by tier.",
      primaryJob:
        "Provide high-touch precision medicine and coaching informed by genetics and recurring clinical data.",
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
          "No. Murph cannot practice medicine, order Wild Health's clinical tests, or prescribe. It can complement care by helping someone prepare questions and follow a physician-approved plan.",
        question: "Can Murph replace Wild Health precision medicine?",
      },
      {
        answer:
          "No. Standard, Peak, and Elite include different levels of laboratory testing, physician access, coaching, devices, and specialty diagnostics. The highest-tier features should not be attributed to Standard.",
        question: "Does every Wild Health tier include the same tests?",
      },
      {
        answer:
          "No. Wild Health's terms distinguish genomic testing from genetic counseling. A qualified genetics professional is the appropriate source for counseling about inherited findings.",
        question: "Is Wild Health genetic testing the same as genetic counseling?",
      },
    ],
    headline: "Wild Health delivers precision medicine. Murph supports the day-to-day reality of the plan.",
    lastVerified: "2026-08-31",
    metaDescription:
      "Wild Health combines genetics, recurring labs, physicians, and coaching. Murph is a personal health assistant for carrying clinician-approved plans between care interactions.",
    name: "Wild Health",
    overview:
      "Wild Health combines services Murph deliberately does not provide: genetics, recurring bloodwork, licensed physician care, and coaching. Murph's value is continuity outside the scheduled program. It keeps clinician-approved actions beside the person's evolving context, helps surface friction while it is still actionable, and preserves useful questions for the next care interaction.",
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
      "Official commitment terms conflict: the current FAQ says four months for monthly plans, while the terms still say six months for Precision Care. Confirm the controlling term before checkout.",
      "The scope of testing, access, and devices changes substantially across tiers.",
      "Genetic associations and biological age estimates add context but are not direct diagnoses or guarantees about outcomes.",
      "Genetic testing, physician care, and prescribing are outside Murph's nonclinical role.",
    ],
    useTogether:
      "Use Wild Health for licensed care and testing, while Murph helps capture questions, remember instructions, support routines, and notice what needs discussion at the next visit.",
  },
  {
    aliases: ["Hone", "Hone Telehealth"],
    bestFor:
      "US adults specifically seeking hormone, metabolic, or longevity evaluation with a potential path to prescription treatment.",
    bottomLine:
      "Choose Hone when the job is hormone or metabolic evaluation with labs and possible clinician-prescribed treatment. Add Murph when you want a private place to organize symptoms, questions, instructions, routines, and follow-up around that care. Murph cannot replace Hone's licensed providers or prescriptions.",
    category: "labs-longevity",
    chooseCompetitor:
      "Choose Hone when symptoms, hormone evaluation, recurring labs, and possible clinician-prescribed treatment are the main needs.",
    chooseMurph:
      "Choose Murph when you want an ongoing private assistant for records, questions, habits, and follow-through around care you already have.",
    competitor: {
      clinicalRole:
        "A licensed telehealth clinic. Treatment and prescriptions depend on clinical evaluation, state licensure, eligibility, and the member's physical location during visits.",
      followThrough:
        "Lab reviews, clinician visits in eligible tiers, treatment monitoring, repeat testing, and prescription management when appropriate.",
      format:
        "A monthly telehealth membership with Basic, Plus, and Premium tiers that differ by sex, state, panel depth, and clinician access.",
      hardware:
        "Lab collection may use an at-home kit or a Quest lab order. No ongoing wearable is required.",
      inputs:
        "Blood tests, symptoms, medical history, health goals, and follow-up information used in telehealth care.",
      insightStyle:
        "Clinician interpretation and treatment-oriented recommendations rather than a general quantified-self dashboard.",
      platforms:
        "A mobile-friendly web account, not a downloadable app, for lab action items and results, virtual-consult scheduling, provider notes, medications, and billing.",
      pricing:
        "Basic costs $50 to start, comprising the first $25 membership month and a one-time $25 onboarding fee, then $25 per month. Plus and Premium cost more, and medications are extra.",
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
          "No. Murph cannot diagnose hormone conditions, order Hone treatment, or prescribe medication. It can help someone prepare for visits and follow the licensed provider's instructions.",
        question: "Can Murph replace Hone Health treatment?",
      },
      {
        answer:
          "No. Basic, Plus, and Premium have different lab panels, test cadence, clinician access, sex eligibility, and state coverage. Medications are billed separately in every tier.",
        question: "Do all Hone memberships include the same labs and care?",
      },
      {
        answer:
          "No. A licensed provider must review the person's history and results, determine whether treatment is appropriate, and follow state rules. Membership does not guarantee a prescription.",
        question: "Does joining Hone guarantee hormone medication?",
      },
    ],
    headline: "Hone evaluates and treats eligible patients. Murph helps people stay organized around care.",
    lastVerified: "2026-08-31",
    metaDescription:
      "Hone Health offers hormone and metabolic labs with telehealth care. Murph is a personal health assistant for organizing care, not determining treatment eligibility or prescribing.",
    name: "Hone Health",
    overview:
      "Hone Health is built for treatment-oriented telehealth, particularly around hormones, metabolism, and longevity. That makes its labs, clinician access, and treatment eligibility the reason to choose it. Murph is the continuity layer around the clinical relationship: a place to prepare a clear history, retain instructions, notice patterns or obstacles, and arrive at follow-up with better questions without presenting itself as a prescriber.",
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
      "Availability varies by state, tier, and sex, and the member must be in an eligible state during a visit.",
      "Medications are not included in the membership fee and treatment is not guaranteed.",
      "The narrow Plus panel and broader Basic or Premium panels serve different purposes and should not be treated as equivalent.",
      "Murph can organize care but cannot determine treatment eligibility or prescribe.",
    ],
    useTogether:
      "Use Hone for licensed testing and treatment decisions, then use Murph to organize questions, remember instructions, support routines, and prepare for follow-up.",
  },
  {
    aliases: ["Quest", "Quest Diagnostics", "Quest Elite Health Profile"],
    bestFor:
      "US consumers who want a broad one-time conventional laboratory panel from a national clinical laboratory without joining a recurring membership.",
    bottomLine:
      "Choose Quest Health when you need a conventional laboratory result from a large national network without joining a membership. Choose Murph when the result already exists and the harder question is what to remember, ask, schedule, or change next. Murph cannot replace the test or physician oversight.",
    category: "labs-longevity",
    chooseCompetitor:
      "Choose Quest Health when the immediate need is a one-off, self-purchased laboratory panel collected through a large national network.",
    chooseMurph:
      "Choose Murph when measurements already exist and the bigger need is to connect them with ongoing context, questions, plans, and reminders.",
    competitor: {
      clinicalRole:
        "A clinical laboratory service with independent provider ordering and result oversight. The ordering service is not a substitute for a full primary care relationship.",
      followThrough:
        "Online results, a Health Quotient summary, urgent-result outreach when required, and an option to discuss results with an independent provider.",
      format:
        "À-la-carte test purchase followed by in-person collection at a Quest Patient Service Center for most profiles.",
      hardware:
        "No consumer hardware. Blood, urine, and biometric collection occur through Quest facilities or a supported home kit where offered.",
      inputs:
        "The Elite Health Profile uses blood, urine, biometric measurements, and a health risk survey to report 85+ health indicators.",
      insightStyle:
        "Conventional reference-range results, a summary score, and optional discussion with an independent provider.",
      platforms:
        "Quest Health purchase flow and MyQuest results account.",
      pricing:
        "The Elite Health Profile list price is $399 plus an independent physician service fee that generally starts at $6. Promotions can temporarily lower the test price.",
      primaryJob:
        "Provide direct access to established laboratory testing without requiring a prior doctor visit.",
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
          "No. Murph does not collect samples or produce Quest laboratory results. Murph can help a person review the report, prepare questions, and manage clinician-recommended follow-up.",
        question: "Can Murph replace a Quest Health lab panel?",
      },
      {
        answer:
          "No. The purchase includes ordering oversight and access to discuss results, but it does not establish comprehensive ongoing primary care. A personal clinician remains important for diagnosis and treatment.",
        question: "Does Quest Health include a full doctor visit?",
      },
      {
        answer:
          "Quest currently says consumer tests are unavailable in Arizona, Hawaii, and Puerto Rico. Individual tests also have age, sex, and state eligibility rules.",
        question: "Is Quest Health available everywhere in the United States?",
      },
    ],
    headline: "Quest Health provides the lab result. Murph helps turn it into an organized next step.",
    lastVerified: "2026-08-31",
    metaDescription:
      "Quest Health provides direct-purchase laboratory testing through its national network. Murph is a personal health assistant for questions and next steps after results, not a lab.",
    name: "Quest Health",
    overview:
      "Quest Health is a straightforward answer to a measurement need: directly purchased conventional testing, with the Elite Health Profile adding biometrics and a survey in one transaction. Murph starts where that transaction ends. It can keep the report connected to the rest of a person's context, turn flagged items into clinician questions and appointments, and preserve the plan after the portal is closed.",
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
      "The service is a one-time testing purchase rather than an ongoing coaching or cross-source health platform.",
      "The physician service covers ordering and result oversight, not comprehensive longitudinal medical care.",
      "Arizona, Hawaii, and Puerto Rico are excluded from current Quest Health consumer testing.",
      "Murph cannot order, collect, or process Quest's laboratory tests.",
    ],
    useTogether:
      "Use Quest Health for the measurements, then bring the report and clinician-approved next steps to Murph for organization, reminders, and preparation for future care.",
  },
  {
    aliases: ["Labcorp", "Labcorp On Demand"],
    bestFor:
      "US consumers who want an affordable one-time conventional wellness panel and online results from a national laboratory.",
    bottomLine:
      "Choose Labcorp OnDemand when you need a specific conventional test and a familiar collection network. Choose Murph when you already have the report and want it connected with prior context, clearer clinician questions, and follow-through that lasts beyond the result notification. Murph is not a laboratory.",
    category: "labs-longevity",
    chooseCompetitor:
      "Choose Labcorp OnDemand when the goal is to buy a specific conventional test, visit a nearby collection center, and receive the result quickly.",
    chooseMurph:
      "Choose Murph when you already have records and want an ongoing assistant to help make them understandable and useful in daily decisions.",
    competitor: {
      clinicalRole:
        "A clinical laboratory service. Independent providers approve OnDemand orders, and certain urgent results trigger outreach, but the purchase is not comprehensive medical care.",
      followThrough:
        "Online results and urgent-result contact when needed. Advisor sessions require the separate Personal Wellness Program.",
      format:
        "One-time online test purchase followed by an in-person Labcorp collection for the Comprehensive Health Test.",
      hardware:
        "No consumer hardware. The Comprehensive Health Test uses a blood and urine sample collected at a Labcorp location.",
      inputs:
        "Conventional blood and urine measurements including CBC, metabolic, lipid, HbA1c, and urinalysis-related values.",
      insightStyle:
        "Laboratory results with trend tracking and AI-assisted explanations in MyLabcorp; Labcorp directs personalized interpretation to the ordering provider.",
      platforms:
        "Results are available through the Labcorp Patient web portal and MyLabcorp mobile app; MyLabcorp also manages appointments and billing.",
      pricing:
        "The Comprehensive Health Test is $169. Men's and Women's Health Tests are $219, with expanded panels priced separately.",
      primaryJob:
        "Offer direct access to conventional laboratory tests through Labcorp's national collection network.",
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
          "No. Murph cannot approve, collect, or process a Labcorp test. It can help a person organize the result, prepare clinician questions, and remember next steps.",
        question: "Can Murph replace Labcorp OnDemand testing?",
      },
      {
        answer:
          "No. The Comprehensive Health Test includes provider order approval and online results. MyLabcorp offers AI-assisted explanations and trend tracking, but not ongoing personalized coaching; advisor sessions are a separate product, and medical care remains with the person's clinician.",
        question: "Does the Labcorp OnDemand test include coaching?",
      },
      {
        answer:
          "The Comprehensive Health Test currently costs $169 and uses blood and urine collected in person. Sex-specific and expanded panels have different markers and higher prices.",
        question: "What does the Labcorp Comprehensive Health Test cost?",
      },
    ],
    headline: "Labcorp OnDemand answers a testing question. Murph helps manage what follows.",
    lastVerified: "2026-08-31",
    metaDescription:
      "Labcorp OnDemand offers one-time conventional tests through Labcorp collection sites. Murph is a personal health assistant for connecting reports to context and follow-through.",
    name: "Labcorp OnDemand",
    overview:
      "Labcorp OnDemand's advantage is access to familiar conventional testing without committing to a coaching program. Its Comprehensive Health Test is a one-time blood and urine panel; Murph provides the continuity the purchase does not aim to provide. It can connect the report with other records, keep questions ready for a clinician, and turn agreed next steps into reminders and routines.",
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
      "The test itself does not include ongoing coaching, wearable analysis, or cross-source longitudinal guidance.",
      "Independent provider approval is narrower than a full medical visit with a clinician who knows the person's history.",
      "The broadest expanded panels cost substantially more than the $169 Comprehensive Health Test.",
      "Murph cannot order the Labcorp panel or produce its blood and urine measurements.",
    ],
    useTogether:
      "Use Labcorp OnDemand for a needed measurement, then use Murph to keep the report, questions, appointments, and clinician-approved actions organized.",
  },
  {
    aliases: ["Bioniq Pro"],
    bestFor:
      "Consumers who specifically want a personalized supplement formula built from a recent blood panel and health questionnaire.",
    bottomLine:
      "Choose Bioniq PRO when the product you want is a lab-informed custom supplement formula with recurring delivery. Choose Murph when you want a broader health relationship that can remember the routine, questions, reactions, and clinician guidance without centering everything on supplements. Murph does not manufacture supplements or recommend them as treatment.",
    category: "labs-longevity",
    chooseCompetitor:
      "Choose Bioniq when the desired product is a custom supplement formula, nutritionist review, and app experience based on qualifying labs.",
    chooseMurph:
      "Choose Murph when you want broader ongoing help across health questions and plans without making supplement fulfillment the center of the relationship.",
    competitor: {
      clinicalRole:
        "A personalized nutrition and supplement service, not a general medical clinic. Its nutritionist consultation does not replace diagnosis or treatment by a licensed clinician.",
      followThrough:
        "A three-month supplement supply, one nutritionist consultation, app recommendations, and optional retesting to update the next formula.",
      format:
        "A rolling three-month supplement subscription with monthly billing and quarterly shipments, or a nonrenewing starter package.",
      hardware:
        "The PRO workflow uses a laboratory report rather than sensor hardware; Bioniq can arrange a blood test in supported locations.",
      inputs:
        "A recent blood-test report or a Bioniq-arranged blood test where available, plus the app health questionnaire and required laboratory markers.",
      insightStyle:
        "Lab analysis focused on nutrient status and a personalized supplement recipe with nutrition guidance.",
      platforms:
        "Bioniq mobile app for the health questionnaire, laboratory-report upload, analyzed results, formula details, and nutritional recommendations. PRO cancellation or freeze requests are handled by email rather than in the app.",
      pricing:
        "Pricing was not publicly verifiable on August 30, 2026. Bioniq documents a rolling three-month subscription billed monthly and shipped quarterly, plus a nonrenewing three-month starter package in supported countries; confirm current availability and price directly.",
      primaryJob:
        "Create and deliver a personalized daily supplement formula informed by blood data.",
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
          "No. Murph does not formulate, manufacture, or ship personalized supplements. It can help someone keep track of what a clinician or nutrition professional has recommended and notice questions to raise.",
        question: "Can Murph replace Bioniq PRO supplements?",
      },
      {
        answer:
          "The supplement plan and initial blood-test or upload-processing option are separate parts of onboarding. Repeat testing is optional and is not included with every quarterly shipment; confirm current testing and plan charges directly.",
        question: "Is blood testing included in the Bioniq monthly price?",
      },
      {
        answer:
          "No. Bioniq PRO is a nutrition and supplement service. Its app analysis and nutritionist consultation should not be treated as diagnosis, prescription care, or a replacement for a medical clinician.",
        question: "Is Bioniq PRO medical treatment?",
      },
    ],
    headline: "Bioniq personalizes supplements. Murph supports the wider health context.",
    lastVerified: "2026-08-31",
    metaDescription:
      "Bioniq PRO turns a qualifying blood report into a custom supplement formula. Murph is a personal health assistant for broader context, not a supplement maker or clinician.",
    name: "Bioniq",
    overview:
      "Bioniq PRO is purpose-built around one outcome: turning a qualifying blood report and questionnaire into a personalized formula delivered every three months. That focus is a strength if supplements are the goal. Murph is broader and product-neutral; it can keep the routine beside other records and priorities, capture questions or reactions, and support a clinician-informed decision about what changes next.",
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
      "The service is centered on supplements rather than broad clinical evaluation or independent longitudinal coaching.",
      "The subscription has a three-month minimum and ships the full quarter at once while billing monthly.",
      "Testing availability and marker lists vary by country, and the US partner draw is not available in New York or New Jersey.",
      "Murph does not formulate, manufacture, or deliver Bioniq's personalized supplements.",
    ],
    useTogether:
      "Use Bioniq for its formula and nutritionist review, then use Murph to track the routine, record questions or reactions, and coordinate any clinician-approved changes.",
  },
  {
    aliases: ["Neko", "Neko Scan"],
    bestFor:
      "Adults near a Neko clinic who want a one-hour, multimodal preventive snapshot and an immediate clinician conversation.",
    bottomLine:
      "Choose Neko Health for its roughly one-hour in-person scan, selected lab markers, and immediate clinician discussion. Add Murph when you want to prepare a sharper history beforehand and keep referrals, questions, and the action plan moving afterward. Murph is neither a scanner nor a clinic.",
    category: "labs-longevity",
    chooseCompetitor:
      "Choose Neko when you want an in-person scan of skin, heart, circulation, body composition, and selected blood markers in one visit.",
    chooseMurph:
      "Choose Murph when the need is ongoing private support across health records and plans rather than a location-bound annual scan.",
    competitor: {
      clinicalRole:
        "An in-person preventive assessment with clinician review. Neko says its clinic is not a full-service medical practice and members should maintain their ordinary clinicians.",
      followThrough:
        "A same-visit consultation, action plan, and included specialist review or referral support when a finding warrants it.",
      format:
        "A roughly one-hour appointment at a Neko Health center, commonly positioned as an annual scan.",
      hardware:
        "Neko's center-based sensor system captures skin imagery, cardiovascular signals, circulation, body composition, grip strength, and other measurements without ionizing radiation.",
      inputs:
        "Thousands of sensor images, ECG and cardiovascular measures, circulation, body composition, grip strength, and selected blood markers such as lipids and HbA1c.",
      insightStyle:
        "A clinician-guided preventive snapshot with an action plan and follow-up pathways for notable findings.",
      platforms:
        "Neko app plus a required physical clinic visit, with advertised Apple Health and wearable syncing.",
      pricing:
        "£299 in the United Kingdom and SEK 2,750 in Sweden. The announced US price is $499, with the first New York clinic opening September 24, 2026.",
      primaryJob:
        "Collect many noninvasive physical measurements in one visit and review them with a clinician immediately.",
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
          "No. Murph has no scanning hardware, does not collect Neko's physical measurements, and cannot perform the clinician consultation. It can support preparation and follow-through around the visit.",
        question: "Can Murph replace a Neko Health Scan?",
      },
      {
        answer:
          "No. Neko uses a purpose-built sensor system plus selected blood tests. It is not a whole-body MRI and does not replace every guideline-recommended cancer screening or diagnostic test.",
        question: "Is the Neko Health Scan a whole-body MRI?",
      },
      {
        answer:
          "Not yet on the verification date. Neko's first US clinic in New York is scheduled to open September 24, 2026, so the US offering remains pre-opening as of August 30.",
        question: "Is Neko Health currently open in the United States?",
      },
    ],
    headline: "Neko captures a physical snapshot. Murph helps keep the story coherent afterward.",
    lastVerified: "2026-08-31",
    metaDescription:
      "Neko Health provides an in-person sensor scan, selected labs, and clinician review. Murph is a personal health assistant for preparation and follow-through, not a clinic.",
    name: "Neko Health",
    overview:
      "Neko Health compresses a physical snapshot and clinician discussion into a focused in-person visit; Murph cannot reproduce that sensor system. Murph's advantage appears across the longer timeline: assembling context before the scan, retaining what the clinician said, preparing for an outside referral, and keeping practical next steps visible after the visit.",
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
      "The service requires travel to a limited set of physical centers and is not yet live in the United States on the verification date.",
      "It is an annual-style snapshot rather than continuous measurement or open-ended care.",
      "Incidental or abnormal findings can require further testing with an outside specialist or primary clinician.",
      "Murph cannot reproduce Neko's in-person sensors or clinician consultation.",
    ],
    useTogether:
      "Use Neko for the physical assessment and clinician review, then use Murph to remember the action plan, prepare referrals or appointments, and track practical next steps.",
  },
  {
    aliases: ["Fountain", "Fountain Life CORE", "Fountain Life APEX"],
    bestFor:
      "High-budget US consumers who want an annual center-based program combining advanced imaging, broad labs, genetics, and a dedicated care team.",
    bottomLine:
      "Choose Fountain Life when an extensive, center-based diagnostic workup and dedicated care team justify the price and travel. Add Murph when you want the findings, questions, appointments, and clinician-approved plan to stay coherent once you leave the center. Murph cannot replace Fountain Life's imaging, physicians, or procedures.",
    category: "labs-longevity",
    chooseCompetitor:
      "Choose Fountain Life when extensive annual imaging and diagnostics with a care team justify the high price and travel requirement.",
    chooseMurph:
      "Choose Murph when you need a broadly useful private assistant for health context and action without buying a premium diagnostic center membership.",
    competitor: {
      clinicalRole:
        "A preventive diagnostics and longevity care membership with physicians and care teams at physical US centers.",
      followThrough:
        "Physician review, a personalized plan, ongoing monitoring, care team access, and optional additional diagnostics or therapies.",
      format:
        "An annual center-based membership offered in CORE, APEX, and family configurations.",
      hardware:
        "Center-based MRI, CT, DEXA, ECG, cardiovascular imaging, and other diagnostic equipment, depending on tier and location.",
      inputs:
        "Tier-specific imaging, 100+ labs, cardiovascular tests, body composition, genetics, and other advanced diagnostics.",
      insightStyle:
        "A physician and care team synthesize multimodal data into a preventive plan, supported by the Zori AI experience.",
      platforms:
        "Fountain Life member app and Zori AI, paired with required visits to a Fountain Life center.",
      pricing:
        "CORE is currently $10,500 and APEX is $21,500. APEX Family and some services require an inquiry or separate purchase.",
      primaryJob:
        "Deliver an extensive annual preventive workup across imaging, laboratory, and genetic modalities.",
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
          "No. Murph does not provide medical imaging, laboratory testing, physician care, or advanced therapies. It can complement the program by supporting preparation and follow-through.",
        question: "Can Murph replace Fountain Life diagnostics?",
      },
      {
        answer:
          "No. CORE and APEX include different subsets of imaging, labs, genetics, and care services. A diagnostic listed on the general membership page should not be assumed to be included in every tier.",
        question: "Does every Fountain Life membership include every diagnostic?",
      },
      {
        answer:
          "Fountain provides clinical review, but some separately offered restorative biologic services are described by Fountain as not FDA approved. Those services should be evaluated separately from standard labs and imaging.",
        question: "Are all Fountain Life services standard approved screening?",
      },
    ],
    headline: "Fountain Life builds a premium diagnostic workup. Murph helps with the life around it.",
    lastVerified: "2026-08-31",
    metaDescription:
      "Fountain Life delivers center-based imaging, labs, genetics, and physician review. Murph is a personal health assistant for coordinating the resulting care plan, not a diagnostic provider.",
    name: "Fountain Life",
    overview:
      "Fountain Life's premium price buys a concentrated workup Murph does not offer: advanced imaging, laboratory work, genetics, and clinician review through physical centers. After that workup, Murph can keep the resulting documents and decisions connected, help coordinate follow-up, and make a clinician-approved care plan easier to carry between annual visits.",
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
      "Membership prices are far above lab-only and software-only alternatives.",
      "The experience depends on travel to a limited set of physical US centers.",
      "Included diagnostics vary by tier, and separately offered therapies can have different evidence and regulatory status.",
      "Imaging, laboratory work, physician care, and procedures remain outside Murph's role.",
    ],
    useTogether:
      "Use Fountain Life for its clinical workup, then use Murph to prepare questions, retain the care plan, coordinate follow-up, and support clinician-approved routines.",
  },
  {
    aliases: ["Prenuvo Whole Body MRI", "Prenuvo Scan"],
    bestFor:
      "Adults who prioritize preventive MRI and can travel to a supported imaging center, with optional annual labs and provider review.",
    bottomLine:
      "Choose Prenuvo when the core need is preventive MRI and you accept the cost, travel, and possibility of further workup. Add Murph when you want to prepare for the scan, retain the reviewed findings, and coordinate questions and next steps afterward. Murph has no scanner or diagnostic role.",
    category: "labs-longevity",
    chooseCompetitor:
      "Choose Prenuvo when a focused or whole-body MRI is the core need and the cost, travel, and possible follow-up are acceptable.",
    chooseMurph:
      "Choose Murph when you want continuous private support across health context rather than a periodic imaging event.",
    competitor: {
      clinicalRole:
        "A preventive medical imaging service with radiology review and provider result consultations. It describes whole-body MRI as an adjunct to established screening, not a replacement.",
      followThrough:
        "Radiology reporting, provider result review, longitudinal imaging comparison, and repeat labs in selected annual memberships.",
      format:
        "A standalone scan or annual Core, Comprehensive, or Executive membership at a physical imaging location.",
      hardware:
        "MRI scanners, plus body composition and advanced brain or heart imaging in eligible higher tiers and locations.",
      inputs:
        "Focused or whole-body MRI, tier-specific blood panels, and optional advanced brain, heart, and body composition imaging.",
      insightStyle:
        "Board-certified radiology findings, longitudinal image comparison, blood trends in memberships, and provider review.",
      platforms:
        "Digital results and member platform paired with in-person imaging centers in the United States and Canada.",
      pricing:
        "Core is $1,199 per year, Comprehensive $2,499, and Executive starts at $3,999. A standalone whole-body MRI is $2,499 and a focused scan is $1,199.",
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
          "No. Murph has no imaging hardware and cannot interpret scans as a radiologist. It can help someone prepare for the appointment and manage questions or follow-up after the clinical review.",
        question: "Can Murph replace a Prenuvo MRI?",
      },
      {
        answer:
          "No. Prenuvo states that whole-body MRI is an adjunct and does not replace established screening such as mammography, colonoscopy, cervical screening, or clinically indicated imaging.",
        question: "Does a Prenuvo scan replace standard cancer screening?",
      },
      {
        answer:
          "No. The standalone scan includes imaging and a one-time results process. Blood panels, repeat labs, and broader ongoing review belong to specific annual membership tiers.",
        question: "Are blood tests included with every Prenuvo scan?",
      },
    ],
    headline: "Prenuvo images the body. Murph helps organize the decisions that follow.",
    lastVerified: "2026-08-31",
    metaDescription:
      "Prenuvo provides preventive MRI with radiology review and optional membership labs. Murph is a personal health assistant for preparation and follow-up, not an imaging service.",
    name: "Prenuvo",
    overview:
      "Prenuvo's value is structural medical information from preventive MRI, with some annual memberships adding blood panels and provider review. Murph cannot generate or interpret those images. It can make the episode more useful by helping you arrive with organized context, preserve the reviewed findings, prepare specialist questions, and keep clinician-approved follow-up from becoming another scattered list.",
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
      "Every option requires travel to a supported imaging location and costs substantially more than a software service.",
      "Whole-body MRI can surface incidental findings that require additional clinical workup.",
      "Blood panels and repeated provider reviews are membership features, not part of every standalone scan.",
      "Murph cannot acquire or interpret MRI images.",
    ],
    useTogether:
      "Use Prenuvo for imaging and clinical review, then use Murph to retain the plan, prepare specialist questions, coordinate appointments, and support agreed health actions.",
  },
  {
    aliases: ["TruAge", "TruDiagnostic TruAge", "TruHealth"],
    bestFor:
      "Adults specifically interested in blood DNA methylation clocks, organ-system age estimates, and repeated epigenetic testing.",
    bottomLine:
      "Choose TruDiagnostic when you specifically want a blood DNA-methylation assay and its proprietary aging estimates. Choose Murph when you want to keep that specialized report in proportion to conventional records, real goals, and a plan you can revisit over time. Murph cannot reproduce the assay or clocks.",
    category: "labs-longevity",
    chooseCompetitor:
      "Choose TruDiagnostic when the main question is how a blood-based methylation clock describes biological aging and change across repeat tests.",
    chooseMurph:
      "Choose Murph when you need broader longitudinal support across records, goals, questions, and habits rather than a specialized epigenetic report.",
    competitor: {
      clinicalRole:
        "A research, informational, and educational epigenetic testing service. TruDiagnostic says its reports do not independently diagnose, prevent, or treat disease.",
      followThrough:
        "A secure report, personalized recommendations, and optional repeat testing every few months, without included ongoing clinical care.",
      format:
        "A one-time or subscription at-home finger-prick blood test mailed to a laboratory for DNA methylation analysis.",
      hardware:
        "A disposable finger-prick collection kit. No ongoing device is required.",
      inputs:
        "A dried blood spot used to analyze more than one million DNA methylation sites, plus registration and self-reported information.",
      insightStyle:
        "Overall biological age, pace of aging, 11 organ-system age estimates, and epigenetically inferred health-related outputs.",
      platforms:
        "Secure web results portal for TruAge and TruHealth reports.",
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
          "No. Murph cannot process DNA methylation or calculate TruDiagnostic's proprietary clocks. It can help someone understand the report's scope and prepare questions for a qualified clinician.",
        question: "Can Murph calculate a TruAge result?",
      },
      {
        answer:
          "No. Values such as organ age, telomere length, and some inflammation or health outputs are inferred from methylation models. They are not the same as directly measuring serum LDL, glucose, or an organ's chronological age.",
        question: "Are all TruDiagnostic outputs direct measurements?",
      },
      {
        answer:
          "No. TruDiagnostic's terms describe the service as research, informational, and educational. Results should be interpreted with medical history and conventional clinical information by a qualified professional.",
        question: "Does TruAge diagnose disease?",
      },
    ],
    headline: "TruDiagnostic estimates biological aging. Murph helps keep the result in context.",
    lastVerified: "2026-08-31",
    metaDescription:
      "TruDiagnostic estimates biological age from blood DNA methylation. Murph is a personal health assistant for context, not performing the assay or calculating its clocks.",
    name: "TruDiagnostic",
    overview:
      "TruDiagnostic does one specialized job Murph does not: it analyzes a mailed blood sample and applies methylation models to produce aging and health-related estimates. Murph adds breadth and continuity. It can keep the model outputs beside conventional results, surface the questions worth taking to a qualified clinician, and help assess whether chosen actions are realistic without treating an estimate as a diagnosis.",
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
      "The $499 test is specialized around methylation and does not replace conventional labs or medical evaluation.",
      "Many report values are model-based estimates, so they cannot be compared directly with measured blood chemistry.",
      "Ongoing clinical interpretation or coaching is not included in the consumer test price.",
      "Murph cannot process DNA methylation or reproduce TruDiagnostic's proprietary clocks.",
    ],
    useTogether:
      "Use TruDiagnostic for the methylation assay, then use Murph to document questions, connect the report with other records, and support actions agreed with a qualified clinician.",
  },
  {
    aliases: ["Tally", "TallyAge"],
    bestFor:
      "US adults who want a simple cheek-swab epigenetic age estimate paired with a lifestyle plan and recurring longevity supplements.",
    bottomLine:
      "Choose Tally Health when you want a simple cheek-swab age estimate paired with retesting and a supplement program. Choose Murph when you want a broader, product-neutral relationship that connects habits, records, goals, and questions without making one age score the center of your health. Murph does not run the assay or supply supplements.",
    category: "labs-longevity",
    chooseCompetitor:
      "Choose Tally Health when a noninvasive aging score, twice-yearly retesting, and a bundled daily supplement are the desired product.",
    chooseMurph:
      "Choose Murph when you want an ongoing assistant across many health questions and sources without centering the relationship on one age score or supplement subscription.",
    competitor: {
      clinicalRole:
        "A wellness testing and supplement service. Tally says its reports, advice, and products are not medical advice or disease treatment.",
      followThrough:
        "A personalized lifestyle action plan, digital check-ins, a repeat TallyAge test every six months, and monthly supplement delivery for members.",
      format:
        "A monthly membership or a one-time at-home cheek-swab test.",
      hardware:
        "A disposable cheek-swab collection kit. No ongoing device is required.",
      inputs:
        "Cheek-cell DNA methylation and a lifestyle survey covering diet, exercise, sleep, mental health, and habits.",
      insightStyle:
        "A single TallyAge estimate and personalized lifestyle recommendations rather than conventional laboratory values.",
      platforms:
        "Tally Health digital platform for the age result, action plan, and membership management.",
      pricing:
        "$129 per month for membership, including a TallyAge test every six months and a daily Vitality supplement. A one-time TallyAge test is $249.",
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
          "No. Murph cannot analyze cheek-cell methylation or produce Tally's proprietary age result. It can help someone think through the result and maintain context around chosen habits.",
        question: "Can Murph calculate a TallyAge score?",
      },
      {
        answer:
          "No. TallyAge is a model-based estimate from cheek-cell DNA methylation and survey context. It is not a directly measured whole-body age, diagnosis, or equivalent to a blood-based clock.",
        question: "Is TallyAge a direct measurement of biological age?",
      },
      {
        answer:
          "No. A single TallyAge test costs $249. The $129 monthly membership adds testing every six months, an action plan, check-ins, and daily supplement delivery.",
        question: "Do I need a Tally Health membership to take the test?",
      },
    ],
    headline: "Tally Health centers on an age estimate. Murph centers on the ongoing relationship.",
    lastVerified: "2026-08-31",
    metaDescription:
      "Tally Health pairs a cheek-swab epigenetic age estimate with guidance and supplements. Murph is a personal health assistant for context, not performing the assay or supplying products.",
    name: "Tally Health",
    overview:
      "Tally Health turns a noninvasive cheek-cell methylation test into a clear consumer program: an age estimate, lifestyle guidance, retesting, and optional recurring supplements. Murph does not reproduce that score. Its case is breadth and memory: the ability to keep the estimate beside other records and priorities, turn selected habits into realistic actions, and revisit what actually changed rather than optimizing around one model output.",
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
      "The membership is expensive if the primary interest is only the twice-yearly cheek-swab test.",
      "TallyAge is a model-specific estimate and cannot be directly compared with blood chemistry or another tissue's clock.",
      "The service bundles supplements but does not provide licensed ongoing medical care or conventional laboratory testing.",
      "Murph cannot run the cheek-swab assay, calculate TallyAge, or supply the bundled supplements.",
    ],
    useTogether:
      "Use Tally for its cheek-swab result and program, then use Murph to keep the chosen lifestyle changes realistic, record questions, and connect the experience with other health context.",
  },
] as const);
