/** Shared with food-labels.test.ts; provider failure coverage stays there. */
export function foodLabelResponse(items: readonly unknown[]): Response {
  return new Response(JSON.stringify({ items }), {
    headers: { 'content-type': 'application/json; charset=utf-8' },
    status: 200,
  })
}

export const syntheticOats = {
  id: 'synthetic-oats', dataOrigin: 'usda_generic', dataOriginId: 'synthetic-oats',
  name: 'Synthetic oats', brand: null, upc: null, offMarket: false,
}
