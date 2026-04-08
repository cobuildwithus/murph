import {
  ActivityIcon,
  MessageCircleIcon,
  MoonIcon,
  UtensilsIcon,
} from "lucide-react";

export const JOIN_INVITE_ACTIVE_FEATURE_CARDS = [
  {
    body: "Text what you ate and Murph tracks it automatically.",
    icon: UtensilsIcon,
    title: "Log meals & nutrition",
  },
  {
    body: "Syncs with Oura, WHOOP, and Garmin in the background.",
    icon: MoonIcon,
    title: "Track sleep & recovery",
  },
  {
    body: "Plain-English answers grounded in your own data.",
    icon: MessageCircleIcon,
    title: "Ask health questions",
  },
  {
    body: "Connects how you eat, sleep, and move to show what works.",
    icon: ActivityIcon,
    title: "Spot patterns",
  },
] as const;
