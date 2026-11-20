import { connection } from "next/server";
import { RouterUrlError, assertRouterUrl, bearerToken, resolveVisionAuth, safeModel } from "@/lib/router-guard";
import { RouterError, completeChat } from "@/lib/xai-server";

export async function POST(request: Request) {
  await connection();
  const auth = resolveVisionAuth(
    "visitor",
    bearerToken(request.headers.get("authorization")),
    process.env.XAI_API_KEY,
  );
  if ("error" in auth) return Response.json({ error: auth.error, code: "byok_key_required" }, { status: 401 });
  let router: URL;
  try {
    router = assertRouterUrl(request.headers.get("x-hearth-router") || "https://api.x.ai/v1");
  } catch (error) {
    const code = error instanceof RouterUrlError ? error.code : "router_invalid";
    const message = error instanceof RouterUrlError ? error.message : "Router URL is invalid.";
    return Response.json({ error: message, code }, { status: 400 });
  }
  const body = (await request.json().catch(() => null)) as { messages?: unknown; tools?: unknown } | null;
  if (!body || !Array.isArray(body.messages)) {
    return Response.json({ error: "Missing messages.", code: "bad_body" }, { status: 400 });
  }
  try {
    const message = await completeChat({
      key: auth.key,
      baseUrl: router.toString(),
      model: safeModel(request.headers.get("x-hearth-model")),
      messages: body.messages as { role: string; content: unknown }[],
      tools: body.tools,
      signal: AbortSignal.timeout(25_000),
    });
    return Response.json({ message });
  } catch (error) {
    if (error instanceof RouterError) {
      return Response.json({ error: error.message, code: error.code }, { status: error.status });
    }
    return Response.json({ error: "The router failed.", code: "router_error" }, { status: 502 });
  }
}
