export type RouterErrorCode =
  | "router_rejected_key"
  | "router_redirect"
  | "router_unreachable"
  | "router_bad_response"
  | "router_no_text"
  | "router_error";

export class RouterError extends Error {
  readonly status: number;
  readonly code: RouterErrorCode;

  constructor(message: string, status: number, code: RouterErrorCode = "router_error") {
    super(message);
    this.name = "RouterError";
    this.status = status;
    this.code = code;
  }
}

/** POST to an allowlisted router. Redirects are never followed and network errors become a clean code. */
async function postRouter(endpoint: string, key: string, body: unknown, signal?: AbortSignal): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(endpoint, {
      method: "POST",
      redirect: "manual",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${key}`,
      },
      body: JSON.stringify(body),
      signal,
    });
  } catch (error) {
    if (error instanceof Error && error.name === "TimeoutError") {
      throw new RouterError("The router did not answer in time.", 504, "router_unreachable");
    }
    throw new RouterError("The router could not be reached.", 502, "router_unreachable");
  }
  if (response.status >= 300 && response.status < 400) {
    throw new RouterError("The router tried to redirect. Redirects are not followed.", 502, "router_redirect");
  }
  const payload = await readJson(response);
  if (!response.ok) {
    throw new RouterError(routerMessage(response.status, payload), clientStatus(response.status), routerCode(response.status));
  }
  if (payload === null) {
    throw new RouterError("The router returned a response that was not JSON.", 502, "router_bad_response");
  }
  return payload;
}

function clientStatus(status: number): number {
  if (status === 401 || status === 403) return 401;
  if (status === 429) return 429;
  if (status >= 400 && status < 500) return 400;
  return 502;
}

function routerCode(status: number): RouterErrorCode {
  if (status === 401 || status === 403) return "router_rejected_key";
  return "router_error";
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
  const payload = await postRouter(endpoint, options.key, {
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
  }, options.signal);
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
  const payload = await postRouter(endpoint, options.key, {
    model: options.model,
    temperature: 0.2,
    messages: options.messages,
    tools: options.tools,
    tool_choice: options.tools ? "auto" : undefined,
  }, options.signal);
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

/** Parse a JSON body. Non-JSON bodies return null and are never echoed back to the caller. */
async function readJson(response: Response): Promise<unknown> {
  const text = await response.text().catch(() => "");
  if (!text) return {};
  try {
    const parsed = JSON.parse(text) as unknown;
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
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
  throw new RouterError("The router returned no text.", 502, "router_no_text");
}

function routerMessage(status: number, payload: unknown): string {
  if (status === 401 || status === 403) return "The router rejected that key.";
  const record = (payload ?? {}) as { error?: { message?: unknown } | unknown };
  const raw =
    typeof record.error === "string"
      ? record.error
      : record.error && typeof record.error === "object"
        ? (record.error as { message?: unknown }).message
        : undefined;
  // Only a short plain-text message from a JSON error body is passed on. HTML and markup are dropped.
  const detail = typeof raw === "string" && !/[<>]/.test(raw) ? raw.replace(/\s+/g, " ").slice(0, 160) : "";
  return detail ? `The router returned ${status}. ${detail}` : `The router returned ${status}.`;
}
