export const IMESSAGE_CARD_COLOR = {
  balloon: "#FFF5E6",
  badge: "#FCFAF5",
  badgeBorder: "rgba(20,18,23,0.08)",
  badgeMark: "rgba(186,130,74,0.55)",
  primary: "#141217",
  secondary: "#666163",
  divider: "rgba(20,18,23,0.10)",
  progressTrack: "rgba(102,97,99,0.12)",
} as const;

export function ImessageCardBadge({
  left = 30,
  top = 30,
}: {
  left?: number;
  top?: number;
}) {
  const dotOffsets = [
    [0, -23],
    [23, 0],
    [0, 23],
    [-23, 0],
  ] as const;

  return (
    <div
      aria-hidden="true"
      style={{
        position: "absolute",
        top,
        left,
        display: "flex",
        width: 135,
        height: 101,
        border: `2px solid ${IMESSAGE_CARD_COLOR.badgeBorder}`,
        borderRadius: 999,
        backgroundColor: IMESSAGE_CARD_COLOR.badge,
        boxShadow: "0 2px 4px rgba(20,18,23,0.08)",
      }}
    >
      <span
        style={{
          position: "absolute",
          top: 43,
          left: 60,
          display: "flex",
          width: 15,
          height: 15,
          borderRadius: 999,
          backgroundColor: IMESSAGE_CARD_COLOR.badgeMark,
        }}
      />
      {dotOffsets.map(([x, y]) => (
        <span
          key={`${x}:${y}`}
          style={{
            position: "absolute",
            top: 46 + y,
            left: 63 + x,
            display: "flex",
            width: 10,
            height: 10,
            borderRadius: 999,
            backgroundColor: IMESSAGE_CARD_COLOR.badgeMark,
          }}
        />
      ))}
    </div>
  );
}
