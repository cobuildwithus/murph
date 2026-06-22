import { JOIN_INVITE_ACTIVE_FEATURE_CARDS } from "@/src/components/hosted-onboarding/join-invite-active-feature-cards";

export function FeatureHighlights() {
  return (
    <div className="mt-10 border-t border-border/40 pt-8">
      <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-muted-foreground">
        Murph helps you be healthier
      </p>
      <div className="mt-4 grid gap-x-6 gap-y-5 sm:grid-cols-2">
        {JOIN_INVITE_ACTIVE_FEATURE_CARDS.map((item) => (
          <div key={item.title} className="flex gap-3">
            <item.icon className="mt-0.5 size-4 shrink-0 text-[#7a8c6e]" />
            <div>
              <p className="text-sm font-semibold text-foreground">
                {item.title}
              </p>
              <p className="mt-0.5 text-sm leading-relaxed text-pretty text-muted-foreground">
                {item.body}
              </p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
