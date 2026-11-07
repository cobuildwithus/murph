import type { Metadata } from "next";
import { ChannelConnectionStudy } from "../../design/channel-connection-study";

export const metadata: Metadata = {
  title: "Channel connection recovery | Murph screenshots",
  robots: { follow: false, index: false },
};

export default function ChannelConnectionScreenshotPage() {
  return (
    <main className="min-h-screen bg-background px-5 py-8 text-foreground sm:px-8">
      <div className="mx-auto max-w-4xl">
        <ChannelConnectionStudy />
      </div>
    </main>
  );
}
