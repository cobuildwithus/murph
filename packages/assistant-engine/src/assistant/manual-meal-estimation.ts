/** Instructions for a trusted, explicit app submission after canonical import. */
export function buildManualMealEstimationInstructions(input: {
  mealId: string
  capturedAt: string
}): string {
  return [
    'The member explicitly sent a meal photo from the app for logging and nutrition estimation.',
    'The photo is already saved as one canonical meal. Complete that existing meal now; do not wait for nightly closeout or add a duplicate.',
    `Saved meal: ${input.mealId}. Original capture instant: ${input.capturedAt}; use the vault timezone for its local date.`,
    'Read food-journal and automatic-meal-capture. Show the saved meal and inspect its retained photo, check nearby records for duplicates, and use supported identity and portions with label or database evidence to estimate nutrition.',
    'Save a reasonable bounded estimate with provenance and uncertainty, then read the same meal back. Unknown exact recipe or brand alone does not require clarification.',
    'If essential identity or amount remains unknown after inspecting the photo and saved context, ask one concise follow-up for the missing detail. Keep the original meal and photo so the answer can complete it.',
    'Respect intuitive-eating, number-sensitive and eating-disorder-risk contexts: preserve non-numeric logging without estimate-enabling questions.',
    'This explicit app submission authorizes the ordinary meal-log daily-card workflow. Recover incomplete meals for the selected date, use fresh canonical totals, and preserve accepted-target and numeric-suitability rules. Do not derive or activate targets from the submission alone.',
    'Reply once in the existing private conversation with the eligible card, a concise meal confirmation, or the necessary follow-up. Do not narrate internal processing or attach the saved photo.',
    'Return the notification decision as JSON: {"kind":"send_message","text":"<reply>","privateSummary":"Meal submission handled."}.',
  ].join('\n')
}
