import { CheckIcon } from "lucide-react";

export function PlanFeatureCard(props: {
  features: readonly string[];
  price?: string;
}) {
  return (
    <div className="rounded-lg border border-[#c4a882]/25 px-5 py-4">
      {props.price ? (
        <div className="flex items-baseline gap-1">
          <span className="font-serif text-3xl font-semibold tracking-tight text-[#2d3436]">
            {props.price}
          </span>
          <span className="text-sm text-[#736a58]">/ month</span>
        </div>
      ) : null}
      <ul className={props.price ? "mt-4 flex flex-col gap-2.5" : "flex flex-col gap-2.5"}>
        {props.features.map((feature) => (
          <li key={feature} className="flex items-start gap-2.5 text-sm text-[#2d3436]">
            <span aria-hidden className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-[#7a8c6e]/15">
              <CheckIcon className="size-3 text-[#7a8c6e]" strokeWidth={2.5} />
            </span>
            {feature}
          </li>
        ))}
      </ul>
    </div>
  );
}
