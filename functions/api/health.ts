import { corsHeaders } from "./_runtime";

export const onRequestOptions = ({ request }: { request: Request }) => new Response(null, { status: 204, headers: corsHeaders(request) });
export const onRequestGet = ({ request }: { request: Request }) => Response.json({ status: "ok", version: "1.0.0", runtime: "cloudflare-pages-behavioral" }, { headers: corsHeaders(request) });
