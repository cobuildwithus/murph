import * as z from "@murphai/contracts/zod-runtime";

export const hostedLeaveGroupReasonSchema = z.enum(["bot_loop", "spam", "no_real_members", "asked_to_leave"]);
export const hostedLeaveGroupRequestSchema = z.object({
  action: z.literal("leave_group"),
  reason: hostedLeaveGroupReasonSchema,
  origin: z.object({ kind: z.literal("accepted_input"), assistantInputId: z.string().min(1).max(128) }).strict(),
}).strict();
export const hostedLeaveGroupResponseSchema = z.object({
  action: z.literal("leave_group"),
  result: z.discriminatedUnion("status", [
    z.object({ status: z.literal("left") }).strict(),
    z.object({ status: z.literal("already_left") }).strict(),
    z.object({ status: z.literal("unavailable"), reason: z.enum(["source_unavailable", "game_bound", "active_move", "route_changed"]) }).strict(),
  ]),
}).strict();
export type HostedLeaveGroupRequest = z.infer<typeof hostedLeaveGroupRequestSchema>;
export type HostedLeaveGroupResponse = z.infer<typeof hostedLeaveGroupResponseSchema>;
