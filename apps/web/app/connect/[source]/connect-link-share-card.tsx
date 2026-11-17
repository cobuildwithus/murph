export const CONNECT_LINK_OG_GROUND = "#F5F0E8";

/**
 * The `/connect/<source>` link unfurl: the Murph app icon and the source's
 * icon joined by dots, on the app's cream. No words: Messages prints the
 * page's title under it. Pure inline styles with no node imports, so the
 * opengraph-image route (satori) and a test render the same card.
 */
export function ConnectLinkShareCard(props: { murphIcon: string; sourceIcon: string }) {
  return (
    <div
      style={{
        alignItems: "center",
        background: CONNECT_LINK_OG_GROUND,
        display: "flex",
        gap: 44,
        height: "100%",
        justifyContent: "center",
        width: "100%",
      }}
    >
      <Tile background="#FAF8F4" src={props.murphIcon} />
      <div style={{ alignItems: "center", display: "flex", gap: 18 }}>
        {[0, 1, 2, 3, 4].map((dot) => (
          <div key={dot} style={{ background: "#C59D4E", borderRadius: 9, display: "flex", height: 18, width: 18 }} />
        ))}
      </div>
      <Tile background="#FFFFFF" src={props.sourceIcon} />
    </div>
  );
}

function Tile(props: { background: string; src: string }) {
  return (
    <div
      style={{
        alignItems: "center",
        background: props.background,
        border: "2px solid #E6DED0",
        borderRadius: 62,
        display: "flex",
        height: 270,
        justifyContent: "center",
        overflow: "hidden",
        width: 270,
      }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element -- satori draws plain img elements */}
      <img alt="" height={270} src={props.src} style={{ objectFit: "contain" }} width={270} />
    </div>
  );
}
