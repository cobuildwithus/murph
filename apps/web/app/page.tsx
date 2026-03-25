export default function HomePage() {
  return (
    <main
      style={{
        minHeight: "100vh",
        padding: "clamp(1.5rem, 4vw, 3rem)",
        background:
          "linear-gradient(180deg, rgba(248, 250, 252, 1) 0%, rgba(241, 245, 249, 1) 100%)",
        color: "rgb(15 23 42)",
      }}
    >
      <div style={{ width: "100%", maxWidth: "48rem" }}>
        <h1
          style={{
            margin: 0,
            fontSize: "clamp(1.75rem, 8vw, 3.75rem)",
            lineHeight: 1,
            letterSpacing: "-0.03em",
          }}
        >
          <span style={{ display: "block" }}>Healthy Bob hosted</span>
          <span style={{ display: "block" }}>device-sync</span>
          <span style={{ display: "block" }}>control plane</span>
        </h1>
        <p
          style={{
            marginTop: "1rem",
            width: "100%",
            maxWidth: "20rem",
            fontSize: "clamp(1rem, 2.6vw, 1.125rem)",
            lineHeight: 1.6,
            color: "rgb(51 65 85)",
            overflowWrap: "anywhere",
          }}
        >
          This app hosts OAuth callbacks, webhooks, sparse local-agent APIs for WHOOP and Oura, and a hosted Linq webhook ingress for "text your agent" routing.
        </p>
      </div>
    </main>
  );
}
