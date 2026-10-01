import type { Metadata } from "next";
import { VoiceCallStudy } from "../../design/voice-call-study";

export const metadata: Metadata = { title: "Voice call study", robots: { index: false, follow: false } };
export default function VoiceStudyPage() {
  return <main className="px-5 sm:px-10"><VoiceCallStudy /></main>;
}
