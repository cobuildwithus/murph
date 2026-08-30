import { defineComparisons } from "../types";

export const LABS_LONGEVITY_COMPARISONS = defineComparisons([
  {
    aliases: ["Function"],
    bestFor:
      "US adults who want a broad laboratory baseline, a second testing point later in the year, and optional imaging in one account.",
    bottomLine:
      "Function Health generates laboratory measurements and optional scan results. Murph is the ongoing private assistant that can help someone understand records, prepare questions, and follow through, but it does not order or perform those tests.",
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
    lastVerified: "2026-08-30",
    metaDescription:
      "Compare Murph with Function Health on annual labs, follow-up testing, imaging, clinician review, pricing, and ongoing health support.",
    name: "Function Health",
    overview:
      "Function Health sells a broad annual lab membership built around partner laboratory visits, clinician reviewed results, and optional imaging. Murph has a different job: it maintains a private, conversation-first relationship around the records and plans a person chooses to bring in. Function is the measurement service; Murph is the context and follow-through layer.",
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
      "Superpower starts with an annual blood test and builds a protocol around the result. Murph does not provide testing or a treatment marketplace; it focuses on an ongoing private relationship and practical follow-through across the health context a member authorizes.",
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
    lastVerified: "2026-08-30",
    metaDescription:
      "Compare Murph with Superpower on annual biomarker testing, AI protocols, wearable data, care team access, add-ons, and pricing.",
    name: "Superpower",
    overview:
      "Superpower packages a broad annual blood draw with scores, an AI protocol, wearable syncing, care team messaging, and access to additional products. Murph does not compete with the laboratory event. It is designed for the periods between events, when remembered context, decisions, reminders, and realistic next actions determine whether a plan fits daily life.",
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
    ],
    useTogether:
      "Use Superpower to obtain the annual panel and its reviewed protocol, then use Murph to keep relevant tasks, questions, habits, and follow-up timing in one continuing conversation.",
  },
  {
    aliases: ["Inside Tracker"],
    bestFor:
      "Performance-oriented users who want to combine blood results with fitness trackers, sleep data, and optional DNA information.",
    bottomLine:
      "InsideTracker is a structured analytics product for blood, DNA, and wearable signals. Murph is broader and conversation-first, but it neither supplies InsideTracker's blood draw nor calculates the same proprietary scores.",
    category: "labs-longevity",
    chooseCompetitor:
      "Choose InsideTracker when performance analytics, supported wearable integrations, and a structured biomarker action plan are the main job.",
    chooseMurph:
      "Choose Murph when you want a private assistant to connect health questions and plans beyond a performance dashboard and help with follow-through over time.",
    competitor: {
      clinicalRole:
        "A wellness analytics service that says its results and recommendations are not medical advice, diagnosis, or treatment.",
      followThrough:
        "Personalized recommendations, an action plan, trend tracking, and suggested retesting, without included ongoing clinical care or human coaching.",
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
    lastVerified: "2026-08-30",
    metaDescription:
      "Compare Murph with InsideTracker on blood testing, wearables, DNA, InnerAge, action plans, platform access, and current membership pricing.",
    name: "InsideTracker",
    overview:
      "InsideTracker is designed around quantified performance and healthspan analytics. It combines supported blood markers, DNA, and tracker data into scores and recommendations. Murph can work with a wider range of conversational context and ongoing tasks, but it is not a substitute for the test, the dashboard, or a clinician.",
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
    ],
    tradeoffs: [
      "The lowest-priced membership does not include an InsideTracker blood draw.",
      "InnerAge and DNA analysis depend on the purchased package and should not be assumed to be included.",
      "Outside lab uploads only produce analytics for supported markers, not every value in the original report.",
    ],
    useTogether:
      "Use InsideTracker for its supported lab and performance analytics, then bring the useful findings into Murph to plan habits, remember context, and review what changed.",
  },
  {
    aliases: ["SiPhox", "SiPhox Core"],
    bestFor:
      "People who prefer collecting repeat blood samples at home and want a modular panel with wearable and outside-lab context.",
    bottomLine:
      "SiPhox Health is the at-home measurement service. Murph does not collect or analyze the sample, but it can help someone make sense of the resulting plan and follow it between test cycles.",
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
        "A disposable EasyDraw upper-arm collection device is used for mailed samples. No ongoing wearable is required.",
      inputs:
        "At-home blood samples, health information, supported outside labs, supplements, and compatible wearable or CGM data.",
      insightStyle:
        "Panel-based biomarker trends and a personalized action plan, with depth determined by the base panel and selected upgrades.",
      platforms:
        "Digital dashboard with integrations that include Oura, Apple Health, Fitbit, Eight Sleep, Dexcom, FreeStyle CGMs, and Google Fit.",
      pricing:
        "The first Core cycle is currently $124 delivered, then $149 per cycle including listed shipping. Ultimate 360 is currently $274 one time; upgrades and coaching cost more.",
      primaryJob:
        "Make repeat laboratory testing possible from home and show changes across test cycles.",
    },
    faqs: [
      {
        answer:
          "No. Murph is not a laboratory and cannot replace the EasyDraw collection, assay processing, or SiPhox report. It can support planning and follow-through after the results arrive.",
        question: "Can Murph do the SiPhox at-home blood test?",
      },
      {
        answer:
          "No. The base Core program starts with a smaller included panel, while additional markers and programs require upgrades. SiPhox pages also vary in how they count calculated and measured outputs.",
        question: "Are all SiPhox biomarkers included in the base price?",
      },
      {
        answer:
          "Most SiPhox services are wellness testing. Some named programs offer care through independent clinicians, with availability determined by state and program eligibility.",
        question: "Does SiPhox Health provide medical care?",
      },
    ],
    headline: "SiPhox brings repeat lab collection home. Murph supports what happens next.",
    lastVerified: "2026-08-30",
    metaDescription:
      "Compare Murph with SiPhox Health on at-home blood collection, test cadence, biomarkers, wearable integrations, coaching, pricing, and care boundaries.",
    name: "SiPhox Health",
    overview:
      "SiPhox Health focuses on convenient repeat blood testing through an upper-arm collection kit, modular panels, and a longitudinal dashboard. Murph is not a competing sample collection or diagnostic service. It can complement the measurements by keeping the person's questions, chosen actions, reminders, and other relevant context together.",
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
    ],
    tradeoffs: [
      "Base and upgraded panels include different markers, so the highest advertised count is not the base program.",
      "New York and Hawaii are excluded from current services, and telehealth has additional state limits.",
      "Shipping, upgrades, specialty panels, coaching, and clinical programs can raise the total beyond the headline cycle price.",
    ],
    useTogether:
      "Use SiPhox for repeat measurements, then bring the reviewed result and selected actions into Murph for practical routines, reminders, and questions to take to a clinician.",
  },
  {
    aliases: ["Lifeforce Health"],
    bestFor:
      "US adults seeking repeat labs, clinician consultations, health coaching, and possible prescription treatment in one longevity program.",
    bottomLine:
      "Lifeforce can provide licensed clinical services through independent practices. Murph cannot replace those clinicians or tests; it can help a person organize the resulting plan and stay engaged with it between appointments.",
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
    lastVerified: "2026-08-30",
    metaDescription:
      "Compare Murph with Lifeforce on recurring labs, clinician care, health coaching, prescriptions, LifeScore, membership tiers, and costs.",
    name: "Lifeforce",
    overview:
      "Lifeforce is closer to a telehealth longevity clinic than a simple dashboard. Depending on the tier, it includes repeat labs, clinician consultations, coaching, and access to eligible treatments. Murph occupies a separate nonclinical role, helping a person keep questions, instructions, routines, and day-to-day follow-through connected.",
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
    ],
    useTogether:
      "Use Lifeforce for its measurements and licensed care, while using Murph to prepare questions, remember clinician instructions, schedule practical tasks, and notice barriers to the plan.",
  },
  {
    aliases: ["Mito", "Mito Core"],
    bestFor:
      "US consumers who want flexible pay-as-you-go testing, member-priced panels, a longitudinal record, and clinician reviewed wellness guidance.",
    bottomLine:
      "Mito Health is a testing marketplace and result-review platform. Murph does not order or run Mito tests; it provides a broader ongoing conversation around the records and actions a person chooses to carry forward.",
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
    lastVerified: "2026-08-30",
    metaDescription:
      "Compare Murph with Mito Health on pay-as-you-go labs, the $9 membership, clinician review, AI concierge support, panel pricing, and result tracking.",
    name: "Mito Health",
    overview:
      "Mito Health recently shifted from a bundled annual panel toward a low-cost membership and separately priced test marketplace. Members receive lower test prices, a longitudinal record, clinician reviewed action plans, and concierge support. Murph does not replace any ordered test or review; it offers a continuing assistant relationship that can span records, goals, routines, and future health questions.",
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
    ],
    useTogether:
      "Use Mito to order the appropriate test and obtain its reviewed action plan, then use Murph to carry selected next steps, reminders, and questions into everyday life.",
  },
  {
    aliases: ["Parsley", "Parsley Clinical Lab Review"],
    bestFor:
      "People who want a board-certified functional medicine clinician to interpret broad labs in the context of symptoms, history, and lifestyle.",
    bottomLine:
      "Parsley Clinical Lab Review is a licensed clinical encounter. Murph is not a clinician and should not replace or overrule that interpretation; it can support preparation and follow-through around the care plan.",
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
        "A one-time virtual Clinical Lab Review using Parsley's 80+ biomarker panel or qualifying outside labs from the prior six months.",
      hardware:
        "No proprietary device. The panel uses Quest collection or optional at-home phlebotomy where available.",
      inputs:
        "Blood results, symptoms, medical history, lifestyle information, and outside records reviewed during a clinical visit.",
      insightStyle:
        "Clinician interpretation plus a Functional Health Score, Functional Age estimate, Aging Velocity estimate, and personalized recommendations.",
      platforms:
        "HIPAA-compliant patient portal, virtual visits, and secure care team messaging.",
      pricing:
        "$550 for the Advanced Lab Panel plus visit, or $250 to bring recent outside labs. Complete Care is a separate membership with insurance and self-pay rules.",
      primaryJob:
        "Explain broad blood results in clinical context and define appropriate medical and lifestyle next steps.",
    },
    faqs: [
      {
        answer:
          "No. Parsley's visit is with a licensed clinician, while Murph does not diagnose or treat. Murph can help prepare questions and follow a plan but should not substitute for the visit.",
        question: "Can Murph replace a Parsley Clinical Lab Review?",
      },
      {
        answer:
          "Clinical Lab Review is self-pay at $550 with Parsley's panel or $250 with recent eligible outside labs. Complete Care is a different program with membership fees, medical billing, copays, and deductibles.",
        question: "Is Parsley Clinical Lab Review covered by the Complete Care price?",
      },
      {
        answer:
          "No. They are clinician-informed model outputs derived from lab data and trends. They are useful summaries, not directly measured ages or diagnoses.",
        question: "Are Parsley's Functional Age and Aging Velocity direct measurements?",
      },
    ],
    headline: "Parsley provides clinical interpretation. Murph helps make the plan workable.",
    lastVerified: "2026-08-30",
    metaDescription:
      "Compare Murph with Parsley Health on its Clinical Lab Review, 80+ biomarker panel, functional age estimates, clinician care, and pricing.",
    name: "Parsley Health",
    overview:
      "Parsley Health's Clinical Lab Review pairs broad blood testing or recent outside results with a live functional medicine clinician. That makes it a care service, not merely a data dashboard. Murph has a nonclinical role: helping a person gather context before the visit and carry the resulting recommendations, reminders, and questions forward afterward.",
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
    ],
    tradeoffs: [
      "Clinical Lab Review is self-pay and includes a limited messaging window rather than open-ended care.",
      "New York and New Jersey use split payment and do not offer the at-home draw for this panel.",
      "Functional Age and Aging Velocity are model-based summaries rather than direct physiological measurements.",
    ],
    useTogether:
      "Use Parsley for testing and licensed clinical interpretation, then use Murph to remember the agreed plan, surface barriers, and prepare informed follow-up questions.",
  },
  {
    aliases: ["Wild Health Precision Medicine"],
    bestFor:
      "People seeking a genetics-informed functional medicine relationship with recurring physician visits, bloodwork, and health coaching.",
    bottomLine:
      "Wild Health is a clinical precision medicine program. Murph cannot replace its physicians, genetic testing, or prescriptions; it can help a member work with the plan between care interactions.",
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
        "Genetic data, health history, 65+ standard panel markers, repeat bloodwork, goals, and optional biological age or specialty testing.",
      insightStyle:
        "A detailed genetics and lab report interpreted by a physician, with personalized nutrition, lifestyle, supplement, and treatment planning.",
      platforms:
        "Wild Health Clarity web and mobile experience with messaging and virtual visits.",
      pricing:
        "Standard starts at $362 per month. Peak is $25,000 per year, while Elite requires an inquiry. Testing and access vary by tier.",
      primaryJob:
        "Provide high-touch precision medicine and coaching informed by genetics and recurring clinical data.",
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
    lastVerified: "2026-08-30",
    metaDescription:
      "Compare Murph with Wild Health on genetics, quarterly bloodwork, physician care, coaching, biological age testing, tiers, and pricing.",
    name: "Wild Health",
    overview:
      "Wild Health combines genetics, recurring bloodwork, licensed physician care, and coaching in a functional precision medicine membership. Murph is neither a clinic nor a genetics service. Its role is to help a person keep relevant context accessible and make clinician-approved actions more practical between visits.",
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
    ],
    tradeoffs: [
      "Official commitment terms conflict: the current FAQ says four months for monthly plans, while the terms still say six months for Precision Care. Confirm the controlling term before checkout.",
      "The scope of testing, access, and devices changes substantially across tiers.",
      "Genetic associations and biological age estimates add context but are not direct diagnoses or guarantees about outcomes.",
    ],
    useTogether:
      "Use Wild Health for licensed care and testing, while Murph helps capture questions, remember instructions, support routines, and notice what needs discussion at the next visit.",
  },
  {
    aliases: ["Hone", "Hone Telehealth"],
    bestFor:
      "US adults specifically seeking hormone, metabolic, or longevity evaluation with a potential path to prescription treatment.",
    bottomLine:
      "Hone is a telehealth clinic with testing and treatment eligibility. Murph cannot replace its licensed providers or prescriptions; Murph is better framed as support around the care relationship.",
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
        "No proprietary hardware. Testing uses Quest and other approved collection workflows.",
      inputs:
        "Blood tests, symptoms, medical history, health goals, and follow-up information used in telehealth care.",
      insightStyle:
        "Clinician interpretation and treatment-oriented recommendations rather than a general quantified-self dashboard.",
      platforms:
        "Hone website and member app with laboratory scheduling and telehealth visits.",
      pricing:
        "Basic costs $50 to start, comprising the first $25 membership month and a one-time $25 onboarding fee, then $25 per month. Plus and Premium cost more, and medications are extra.",
      primaryJob:
        "Evaluate hormone and metabolic concerns and manage eligible telehealth treatment over time.",
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
    lastVerified: "2026-08-30",
    metaDescription:
      "Compare Murph with Hone Health on hormone labs, telehealth clinicians, prescriptions, state availability, Basic, Plus, and Premium pricing.",
    name: "Hone Health",
    overview:
      "Hone Health is built for treatment-oriented telehealth, particularly around hormones, metabolism, and longevity. Its tiers combine different laboratory panels and levels of clinician access, with medications charged separately. Murph does not occupy that clinical role. It can support the person before and between visits without presenting itself as a prescriber or medical authority.",
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
    ],
    tradeoffs: [
      "Availability varies by state, tier, and sex, and the member must be in an eligible state during a visit.",
      "Medications are not included in the membership fee and treatment is not guaranteed.",
      "The narrow Plus panel and broader Basic or Premium panels serve different purposes and should not be treated as equivalent.",
    ],
    useTogether:
      "Use Hone for licensed testing and treatment decisions, then use Murph to organize questions, remember instructions, support routines, and prepare for follow-up.",
  },
  {
    aliases: ["Quest", "Quest Diagnostics", "Quest Elite Health Profile"],
    bestFor:
      "US consumers who want a broad one-time conventional laboratory panel from a national clinical laboratory without joining a recurring membership.",
    bottomLine:
      "Quest Health sells and processes laboratory tests. Murph cannot replace the test or physician oversight; it can help someone organize the result and decide what questions or follow-up tasks to take to their clinician.",
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
    lastVerified: "2026-08-30",
    metaDescription:
      "Compare Murph with Quest Health on the Elite Health Profile, 85+ indicators, physician oversight, national collection, pricing, and follow-up.",
    name: "Quest Health",
    overview:
      "Quest Health makes conventional laboratory testing available for direct consumer purchase. Its Elite Health Profile combines lab measurements, biometrics, and a survey in a one-time purchase rather than a coaching membership. Murph has no laboratory role, but it can help a person keep the report connected to questions, appointments, and everyday follow-through.",
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
    ],
    useTogether:
      "Use Quest Health for the measurements, then bring the report and clinician-approved next steps to Murph for organization, reminders, and preparation for future care.",
  },
  {
    aliases: ["Labcorp", "Labcorp On Demand"],
    bestFor:
      "US consumers who want an affordable one-time conventional wellness panel and online results from a national laboratory.",
    bottomLine:
      "Labcorp OnDemand is a laboratory purchase and results service. Murph is not a lab and cannot substitute for it; Murph can help connect the report with questions, plans, and later follow-through.",
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
        "Clinical laboratory results with reference ranges in a patient account rather than a broad AI coaching protocol.",
      platforms:
        "Labcorp Patient web and mobile account for scheduling and results.",
      pricing:
        "The Comprehensive Health Test is $169. Men's and Women's Health Tests are $219, with expanded panels priced separately.",
      primaryJob:
        "Offer direct access to conventional laboratory tests through Labcorp's national collection network.",
    },
    faqs: [
      {
        answer:
          "No. Murph cannot approve, collect, or process a Labcorp test. It can help a person organize the result, prepare clinician questions, and remember next steps.",
        question: "Can Murph replace Labcorp OnDemand testing?",
      },
      {
        answer:
          "No. The Comprehensive Health Test includes provider order approval and online results, but ongoing advising is a separate product and medical care remains with the person's clinician.",
        question: "Does the Labcorp OnDemand test include coaching?",
      },
      {
        answer:
          "The Comprehensive Health Test currently costs $169 and uses blood and urine collected in person. Sex-specific and expanded panels have different markers and higher prices.",
        question: "What does the Labcorp Comprehensive Health Test cost?",
      },
    ],
    headline: "Labcorp OnDemand answers a testing question. Murph helps manage what follows.",
    lastVerified: "2026-08-30",
    metaDescription:
      "Compare Murph with Labcorp OnDemand on the $169 Comprehensive Health Test, collection, provider approval, result access, and ongoing support.",
    name: "Labcorp OnDemand",
    overview:
      "Labcorp OnDemand offers direct purchase of conventional tests through a familiar national laboratory network. Its Comprehensive Health Test is a one-time blood and urine panel, not a longitudinal health coaching membership. Murph cannot generate the measurements, but it can help someone keep the resulting information and follow-up actions connected over time.",
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
    ],
    tradeoffs: [
      "The test itself does not include ongoing coaching, wearable analysis, or cross-source longitudinal guidance.",
      "Independent provider approval is narrower than a full medical visit with a clinician who knows the person's history.",
      "The broadest expanded panels cost substantially more than the $169 Comprehensive Health Test.",
    ],
    useTogether:
      "Use Labcorp OnDemand for a needed measurement, then use Murph to keep the report, questions, appointments, and clinician-approved actions organized.",
  },
  {
    aliases: ["Bioniq Pro"],
    bestFor:
      "Consumers who specifically want a personalized supplement formula built from a recent blood panel and health questionnaire.",
    bottomLine:
      "Bioniq PRO is a lab-informed supplement subscription. Murph does not manufacture supplements or recommend them as treatment; it can help a person track questions, routines, and clinician guidance around what they choose to take.",
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
        "No proprietary device. Members use a partner blood draw or upload a qualifying recent report.",
      inputs:
        "A 50+ parameter partner panel or required recent laboratory values, plus lifestyle, symptom, body, and goal information in the app.",
      insightStyle:
        "Lab analysis focused on nutrient status and a personalized supplement recipe with nutrition guidance.",
      platforms:
        "Bioniq mobile app for laboratory upload, formula details, recommendations, and subscription management.",
      pricing:
        "Official prices conflict. Transactional checkout lists $199 monthly with a 90-day commitment or $750 one time, while another official page still shows $149 monthly and $699 or $600 packages. Confirm the live checkout price.",
      primaryJob:
        "Create and deliver a personalized daily supplement formula informed by blood data.",
    },
    faqs: [
      {
        answer:
          "No. Murph does not formulate, manufacture, or ship personalized supplements. It can help someone keep track of what a clinician or nutrition professional has recommended and notice questions to raise.",
        question: "Can Murph replace Bioniq PRO supplements?",
      },
      {
        answer:
          "No. The formula subscription is separate from the initial partner blood test or outside-lab processing credit. Repeat blood testing is optional and not included every three months.",
        question: "Is blood testing included in the Bioniq monthly price?",
      },
      {
        answer:
          "No. Bioniq PRO is a nutrition and supplement service. Its app analysis and nutritionist consultation should not be treated as diagnosis, prescription care, or a replacement for a medical clinician.",
        question: "Is Bioniq PRO medical treatment?",
      },
    ],
    headline: "Bioniq personalizes supplements. Murph supports the wider health context.",
    lastVerified: "2026-08-30",
    metaDescription:
      "Compare Murph with Bioniq PRO on blood-informed supplements, app analysis, nutritionist support, testing options, subscriptions, and pricing.",
    name: "Bioniq",
    overview:
      "Bioniq PRO uses a qualifying blood report and questionnaire to create a personalized supplement formula delivered every three months. The laboratory analysis is in service of that product, not a broad medical dashboard. Murph can complement the routine by helping someone remember relevant context and discuss changes, but it does not prescribe or sell supplements.",
    relationship: "different-role",
    slug: "bioniq",
    sources: [
      {
        label: "Bioniq PRO blood testing and program details",
        url: "https://www.bioniq.com/products/pro/bloodtest-us",
      },
      {
        label: "Bioniq PRO current package pricing",
        url: "https://www.bioniq.com/products/pro-upd",
      },
      {
        label: "Bioniq PRO transactional checkout",
        url: "https://www.bioniq.com/cart/pro/select-plan",
      },
      {
        label: "Bioniq US test and upload pricing",
        url: "https://www.bioniq.com/cart/pro/choose-option?country_code=US",
      },
    ],
    tradeoffs: [
      "The service is centered on supplements rather than broad clinical evaluation or independent longitudinal coaching.",
      "The subscription has a three-month minimum and ships the full quarter at once while billing monthly.",
      "Testing availability and marker lists vary by country, and the US partner draw is not available in New York or New Jersey.",
    ],
    useTogether:
      "Use Bioniq for its formula and nutritionist review, then use Murph to track the routine, record questions or reactions, and coordinate any clinician-approved changes.",
  },
  {
    aliases: ["Neko", "Neko Scan"],
    bestFor:
      "Adults near a Neko clinic who want a one-hour, multimodal preventive snapshot and an immediate clinician conversation.",
    bottomLine:
      "Neko Health operates physical scanners and limited lab testing. Murph is neither a scanner nor a clinic; it can help a person prepare, retain context, and follow up after the visit.",
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
        "£299 in the United Kingdom and 2,750 SEK in Sweden. The announced US price is $499, with the first New York clinic opening September 24, 2026.",
      primaryJob:
        "Collect many noninvasive physical measurements in one visit and review them with a clinician immediately.",
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
    lastVerified: "2026-08-30",
    metaDescription:
      "Compare Murph with Neko Health on its one-hour scan, heart and skin measurements, blood tests, clinician review, locations, and pricing.",
    name: "Neko Health",
    overview:
      "Neko Health is an in-person preventive scan built around proprietary sensors, selected laboratory markers, and an immediate clinician discussion. Its value depends on access to a physical center. Murph serves a separate ongoing role and cannot reproduce any scan, but it can help someone prepare questions and carry the resulting plan into later conversations and routines.",
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
    ],
    tradeoffs: [
      "The service requires travel to a limited set of physical centers and is not yet live in the United States on the verification date.",
      "It is an annual-style snapshot rather than continuous measurement or open-ended care.",
      "Incidental or abnormal findings can require further testing with an outside specialist or primary clinician.",
    ],
    useTogether:
      "Use Neko for the physical assessment and clinician review, then use Murph to remember the action plan, prepare referrals or appointments, and track practical next steps.",
  },
  {
    aliases: ["Fountain", "Fountain Life CORE", "Fountain Life APEX"],
    bestFor:
      "High-budget US consumers who want an annual center-based program combining advanced imaging, broad labs, genetics, and a dedicated care team.",
    bottomLine:
      "Fountain Life is a premium diagnostics and clinical membership. Murph cannot replace its imaging, physicians, or procedures; it can support a member's understanding and follow-through outside the center.",
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
    lastVerified: "2026-08-30",
    metaDescription:
      "Compare Murph with Fountain Life on CORE and APEX imaging, 100+ labs, genetics, physician review, physical locations, and current prices.",
    name: "Fountain Life",
    overview:
      "Fountain Life combines advanced imaging, laboratory work, genetics, and clinician review in a high-cost annual membership delivered through physical centers. Murph is not an alternative source for those tests or treatments. Its useful role is helping a person keep the resulting information, questions, and practical plan connected after the intensive visit.",
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
    ],
    useTogether:
      "Use Fountain Life for its clinical workup, then use Murph to prepare questions, retain the care plan, coordinate follow-up, and support clinician-approved routines.",
  },
  {
    aliases: ["Prenuvo Whole Body MRI", "Prenuvo Scan"],
    bestFor:
      "Adults who prioritize preventive MRI and can travel to a supported imaging center, with optional annual labs and provider review.",
    bottomLine:
      "Prenuvo provides medical imaging and, in memberships, blood panels and provider review. Murph has no scanner or diagnostic role; it can help a person prepare and manage follow-up around the findings.",
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
    lastVerified: "2026-08-30",
    metaDescription:
      "Compare Murph with Prenuvo on whole-body MRI, focused scans, annual labs, provider review, membership tiers, screening limits, and pricing.",
    name: "Prenuvo",
    overview:
      "Prenuvo centers its service on preventive MRI, with newer annual memberships adding blood panels, repeat testing, and provider review. It generates structural medical information that Murph cannot reproduce. Murph can complement the episode by helping a person prepare, retain the reviewed findings, and coordinate the next clinician-approved steps.",
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
    ],
    useTogether:
      "Use Prenuvo for imaging and clinical review, then use Murph to retain the plan, prepare specialist questions, coordinate appointments, and support agreed health actions.",
  },
  {
    aliases: ["TruAge", "TruDiagnostic TruAge", "TruHealth"],
    bestFor:
      "Adults specifically interested in blood DNA methylation clocks, organ-system age estimates, and repeated epigenetic testing.",
    bottomLine:
      "TruDiagnostic measures DNA methylation and calculates model-based age and health estimates. Murph cannot reproduce the assay or clocks; it can help put the report in context and support carefully chosen next steps.",
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
    lastVerified: "2026-08-30",
    metaDescription:
      "Compare Murph with TruDiagnostic on TruAge, DNA methylation, organ age estimates, pace of aging, at-home testing, limitations, and pricing.",
    name: "TruDiagnostic",
    overview:
      "TruDiagnostic's TruAge and TruHealth products use a mailed finger-prick sample to analyze DNA methylation and generate aging and health-related estimates. These outputs are not interchangeable with conventional laboratory measurements or diagnoses. Murph cannot generate the report, but it can help a person understand its limits and incorporate clinician-approved actions into a broader plan.",
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
    ],
    useTogether:
      "Use TruDiagnostic for the methylation assay, then use Murph to document questions, connect the report with other records, and support actions agreed with a qualified clinician.",
  },
  {
    aliases: ["Tally", "TallyAge"],
    bestFor:
      "US adults who want a simple cheek-swab epigenetic age estimate paired with a lifestyle plan and recurring longevity supplements.",
    bottomLine:
      "Tally Health sells an epigenetic age estimate and supplement program. Murph does not run the cheek-swab assay or supply supplements; it offers broader ongoing support around a person's chosen health context.",
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
    lastVerified: "2026-08-30",
    metaDescription:
      "Compare Murph with Tally Health on TallyAge cheek-swab testing, epigenetic estimates, lifestyle plans, supplements, membership, and pricing.",
    name: "Tally Health",
    overview:
      "Tally Health uses cheek-cell DNA methylation to calculate a proprietary age estimate, then pairs that result with lifestyle guidance and supplements. It is narrower than a conventional lab panel and is not medical care. Murph cannot reproduce the test, but it can provide a broader continuing conversation around habits, records, goals, and questions.",
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
    ],
    useTogether:
      "Use Tally for its cheek-swab result and program, then use Murph to keep the chosen lifestyle changes realistic, record questions, and connect the experience with other health context.",
  },
] as const);
