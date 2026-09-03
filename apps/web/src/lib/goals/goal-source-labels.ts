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
  [/(^|\.)nih\.gov$/u, "NIH"],
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
  [/^(www\.)?fda\.gov$/u, "FDA"],
  [/^(www\.)?usms\.org$/u, "U.S. Masters Swimming"],
  [/^(www\.)?nps\.gov$/u, "National Park Service"],
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
