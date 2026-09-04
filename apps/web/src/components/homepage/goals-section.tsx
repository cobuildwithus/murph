"use client";

import Link from "next/link";

import { GoalBrowseCard } from "@/src/components/goals/goal-browse-card";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/src/components/ui/tabs";
import type { HomepageGoalPersona } from "@/src/lib/goals/homepage-goal-personas";

export function GoalsSection({
  personas,
  totalGoalCount,
}: {
  personas: readonly HomepageGoalPersona[];
  totalGoalCount: number;
}) {
  const [firstPersona] = personas;
  if (!firstPersona) {
    return null;
  }

  return (
    <section
      className="bg-[#f5f0e8] px-4 pt-20 sm:px-8 sm:pt-24 lg:px-16 lg:pt-28"
      data-homepage-goals
    >
      <div className="mx-auto max-w-[1200px]">
        <div className="mx-auto max-w-[720px] text-center">
          <h2 className="font-serif text-[1.875rem] font-semibold leading-[1.08] tracking-[-0.03em] text-balance text-[#2d3436] sm:text-[clamp(2rem,4vw,3.25rem)]">
            Hey Murph, help me…
          </h2>
          <p className="mx-auto mt-5 max-w-[46ch] text-[1rem] leading-[1.7] text-balance text-[#3a322a]">
            Pick a goal. Murph helps you get there faster, easier, and in a
            way that fits your life.
          </p>
        </div>

        <Tabs
          className="mt-8 gap-6 sm:mt-10 sm:gap-8"
          defaultValue={firstPersona.id}
        >
          <TabsList
            aria-label="Who this is for"
            className="grid w-full grid-cols-2 gap-2 border-0 sm:mx-auto sm:flex sm:w-fit sm:flex-wrap sm:justify-center"
          >
            {personas.map((persona) => (
              <TabsTrigger
                className="min-h-10 rounded-full border border-black/[0.08] bg-[#fffdf8] px-4 py-0 text-sm font-medium text-[#635a48] transition-colors hover:border-black/[0.16] hover:text-foreground focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-[#f5f0e8] data-active:border-[#2d3436] data-active:bg-[#2d3436] data-active:font-medium data-active:text-[#f5f0e8] data-active:hover:border-[#2d3436] data-active:hover:text-[#f5f0e8] sm:min-h-9"
                key={persona.id}
                value={persona.id}
              >
                {persona.label}
              </TabsTrigger>
            ))}
          </TabsList>
          {personas.map((persona) => (
            <TabsContent
              className="text-base"
              key={persona.id}
              value={persona.id}
            >
              <ul
                className="grid grid-cols-2 gap-2 sm:gap-3 lg:grid-cols-4"
                data-homepage-goal-persona={persona.id}
              >
                {persona.goals.map((goal) => (
                  <li className="min-w-0" key={goal.href}>
                    <GoalBrowseCard
                      className="h-full"
                      href={goal.href}
                      illustrationSrc={goal.illustrationSrc}
                      title={goal.phrase}
                    />
                  </li>
                ))}
              </ul>
            </TabsContent>
          ))}
        </Tabs>

        <div className="mt-8 text-center sm:mt-10">
          <Link
            className="inline-flex min-h-10 items-center gap-2 text-[0.875rem] font-semibold text-[#5a6e32] underline decoration-[#5a6e32]/35 underline-offset-4 transition-colors hover:text-[#3d5028]"
            href="/goals"
          >
            Browse all {totalGoalCount} goals
            <span aria-hidden="true">→</span>
          </Link>
        </div>
      </div>
    </section>
  );
}
