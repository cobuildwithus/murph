import { MurphPulseLoader } from "@/src/components/ui/murph-pulse-loader";

export default function ComputerHandoffLoading() {
  return (
    <main
      aria-busy
      aria-live="polite"
      role="status"
      className="flex min-h-dvh flex-col items-center justify-center gap-6 bg-foreground px-6 py-12 text-background"
    >
      <MurphPulseLoader className="h-24 w-auto" />
      <p className="font-serif text-2xl font-normal">Opening your private page</p>
    </main>
  );
}
