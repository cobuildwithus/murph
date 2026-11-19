/** US states, DC and Canadian provinces and territories, by the name Mapbox gives them, to their postal codes. */
const CODES: Record<string, string> = {
  Alabama: 'AL', Alaska: 'AK', Arizona: 'AZ', Arkansas: 'AR', California: 'CA', Colorado: 'CO', Connecticut: 'CT',
  Delaware: 'DE', 'District of Columbia': 'DC', Florida: 'FL', Georgia: 'GA', Hawaii: 'HI', Idaho: 'ID', Illinois: 'IL',
  Indiana: 'IN', Iowa: 'IA', Kansas: 'KS', Kentucky: 'KY', Louisiana: 'LA', Maine: 'ME', Maryland: 'MD', Massachusetts: 'MA',
  Michigan: 'MI', Minnesota: 'MN', Mississippi: 'MS', Missouri: 'MO', Montana: 'MT', Nebraska: 'NE', Nevada: 'NV',
  'New Hampshire': 'NH', 'New Jersey': 'NJ', 'New Mexico': 'NM', 'New York': 'NY', 'North Carolina': 'NC',
  'North Dakota': 'ND', Ohio: 'OH', Oklahoma: 'OK', Oregon: 'OR', Pennsylvania: 'PA', 'Rhode Island': 'RI',
  'South Carolina': 'SC', 'South Dakota': 'SD', Tennessee: 'TN', Texas: 'TX', Utah: 'UT', Vermont: 'VT', Virginia: 'VA',
  Washington: 'WA', 'West Virginia': 'WV', Wisconsin: 'WI', Wyoming: 'WY',
  Alberta: 'AB', 'British Columbia': 'BC', Manitoba: 'MB', 'New Brunswick': 'NB', 'Newfoundland and Labrador': 'NL',
  'Northwest Territories': 'NT', 'Nova Scotia': 'NS', Nunavut: 'NU', Ontario: 'ON', 'Prince Edward Island': 'PE',
  Quebec: 'QC', Québec: 'QC', Saskatchewan: 'SK', Yukon: 'YT',
};
const STATE_COUNTRIES = new Set(['United States', 'Canada']);

/**
 * Where a town is, from its stored Mapbox label ("Newark, Delaware, United States"): in the US and Canada its state
 * or province and that one's code ("DE"), elsewhere its country and no code. A label without a country says nothing.
 */
export function placeRegion(label: string | undefined): { region: string | null; regionCode: string | null } {
  const parts = label?.split(', ').map(part => part.trim()).filter(Boolean) ?? [];
  if (parts.length < 2) return { region: null, regionCode: null };
  const country = parts.at(-1)!;
  if (!STATE_COUNTRIES.has(country)) return { region: country, regionCode: null };
  const state = parts.length >= 3 ? parts.at(-2)! : null;
  return state ? { region: state, regionCode: CODES[state] ?? null } : { region: country, regionCode: null };
}
