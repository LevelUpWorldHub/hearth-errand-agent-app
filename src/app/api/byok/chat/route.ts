import { connection } from "next/server";
import { assertRouterUrl, bearerToken, resolveVisionAuth } from "@/lib/router-guard";
import { RouterError, completeChat } from "@/lib/xai-server";

export async function POST(request: Request) {
  await connection();
  const auth = resolveVisionAuth(
    "visitor",
    bearerToken(request.headers.get("authorization")),
    process.env.XAI_API_KEY,
  );
  if ("error" in auth) return Response.json({ error: auth.error }, { status: 401 });
  let router: URL;
  try {
    router = assertRouterUrl(request.headers.get("x-hearth-router") || "https://api.x.ai/v1");
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Bad router." }, { status: 400 });
  }
  const body = (await request.json().catch(() => null)) as { messages?: unknown; tools?: unknown } | null;
  if (!body || !Array.isArray(body.messages)) {
    return Response.json({ error: "Missing messages." }, { status: 400 });
  }
  try {
    const message = await completeChat({
      key: auth.key,
      baseUrl: router.toString(),
      model: request.headers.get("x-hearth-model") || "grok-4.7",
      messages: body.messages as { role: string; content: unknown }[],
      tools: body.tools,
      signal: AbortSignal.timeout(25_000),
    });
    return Response.json({ message });
  } catch (error) {
    const status = error instanceof RouterError ? error.status : 502;
    return Response.json(
      { error: error instanceof Error ? error.message : "The router failed." },
      { status },
    );
  }
}
