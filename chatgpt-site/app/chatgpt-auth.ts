import { headers } from "next/headers";
import { redirect } from "next/navigation";

export type ChatGPTUser = {
  userId: string;
  displayName: string;
  email: string;
  fullName: string | null;
};

const SIGN_IN_PATH = "/signin-with-chatgpt";
const SIGN_OUT_PATH = "/signout-with-chatgpt";

export async function getChatGPTUser(): Promise<ChatGPTUser | null> {
  const requestHeaders = await headers();
  const userId = requestHeaders.get("oai-authenticated-user-id");
  const email = requestHeaders.get("oai-authenticated-user-email");
  if (!userId || !email) return null;
  const encodedFullName = requestHeaders.get("oai-authenticated-user-full-name");
  const fullName = encodedFullName && requestHeaders.get("oai-authenticated-user-full-name-encoding") === "percent-encoded-utf-8"
    ? safeDecode(encodedFullName)
    : null;
  return { userId, displayName: fullName ?? email, email, fullName };
}

export async function requireChatGPTUser(returnTo: string) {
  const user = await getChatGPTUser();
  if (user) return user;
  redirect(chatGPTSignInPath(returnTo));
}

export function chatGPTSignInPath(returnTo = "/studio") {
  return `${SIGN_IN_PATH}?return_to=${encodeURIComponent(safeReturnPath(returnTo))}`;
}

export function chatGPTSignOutPath(returnTo = "/") {
  return `${SIGN_OUT_PATH}?return_to=${encodeURIComponent(safeReturnPath(returnTo))}`;
}

function safeReturnPath(value: string) {
  return value.startsWith("/") && !value.startsWith("//") && !value.startsWith(SIGN_IN_PATH) && !value.startsWith(SIGN_OUT_PATH) ? value : "/";
}

function safeDecode(value: string) {
  try { return decodeURIComponent(value); } catch { return null; }
}
