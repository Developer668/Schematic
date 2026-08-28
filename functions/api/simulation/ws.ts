import { optionsResponse, simulationWebSocket } from "../_runtime";

type Context = { request: Request; env: Record<string, string> };
export const onRequestOptions = ({ request }: Context) => optionsResponse(request);
export const onRequest = ({ request, env }: Context) => simulationWebSocket(request, env);
