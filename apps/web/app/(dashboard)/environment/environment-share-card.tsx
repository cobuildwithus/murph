export type EnvironmentShareCardData = {
  coverage: number;
  grade: "A" | "B" | "C" | "D" | "E";
  known: number;
  score: number;
  total: number;
};

export function EnvironmentShareCard({
  data,
  logoDataUri,
}: {
  data: EnvironmentShareCardData;
  logoDataUri: string;
}) {
  return (
    <div
      style={{
        background: "#f5f0e8",
        color: "#2d3436",
        display: "flex",
        height: "100%",
        overflow: "hidden",
        position: "relative",
        width: "100%",
      }}
    >
      <div
        style={{
          background: "#fffcf6",
          border: "1px solid rgba(196, 168, 130, 0.35)",
          borderRadius: 28,
          bottom: 58,
          display: "flex",
          left: 58,
          position: "absolute",
          right: 58,
          top: 58,
        }}
      >
        <img
          alt=""
          height={34}
          src={logoDataUri}
          style={{ display: "flex", left: 42, position: "absolute", top: 36 }}
          width={152}
        />

        <div
          style={{
            display: "flex",
            flexDirection: "column",
            left: 42,
            position: "absolute",
            top: 132,
            width: 600,
          }}
        >
          <div
            style={{
              color: "#5a6e32",
              display: "flex",
              fontFamily: "DM Sans",
              fontSize: 15,
              letterSpacing: "0.14em",
              textTransform: "uppercase",
            }}
          >
            My environment
          </div>
          <div
            style={{
              display: "flex",
              fontFamily: "Fraunces",
              fontSize: 58,
              fontWeight: 600,
              letterSpacing: "-0.035em",
              lineHeight: 1.04,
              marginTop: 18,
            }}
          >
            The places that shape my health.
          </div>
          <div
            style={{
              color: "#736a58",
              display: "flex",
              fontFamily: "DM Sans",
              fontSize: 20,
              lineHeight: 1.45,
              marginTop: 24,
              width: 550,
            }}
          >
            Sleep, air, light, recovery and work, mapped by Murph.
          </div>
        </div>

        <div
          style={{
            alignItems: "center",
            background: "#e7eadb",
            borderRadius: 24,
            display: "flex",
            flexDirection: "column",
            height: 390,
            justifyContent: "center",
            position: "absolute",
            right: 42,
            top: 42,
            width: 360,
          }}
        >
          <div
            style={{
              alignItems: "center",
              border: "1px solid rgba(90, 110, 50, 0.22)",
              borderRadius: 28,
              color: "#5a6e32",
              display: "flex",
              fontFamily: "Fraunces",
              fontSize: 72,
              fontWeight: 600,
              height: 116,
              justifyContent: "center",
              width: 116,
            }}
          >
            {data.grade}
          </div>
          <div
            style={{
              display: "flex",
              fontFamily: "Fraunces",
              fontSize: 64,
              fontWeight: 600,
              letterSpacing: "-0.03em",
              marginTop: 22,
            }}
          >
            {data.score}%
          </div>
          <div
            style={{
              color: "#736a58",
              display: "flex",
              fontFamily: "DM Sans",
              fontSize: 18,
              marginTop: 4,
            }}
          >
            Environment grade
          </div>
          <div
            style={{
              background: "rgba(90, 110, 50, 0.15)",
              borderRadius: 999,
              display: "flex",
              height: 7,
              marginTop: 26,
              overflow: "hidden",
              width: 250,
            }}
          >
            <div
              style={{
                background: "#5a6e32",
                display: "flex",
                height: "100%",
                width: `${data.coverage}%`,
              }}
            />
          </div>
          <div
            style={{
              color: "#736a58",
              display: "flex",
              fontFamily: "DM Sans",
              fontSize: 15,
              marginTop: 12,
            }}
          >
            Murph knows {data.known} of {data.total}
          </div>
        </div>
      </div>

      <div
        style={{
          bottom: 18,
          color: "#5a6e32",
          display: "flex",
          fontFamily: "DM Sans",
          fontSize: 15,
          left: 72,
          position: "absolute",
        }}
      >
        withmurph.ai
      </div>
    </div>
  );
}
