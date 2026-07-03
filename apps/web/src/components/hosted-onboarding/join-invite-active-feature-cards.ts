import {
  ActivityIcon,
  FlaskConicalIcon,
  MessageCircleIcon,
  TrendingUpIcon,
} from "lucide-react";

export const JOIN_INVITE_ACTIVE_FEATURE_CARDS = [
  {
    body: "Pick a protocol like sauna, zone 2, or creatine, and follow it for a set stretch of time.",
    icon: FlaskConicalIcon,
    title: "Run an experiment",
  },
  {
    body: "Your numbers before and after each experiment, with a clear verdict at the end.",
    icon: TrendingUpIcon,
    title: "See what worked",
  },
  {
    body: "Text Murph via iMessage, Telegram, or email.",
    icon: MessageCircleIcon,
    title: "Chat wherever you live",
  },
  {
    body: "Fitbit, other supported wearables, and lab results sync into every experiment automatically.",
    icon: ActivityIcon,
    title: "Health connected",
  },
] as const;
