export class RouterError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "RouterError";
    this.status = status;
  }
}

const VISION_PROMPT =
  'List edible ingredients you can see. Reply with JSON only: {"ingredients":[{"name":"spinach","quantity":1,"unit":"bunch","confidence":0.8}]}. Use unit bunch, g, kg, ml, L, can, head, count, cup, or box. If the amount is unclear, use quantity 1 and a lower confidence.';

type ChatMessage = {
  role: string;
  content: unknown;
  tool_call_id?: string;
  tool_calls?: unknown;
};

export async function completeVision(options: {
  key: string;
  baseUrl: string;
  model: string;
  imageDataUrl: string;
  signal?: AbortSignal;
}): Promise<string> {
  const endpoint = `${options.baseUrl.replace(/\/$/, "")}/chat/completions`;
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${options.key}`,
    },
    body: JSON.stringify({
      model: options.model,
      temperature: 0,
      messages: [
        {
          role: "system",
          content: "You extract edible ingredients from fridge and pantry photos. Reply with JSON only.",
        },
        {
          role: "user",
          content: [
            { type: "image_url", image_url: { url: options.imageDataUrl, detail: "high" } },
            { type: "text", text: VISION_PROMPT },
          ],
        },
      ],
    }),
    signal: options.signal,
  });
  const payload = await readJson(response);
  if (!response.ok) {
    throw new RouterError(routerMessage(response.status, payload), response.status);
  }
  return messageText(payload);
}

export async function completeChat(options: {
  key: string;
  baseUrl: string;
  model: string;
  messages: ChatMessage[];
  tools?: unknown;
  signal?: AbortSignal;
}): Promise<{ content: string | null; toolCalls: { id: string; name: string; arguments: string }[] }> {
  const endpoint = `${options.baseUrl.replace(/\/$/, "")}/chat/completions`;
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${options.key}`,
    },
    body: JSON.stringify({
      model: options.model,
      temperature: 0.2,
      messages: options.messages,
      tools: options.tools,
      tool_choice: options.tools ? "auto" : undefined,
    }),
    signal: options.signal,
  });
  const payload = await readJson(response);
  if (!response.ok) {
    throw new RouterError(routerMessage(response.status, payload), response.status);
  }
  const message = (payload as { choices?: { message?: Record<string, unknown> }[] }).choices?.[0]?.message;
  const content = typeof message?.content === "string" ? message.content : messageText({ choices: [{ message }] });
  const rawCalls = Array.isArray(message?.tool_calls) ? message.tool_calls : [];
  const toolCalls = rawCalls.flatMap((call) => {
    if (!call || typeof call !== "object") return [];
    const record = call as {
      id?: string;
      name?: string;
      arguments?: string;
      function?: { name?: string; arguments?: string };
    };
    const name = record.function?.name ?? record.name;
    if (!name) return [];
    return [
      {
        id: record.id ?? name,
        name,
        arguments: record.function?.arguments ?? record.arguments ?? "{}",
      },
    ];
  });
  return { content: content || null, toolCalls };
}

async function readJson(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return {};
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return { error: text.slice(0, 180) };
  }
}

function messageText(payload: unknown): string {
  const message = (payload as { choices?: { message?: { content?: unknown } }[] }).choices?.[0]?.message;
  const content = message?.content;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => (part && typeof part === "object" && "text" in part ? String(part.text ?? "") : ""))
      .join("\n");
  }
  throw new RouterError("The router returned no text.", 502);
}

function routerMessage(status: number, payload: unknown): string {
  const record = payload as { error?: { message?: string } | string };
  const detail = typeof record.error === "string" ? record.error : record.error?.message;
  if (status === 401 || status === 403) return "The router rejected that key.";
  return detail ? `The router returned ${status}. ${detail}`.slice(0, 240) : `The router returned ${status}.`;
}
