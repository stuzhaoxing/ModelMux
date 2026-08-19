import { proxyAnthropicMessages } from "@/lib/gateway/proxy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(request: Request): Promise<Response> {
  return proxyAnthropicMessages(request);
}

export async function OPTIONS(request: Request): Promise<Response> {
  return proxyAnthropicMessages(request);
}
