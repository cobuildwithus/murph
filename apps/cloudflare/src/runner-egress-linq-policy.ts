export type HostedLinqProviderOperation =
  | "attachment_create"
  | "attachment_read"
  | "chat_create"
  | "check_imessage_capability"
  | "message_delete"
  | "message_send"
  | "phone_numbers_list"
  | "reaction_create"
  | "read_receipt_send"
  | "typing_start"
  | "typing_stop"
  | "voice_memo_send";

/** Worker-owned Linq allowlist. Provider clients never grant egress. */
export function readAllowedHostedLinqOperation(
  method: string,
  pathnameSuffix: string,
): HostedLinqProviderOperation | null {
  if (method === "GET" && pathnameSuffix === "/phone_numbers") {
    return "phone_numbers_list";
  }
  if (method === "GET" && /^\/attachments\/[^/]+$/u.test(pathnameSuffix)) {
    return "attachment_read";
  }
  if (method === "POST" && pathnameSuffix === "/attachments") {
    return "attachment_create";
  }
  if (method === "POST" && pathnameSuffix === "/chats") {
    return "chat_create";
  }
  if (method === "POST" && pathnameSuffix === "/capability/check_imessage") {
    return "check_imessage_capability";
  }
  if (method === "POST" && /^\/messages\/[^/]+\/reactions$/u.test(pathnameSuffix)) {
    return "reaction_create";
  }
  if (method === "POST" && /^\/chats\/[^/]+\/voicememo$/u.test(pathnameSuffix)) {
    return "voice_memo_send";
  }
  if (method === "POST" && /^\/chats\/[^/]+\/messages$/u.test(pathnameSuffix)) {
    return "message_send";
  }
  if (method === "POST" && /^\/chats\/[^/]+\/typing$/u.test(pathnameSuffix)) {
    return "typing_start";
  }
  if (method === "POST" && /^\/chats\/[^/]+\/read$/u.test(pathnameSuffix)) {
    return "read_receipt_send";
  }
  if (method === "DELETE" && /^\/chats\/[^/]+\/typing$/u.test(pathnameSuffix)) {
    return "typing_stop";
  }
  if (method === "DELETE" && /^\/messages\/[^/]+$/u.test(pathnameSuffix)) {
    return "message_delete";
  }
  return null;
}
