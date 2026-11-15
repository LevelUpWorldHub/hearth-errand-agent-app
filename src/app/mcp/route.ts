import { connection } from "next/server";
import { isoDate } from "@/lib/household";
import { handleJsonRpcBatch } from "@/lib/mcp-handler";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
  "Access-Control-Allow-Headers":
    "Content-Type, Accept, Authorization, Mcp-Session-Id, MCP-Protocol-Version",
  "Access-Control-Expose-Headers": "Mcp-Session-Id",
};

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: cors });
}

export async function GET() {
  return Response.json(
    { error: "Hearth MCP uses POST with the Streamable HTTP transport." },
    { status: 405, headers: { ...cors, allow: "POST, DELETE, OPTIONS" } },
  );
}

export async function DELETE() {
  return Response.json({ ok: true }, { headers: cors });
}

export async function POST(request: Request) {
  await connection();
  const accept = request.headers.get("accept");
  if (accept && !accept.includes("application/json") && !accept.includes("text/event-stream")) {
    return Response.json(
      { error: "Accept must include application/json or text/event-stream." },
      { status: 406, headers: cors },
    );
  }
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json(
      { jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error." } },
      { status: 400, headers: cors },
    );
  }
  const result = handleJsonRpcBatch(body, { today: isoDate(new Date()) });
  if (result.kind === "empty") return new Response(null, { status: result.status, headers: cors });
  return Response.json(result.body, { status: result.status, headers: cors });
}
