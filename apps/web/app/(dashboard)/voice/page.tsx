import { VoiceCall } from "@/src/components/voice/voice-call";
import { getHostedDashboardPageAuthSnapshot } from "@/src/lib/hosted-onboarding/page-auth";

export const metadata = { title: "Voice — Murph" };

export default async function VoicePage() {
  const auth = await getHostedDashboardPageAuthSnapshot();
  return <VoiceCall signedIn={auth.authenticated} />;
}
