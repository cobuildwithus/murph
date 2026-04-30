import {
  ActivityIcon,
  FlaskConicalIcon,
  MessageCircleIcon,
  TrendingUpIcon,
} from "lucide-react";

export const JOIN_INVITE_ACTIVE_FEATURE_CARDS = [
  {
    body: "Pick a protocol from the library, such as sauna, zone 2, or creatine, and run it for a set period.",
    icon: FlaskConicalIcon,
    title: "Run an experiment",
  },
  {
    body: "Baseline vs. post-experiment metrics, with a clear verdict at the end.",
    icon: TrendingUpIcon,
    title: "See what worked",
  },
  {
    body: "Text Murph via iMessage, Telegram, or email.",
    icon: MessageCircleIcon,
    title: "Chat wherever you live",
  },
  {
    body: "Apple Health, wearables, and lab results sync into every experiment automatically.",
    icon: ActivityIcon,
    title: "Health connected",
  },
] as const;
