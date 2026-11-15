import { connection } from "next/server";

export async function GET() {
  await connection();
  return Response.json({
    ok: true,
    service: "hearth",
    publisherVision: Boolean(process.env.XAI_API_KEY),
    model: process.env.XAI_MODEL || "grok-4.7",
    mcp: "/mcp",
    time: new Date().toISOString(),
  });
}
