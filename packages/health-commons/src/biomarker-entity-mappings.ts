/**
 * Explicit aliases from private metric biomarker identities to authored
 * Health Commons entities. These mappings preserve stable metric keys while
 * preventing duplicate Commons pages for the same analyte.
 */
export const HEALTH_COMMONS_BIOMARKER_ENTITY_MAPPINGS = {
  "biomarker:alt": "biomarker:alanine-aminotransferase",
  "biomarker:apob": "biomarker:apolipoprotein-b",
  "biomarker:ast": "biomarker:aspartate-aminotransferase",
  "biomarker:creatinine": "biomarker:serum-creatinine",
  "biomarker:total-bilirubin": "biomarker:bilirubin",
  "biomarker:vitamin-d": "biomarker:serum-25-hydroxyvitamin-d",
} as const satisfies Readonly<Record<string, string>>;

export function resolveHealthCommonsBiomarkerEntityKey(biomarkerKey: string): string {
  let current = biomarkerKey.trim().toLowerCase();
  const visited = new Set<string>();

  while (!visited.has(current)) {
    visited.add(current);
    const mapped = HEALTH_COMMONS_BIOMARKER_ENTITY_MAPPINGS[
      current as keyof typeof HEALTH_COMMONS_BIOMARKER_ENTITY_MAPPINGS
    ];
    if (!mapped) {
      return current;
    }
    current = mapped;
  }

  throw new Error(`Health Commons biomarker entity mapping cycle detected at ${current}`);
}
