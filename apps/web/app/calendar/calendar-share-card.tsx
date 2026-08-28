import { MurphHeroOg } from "../_og/murph-hero-og";

export const CALENDAR_OG_ALT =
  "Add to Calendar. Review the event details before anything is added.";

export function CalendarShareCard({ logoDataUri }: { logoDataUri: string }) {
  return (
    <MurphHeroOg
      eyebrow="Calendar invite"
      headline={"Add to\nCalendar."}
      headlineFontSize={92}
      logoDataUri={logoDataUri}
      subtext="Review the details. Apple Calendar confirms the rest."
      subtextFontSize={28}
    />
  );
}
