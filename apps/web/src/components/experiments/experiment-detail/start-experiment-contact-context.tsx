"use client";

import {
  createContext,
  useContext,
  type ReactNode,
} from "react";

import {
  DEFAULT_EXPERIMENT_START_CONTACT_CHANNELS,
  type ExperimentStartContactChannels,
} from "@/src/lib/experiments/start-experiment-contact";

interface ExperimentStartContactContextValue {
  initialContactChannels: ExperimentStartContactChannels;
  murphPhoneNumber: string | null;
}

const ExperimentStartContactContext = createContext<ExperimentStartContactContextValue>({
  initialContactChannels: DEFAULT_EXPERIMENT_START_CONTACT_CHANNELS,
  murphPhoneNumber: null,
});

export function ExperimentStartContactProvider({
  children,
  initialContactChannels,
  murphPhoneNumber,
}: {
  children?: ReactNode;
  initialContactChannels: ExperimentStartContactChannels;
  murphPhoneNumber: string | null;
}) {
  return (
    <ExperimentStartContactContext.Provider
      value={{
        initialContactChannels,
        murphPhoneNumber,
      }}
    >
      {children}
    </ExperimentStartContactContext.Provider>
  );
}

export function useExperimentStartContactContext(): ExperimentStartContactContextValue {
  return useContext(ExperimentStartContactContext);
}
