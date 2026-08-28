import { optionsResponse, simulationState } from "../_runtime";

type Context = { request: Request; env: Record<string, string> };
export const onRequestOptions = ({ request }: Context) => optionsResponse(request);
export const onRequestGet = ({ request, env }: Context) => simulationState(request, env);
