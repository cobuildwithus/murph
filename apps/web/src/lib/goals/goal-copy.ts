export function toReaderFacingGoalPhrase(goalPhrase: string): string {
  return goalPhrase
    .trim()
    .replace(/\bmy\b/giu, (match) => match[0] === "M" ? "Your" : "your")
    .replace(/\bi\b/giu, "you");
}
