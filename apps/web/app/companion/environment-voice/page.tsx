import type { Metadata } from "next";
import { CompanionEnvironmentVoice } from "./voice-client";

export const metadata: Metadata = {
  title: "Environment interview",
  robots: { index: false, follow: false },
};

export default function CompanionEnvironmentVoicePage() {
  return <CompanionEnvironmentVoice />;
}
