import { redirect } from "next/navigation";
import SchematicClient from "./SchematicClient";
import { chatGPTSignInPath, getChatGPTUser } from "../chatgpt-auth";

export const dynamic = "force-dynamic";

type SitePageProps = { params: Promise<{ path?: string[] }> };

export default async function SchematicSite({ params }: SitePageProps) {
  const route = (await params).path ?? [];
  const protectedRoute = ["studio", "parts", "settings"].includes(route[0] ?? "");
  if (protectedRoute && !(await getChatGPTUser())) {
    redirect(chatGPTSignInPath(`/${route[0]}`));
  }
  return <SchematicClient />;
}
