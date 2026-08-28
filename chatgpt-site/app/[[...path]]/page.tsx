import { redirect } from "next/navigation";
import SchematicClient from "./SchematicClient";
import { chatGPTSignInPath, getChatGPTUser } from "../chatgpt-auth";

export const dynamic = "force-dynamic";

type SitePageProps = { params: Promise<{ path?: string[] }> };

export default async function SchematicSite({ params }: SitePageProps) {
  const route = (await params).path ?? [];
  if (route[0] === "studio" && !(await getChatGPTUser())) {
    redirect(chatGPTSignInPath("/studio"));
  }
  return <SchematicClient />;
}
