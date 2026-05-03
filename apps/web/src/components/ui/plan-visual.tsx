export type PlanTier = "free" | "pulse" | "edge";

export function PlanVisual({ tier }: { tier: PlanTier }) {
  if (tier === "free") {
    return (
      <svg width="22" height="22" viewBox="0 0 30 30" fill="none" aria-hidden>
        <circle cx="5" cy="5" r="2" fill="#b5c4a1" fillOpacity={0.3} />
        <circle cx="15" cy="5" r="2" fill="#b5c4a1" fillOpacity={0.3} />
        <circle cx="25" cy="5" r="2" fill="#b5c4a1" fillOpacity={0.3} />
        <circle cx="5" cy="15" r="2" fill="#b5c4a1" fillOpacity={0.3} />
        <circle cx="15" cy="15" r="2.5" fill="#c4956a" fillOpacity={0.55} />
        <circle cx="25" cy="15" r="2" fill="#b5c4a1" fillOpacity={0.3} />
        <circle cx="5" cy="25" r="2" fill="#b5c4a1" fillOpacity={0.3} />
        <circle cx="15" cy="25" r="2" fill="#b5c4a1" fillOpacity={0.3} />
        <circle cx="25" cy="25" r="2" fill="#b5c4a1" fillOpacity={0.3} />
      </svg>
    );
  }

  if (tier === "pulse") {
    return (
      <svg width="28" height="28" viewBox="0 0 40 40" fill="none" aria-hidden>
        <circle cx="5" cy="5" r="2" fill="#b5c4a1" fillOpacity={0.3} />
        <circle cx="15" cy="5" r="2" fill="#b5c4a1" fillOpacity={0.3} />
        <circle cx="25" cy="5" r="2" fill="#b5c4a1" fillOpacity={0.3} />
        <circle cx="35" cy="5" r="2" fill="#b5c4a1" fillOpacity={0.3} />
        <circle cx="5" cy="15" r="2" fill="#b5c4a1" fillOpacity={0.3} />
        <circle cx="15" cy="15" r="2.5" fill="#c4956a" fillOpacity={0.55} />
        <circle cx="25" cy="15" r="2.5" fill="#c4956a" fillOpacity={0.55} />
        <circle cx="35" cy="15" r="2" fill="#b5c4a1" fillOpacity={0.3} />
        <circle cx="5" cy="25" r="2" fill="#b5c4a1" fillOpacity={0.3} />
        <circle cx="15" cy="25" r="2.5" fill="#c4956a" fillOpacity={0.55} />
        <circle cx="25" cy="25" r="2.5" fill="#c4956a" fillOpacity={0.55} />
        <circle cx="35" cy="25" r="2" fill="#b5c4a1" fillOpacity={0.3} />
        <circle cx="5" cy="35" r="2" fill="#b5c4a1" fillOpacity={0.3} />
        <circle cx="15" cy="35" r="2" fill="#b5c4a1" fillOpacity={0.3} />
        <circle cx="25" cy="35" r="2" fill="#b5c4a1" fillOpacity={0.3} />
        <circle cx="35" cy="35" r="2" fill="#b5c4a1" fillOpacity={0.3} />
      </svg>
    );
  }

  return (
    <svg width="34" height="28" viewBox="0 0 65 44" fill="none" aria-hidden>
      <circle cx="6.5" cy="5.5" r="2" fill="#b5c4a1" fillOpacity={0.3} />
      <circle cx="16.5" cy="5.5" r="2" fill="#b5c4a1" fillOpacity={0.3} />
      <circle cx="27" cy="5.5" r="2.5" fill="#c4956a" fillOpacity={0.55} />
      <circle cx="38" cy="5.5" r="2.5" fill="#c4956a" fillOpacity={0.55} />
      <circle cx="48.5" cy="5.5" r="2" fill="#b5c4a1" fillOpacity={0.3} />
      <circle cx="58.5" cy="5.5" r="2" fill="#b5c4a1" fillOpacity={0.3} />
      <circle cx="4.5" cy="15.5" r="2" fill="#b5c4a1" fillOpacity={0.3} />
      <circle cx="14.5" cy="15.5" r="2" fill="#b5c4a1" fillOpacity={0.3} />
      <circle cx="26" cy="15.5" r="3.5" fill="#a07a4e" />
      <circle cx="39" cy="15.5" r="3.5" fill="#a07a4e" />
      <circle cx="50.5" cy="15.5" r="2" fill="#b5c4a1" fillOpacity={0.3} />
      <circle cx="60.5" cy="15.5" r="2" fill="#b5c4a1" fillOpacity={0.3} />
      <circle cx="2" cy="27.5" r="2" fill="#b5c4a1" fillOpacity={0.3} />
      <circle cx="12.5" cy="27.5" r="2.5" fill="#c4956a" fillOpacity={0.55} />
      <circle cx="25" cy="27.5" r="4" fill="#8b6840" />
      <circle cx="39.5" cy="27.5" r="4.5" fill="#8b6840" />
      <circle cx="52.5" cy="27.5" r="2.5" fill="#c4956a" fillOpacity={0.55} />
      <circle cx="63" cy="27.5" r="2" fill="#b5c4a1" fillOpacity={0.3} />
      <circle cx="6.5" cy="38.5" r="2" fill="#b5c4a1" fillOpacity={0.3} />
      <circle cx="16.5" cy="38.5" r="2" fill="#b5c4a1" fillOpacity={0.3} />
      <circle cx="27" cy="38.5" r="2.5" fill="#c4956a" fillOpacity={0.55} />
      <circle cx="38" cy="38.5" r="2.5" fill="#c4956a" fillOpacity={0.55} />
      <circle cx="48.5" cy="38.5" r="2" fill="#b5c4a1" fillOpacity={0.3} />
      <circle cx="58.5" cy="38.5" r="2" fill="#b5c4a1" fillOpacity={0.3} />
    </svg>
  );
}
