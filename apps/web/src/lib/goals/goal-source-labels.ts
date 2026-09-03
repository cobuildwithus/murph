const GOAL_SOURCE_PUBLISHERS: readonly (readonly [RegExp, string])[] = [
  [/^pubmed\.ncbi\.nlm\.nih\.gov$/u, "PubMed"],
  [/^pmc\.ncbi\.nlm\.nih\.gov$/u, "PubMed Central"],
  [/^(www\.)?who\.int$/u, "World Health Organization"],
  [/^(www\.)?cdc\.gov$/u, "CDC"],
  [/^(www\.)?acog\.org$/u, "ACOG"],
  [/^(odphp\.|www\.)?health\.gov$/u, "HHS"],
  [/^(www\.)?hhs\.gov$/u, "HHS"],
  [/^(www\.)?womenshealth\.gov$/u, "Office on Women's Health"],
  [/^(www\.)?niddk\.nih\.gov$/u, "NIDDK"],
  [/^(www\.)?nhlbi\.nih\.gov$/u, "NHLBI"],
  [/^(www\.)?niams\.nih\.gov$/u, "NIAMS"],
  [/^(www\.)?nccih\.nih\.gov$/u, "NCCIH"],
  [/^(www\.)?nia\.nih\.gov$/u, "National Institute on Aging"],
  [/^(www\.)?nida\.nih\.gov$/u, "NIDA"],
  [/^(www\.)?nidcr\.nih\.gov$/u, "NIDCR"],
  [/^ods\.od\.nih\.gov$/u, "NIH Office of Dietary Supplements"],
  [/^rethinkingdrinking\.niaaa\.nih\.gov$/u, "NIAAA"],
  [/^jcsm\.aasm\.org$/u, "Journal of Clinical Sleep Medicine"],
  [/^(www\.)?aasm\.org$/u, "AASM"],
  [/^(www\.)?doi\.org$/u, "Journal article"],
  [/^(www\.)?acsm\.org$/u, "ACSM"],
  [/^(www\.)?diabetesjournals\.org$/u, "American Diabetes Association"],
  [/^(www\.)?nice\.org\.uk$/u, "NICE"],
  [/^(www\.)?worldathletics\.org$/u, "World Athletics"],
  [/^healthquality\.va\.gov$/u, "VA/DoD"],
  [/^bjsm\.bmj\.com$/u, "BJSM"],
  [/(^|\.)bmj\.com$/u, "BMJ"],
  [/^(www\.|professional\.)?heart\.org$/u, "American Heart Association"],
  [/^(www\.)?ahajournals\.org$/u, "AHA Journals"],
  [/(^|\.)fda\.gov$/u, "FDA"],
  [/^(www\.)?usms\.org$/u, "U.S. Masters Swimming"],
  [/(^|\.)nps\.gov$/u, "National Park Service"],
  [/(^|\.)nhs\.uk$/u, "NHS"],
  [/^(www\.)?uspreventiveservicestaskforce\.org$/u, "USPSTF"],
  [/^(www\.)?usacycling\.org$/u, "USA Cycling"],
  [/^(www\.)?apa\.org$/u, "American Psychological Association"],
  [/^(www\.)?rheumatology\.org$/u, "American College of Rheumatology"],
  [/^(www\.)?menopause\.org$/u, "The Menopause Society"],
  [/(^|\.)triathlon\.org$/u, "World Triathlon"],
  [/^(www\.)?thelancet\.com$/u, "The Lancet"],
  [/^(www\.)?nejm\.org$/u, "NEJM"],
  [/^jamanetwork\.com$/u, "JAMA"],
  [/(^|\.)cochranelibrary\.com$/u, "Cochrane"],
  [/(^|\.)mayoclinic\.org$/u, "Mayo Clinic"],
  [/(^|\.)aasld\.org$/u, "AASLD"],
  [/(^|\.)foodsafety\.gov$/u, "FoodSafety.gov"],
  [/(^|\.)concept2\.com$/u, "Concept2"],
  [/(^|\.)cancer\.gov$/u, "National Cancer Institute"],
  [/(^|\.)auanet\.org$/u, "American Urological Association"],
  [/(^|\.)asrm\.org$/u, "ASRM"],
  [/(^|\.)nationalacademies\.org$/u, "National Academies"],
  [/(^|\.)medlineplus\.gov$/u, "MedlinePlus"],
  [/(^|\.)kdigo\.org$/u, "KDIGO"],
  [/(^|\.)britishrowing\.org$/u, "British Rowing"],
  [/(^|\.)gastro\.org$/u, "American Gastroenterological Association"],
  [/(^|\.)worldgastroenterology\.org$/u, "World Gastroenterology Organisation"],
  [/(^|\.)usatriathlon\.org$/u, "USA Triathlon"],
  [/(^|\.)tsa\.gov$/u, "TSA"],
  [/^ptsd\.va\.gov$/u, "VA National Center for PTSD"],
  [/(^|\.)va\.gov$/u, "VA"],
  [/(^|\.)orthopt\.org$/u, "Academy of Orthopaedic Physical Therapy"],
  [/(^|\.)ninds\.nih\.gov$/u, "NINDS"],
  [/(^|\.)nimh\.nih\.gov$/u, "NIMH"],
  [/(^|\.)niaaa\.nih\.gov$/u, "NIAAA"],
  [/(^|\.)myplate\.gov$/u, "MyPlate"],
  [/(^|\.)kidney\.org$/u, "National Kidney Foundation"],
  [/(^|\.)jospt\.org$/u, "JOSPT"],
  [/(^|\.)usda\.gov$/u, "USDA"],
  [/(^|\.)epa\.gov$/u, "EPA"],
  [/(^|\.)endocrine\.org$/u, "Endocrine Society"],
  [/(^|\.)bonehealthandosteoporosis\.org$/u, "Bone Health and Osteoporosis Foundation"],
  [/(^|\.)ais\.gov\.au$/u, "Australian Institute of Sport"],
  [/(^|\.)acc\.org$/u, "American College of Cardiology"],
  [/(^|\.)aaos\.org$/u, "AAOS"],
  [/(^|\.)hrsa\.gov$/u, "HRSA"],
  [/(^|\.)springer\.com$/u, "Springer"],
  [/(^|\.)fifa\.com$/u, "FIFA"],
  [/(^|\.)diabetes\.org$/u, "American Diabetes Association"],
  [/(^|\.)csepguidelines\.ca$/u, "CSEP"],
  [/(^|\.)aaafoundation\.org$/u, "AAA Foundation"],
  [/(^|\.)988lifeline\.org$/u, "988 Lifeline"],
  // Generic NIH catch-all stays last so institute-specific labels win.
  [/(^|\.)nih\.gov$/u, "NIH"],
];

/**
 * A short publisher label for a source URL, or the bare hostname when the
 * publisher is not in the known list. Never throws on a malformed URL.
 */
export function describeGoalSourcePublisher(url: string): string {
  let hostname: string;
  try {
    hostname = new URL(url).hostname.toLowerCase();
  } catch {
    return url;
  }

  for (const [pattern, label] of GOAL_SOURCE_PUBLISHERS) {
    if (pattern.test(hostname)) {
      return label;
    }
  }

  return hostname.replace(/^www\./u, "");
}
