export const dynamic = "force-dynamic";

export default async function JoinInviteSuccessPage(input: {
  params: Promise<{ inviteCode: string }>;
  searchParams: Promise<{ share?: string }>;
}) {
  const { inviteCode } = await input.params;
  const searchParams = await input.searchParams;
  const shareCode = typeof searchParams.share === "string" ? decodeURIComponent(searchParams.share) : null;
  const href = `/join/${encodeURIComponent(decodeURIComponent(inviteCode))}${shareCode ? `?share=${encodeURIComponent(shareCode)}` : ""}`;

  return (
    <main
      style={{
        minHeight: "100vh",
        padding: "clamp(1.25rem, 4vw, 2.5rem)",
        display: "grid",
        placeItems: "center",
        background: "linear-gradient(180deg, rgba(239, 246, 255, 1) 0%, rgba(248, 250, 252, 1) 100%)",
      }}
    >
      <section
        style={{
          width: "100%",
          maxWidth: "36rem",
          borderRadius: "1.5rem",
          background: "white",
          boxShadow: "0 20px 50px rgba(15, 23, 42, 0.12)",
          padding: "clamp(1.5rem, 4vw, 2rem)",
          display: "grid",
          gap: "1rem",
        }}
      >
        <h1 style={{ margin: 0, fontSize: "clamp(2rem, 6vw, 3rem)", letterSpacing: "-0.04em" }}>
          Payment received
        </h1>
        <p style={{ margin: 0, color: "rgb(71 85 105)", lineHeight: 1.6 }}>
          We're finishing hosted activation now. Head back to your invite page and it will show when the subscription state turns active.
        </p>
        <a
          href={href}
          style={{
            display: "inline-flex",
            width: "fit-content",
            borderRadius: "999px",
            background: "rgb(15 23 42)",
            color: "white",
            fontWeight: 700,
            textDecoration: "none",
            padding: "0.9rem 1.15rem",
          }}
        >
          Return to Healthy Bob
        </a>
      </section>
    </main>
  );
}
