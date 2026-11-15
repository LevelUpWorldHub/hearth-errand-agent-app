export async function callHearthMcp(
  url: string,
  tool: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  const endpoint = /^https?:\/\//.test(url) ? url : new URL(url, window.location.origin).toString();
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: crypto.randomUUID(),
      method: "tools/call",
      params: { name: tool, arguments: args },
    }),
  });
  const payload = await readMcp(response);
  if (!response.ok) throw new Error(`MCP returned ${response.status}.`);
  const record = payload as {
    error?: { message?: string };
    result?: { isError?: boolean; structuredContent?: unknown; content?: { text?: string }[] };
  };
  if (record.error) throw new Error(record.error.message || "MCP error");
  if (record.result?.isError) {
    throw new Error(record.result.content?.[0]?.text || "MCP tool failed.");
  }
  return record.result?.structuredContent ?? record.result;
}

async function readMcp(response: Response): Promise<unknown> {
  const type = response.headers.get("content-type") ?? "";
  if (type.includes("text/event-stream")) {
    const text = await response.text();
    const data = text
      .split("\n")
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trim())
      .pop();
    if (!data) throw new Error("MCP returned an empty stream.");
    return JSON.parse(data) as unknown;
  }
  return response.json();
}
