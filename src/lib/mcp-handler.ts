import { buildDemoHousehold } from "@/lib/household";
import {
  buildShoppingList,
  checkPantry,
  planDinner,
  scheduleErrands,
} from "@/lib/planner";
import type { Household, ScannedIngredient } from "@/lib/types";

export const MCP_PROTOCOL_VERSIONS = ["2024-11-05", "2025-03-26", "2025-06-18", "2025-11-25"];

const TOOLS = [
  {
    name: "plan_dinner",
    description:
      "Plan one dinner the whole household can eat. Uses pantry and fridge-scan ingredients and lists only what is missing. Does not place an order.",
    inputSchema: {
      type: "object",
      properties: {
        household: { type: "object", description: "Household board. Omit to use the published demo household." },
        today: { type: "string", description: "ISO date." },
        scan: { type: "array", items: { type: "object" } },
        maxMinutes: { type: "number" },
        servings: { type: "number" },
      },
    },
  },
  {
    name: "build_shopping_list",
    description:
      "Build a shopping list from dinner gaps and low staples, inside the weekly budget. Does not place an order.",
    inputSchema: {
      type: "object",
      properties: {
        household: { type: "object" },
        today: { type: "string" },
        scan: { type: "array", items: { type: "object" } },
        includeLowStaples: { type: "boolean" },
        maxMinutes: { type: "number" },
      },
    },
  },
  {
    name: "schedule_errands",
    description: "Find an open grocery window that does not overlap a busy block. Does not write the calendar.",
    inputSchema: {
      type: "object",
      properties: {
        household: { type: "object" },
        today: { type: "string" },
        durationMin: { type: "number" },
      },
    },
  },
  {
    name: "check_pantry",
    description: "Report low staples, items at zero, and anything expiring inside the given window.",
    inputSchema: {
      type: "object",
      properties: {
        household: { type: "object" },
        today: { type: "string" },
        withinDays: { type: "number" },
      },
    },
  },
] as const;

type Rpc = {
  jsonrpc?: string;
  id?: string | number | null;
  method?: string;
  params?: Record<string, unknown>;
};

export type McpDispatch =
  | { kind: "empty"; status: number }
  | { kind: "json"; status: number; body: unknown };

function coerceHousehold(input: unknown, today: string): Household {
  if (!input || typeof input !== "object") return buildDemoHousehold(today);
  const candidate = input as Household;
  if (!Array.isArray(candidate.members) || !Array.isArray(candidate.pantry) || !Array.isArray(candidate.schedule)) {
    return buildDemoHousehold(today);
  }
  const demo = buildDemoHousehold(today);
  return {
    ...demo,
    ...candidate,
    shoppingList: candidate.shoppingList ?? [],
    receipts: candidate.receipts ?? [],
    committedDinner: candidate.committedDinner ?? null,
  };
}

function asScan(input: unknown): ScannedIngredient[] {
  if (!Array.isArray(input)) return [];
  return input.flatMap((entry) => {
    if (!entry || typeof entry !== "object") return [];
    const record = entry as ScannedIngredient;
    if (typeof record.name !== "string" || typeof record.quantity !== "number" || typeof record.unit !== "string") {
      return [];
    }
    return [
      {
        name: record.name,
        quantity: record.quantity,
        unit: record.unit,
        confidence: typeof record.confidence === "number" ? record.confidence : 1,
      },
    ];
  });
}

function toolResult(id: string | number | null, payload: unknown, isError = false): McpDispatch {
  return {
    kind: "json",
    status: 200,
    body: {
      jsonrpc: "2.0",
      id,
      result: {
        content: [{ type: "text", text: JSON.stringify(payload) }],
        structuredContent: payload,
        isError,
      },
    },
  };
}

function errorResult(
  id: string | number | null,
  code: number,
  message: string,
  status = 200,
): McpDispatch {
  return { kind: "json", status, body: { jsonrpc: "2.0", id, error: { code, message } } };
}

function callTool(name: string, args: Record<string, unknown>, today: string): unknown {
  const day = typeof args.today === "string" ? args.today : today;
  const household = coerceHousehold(args.household, day);
  const scan = asScan(args.scan);
  if (name === "plan_dinner") {
    return planDinner(household, {
      today: day,
      scan,
      maxMinutes: typeof args.maxMinutes === "number" ? args.maxMinutes : undefined,
      servings: typeof args.servings === "number" ? args.servings : undefined,
    });
  }
  if (name === "build_shopping_list") {
    const plan = planDinner(household, {
      today: day,
      scan,
      maxMinutes: typeof args.maxMinutes === "number" ? args.maxMinutes : 30,
    });
    return buildShoppingList(household, day, {
      extras: plan.missing,
      includeLowStaples: args.includeLowStaples !== false,
      scan,
    });
  }
  if (name === "schedule_errands") {
    return scheduleErrands(
      household,
      day,
      typeof args.durationMin === "number" ? args.durationMin : 45,
    );
  }
  if (name === "check_pantry") {
    return checkPantry(household, day, typeof args.withinDays === "number" ? args.withinDays : 2);
  }
  return { error: `Unknown tool ${name}.` };
}

export function handleJsonRpc(body: unknown, ctx: { today: string }): McpDispatch {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return errorResult(null, -32600, "Invalid request.", 400);
  }
  const message = body as Rpc;
  if (message.jsonrpc !== "2.0" || typeof message.method !== "string") {
    return errorResult(message.id ?? null, -32600, "Invalid request.", 400);
  }
  const id = message.id ?? null;
  const isNotification = message.id === undefined;
  if (message.method === "notifications/initialized" || message.method.startsWith("notifications/")) {
    return { kind: "empty", status: 202 };
  }
  if (message.method === "ping") {
    return { kind: "json", status: 200, body: { jsonrpc: "2.0", id, result: {} } };
  }
  if (message.method === "initialize") {
    const requested = String(message.params?.protocolVersion ?? "");
    const protocolVersion = MCP_PROTOCOL_VERSIONS.includes(requested) ? requested : "2025-06-18";
    return {
      kind: "json",
      status: 200,
      body: {
        jsonrpc: "2.0",
        id,
        result: {
          protocolVersion,
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: "hearth", version: "1.0.0" },
          instructions:
            "Hearth plans household dinners, shopping lists, and errands. These tools are read-only. Nothing is ordered or written to a calendar.",
        },
      },
    };
  }
  if (message.method === "tools/list") {
    return { kind: "json", status: 200, body: { jsonrpc: "2.0", id, result: { tools: TOOLS } } };
  }
  if (message.method === "tools/call") {
    const params = message.params ?? {};
    const name = typeof params.name === "string" ? params.name : "";
    const args =
      params.arguments && typeof params.arguments === "object"
        ? (params.arguments as Record<string, unknown>)
        : {};
    if (!name) return errorResult(id, -32602, "Tool name is required.");
    const known = TOOLS.some((tool) => tool.name === name);
    if (!known) return toolResult(id, { error: `Unknown tool ${name}.` }, true);
    return toolResult(id, callTool(name, args, ctx.today), false);
  }
  if (isNotification) return { kind: "empty", status: 202 };
  return errorResult(id, -32601, `Method not found: ${message.method}.`);
}

export function handleJsonRpcBatch(body: unknown, ctx: { today: string }): McpDispatch {
  if (!Array.isArray(body)) return handleJsonRpc(body, ctx);
  if (body.length === 0) return errorResult(null, -32600, "Invalid request.", 400);
  const responses = body
    .map((entry) => handleJsonRpc(entry, ctx))
    .filter((entry) => entry.kind === "json")
    .map((entry) => entry.body);
  if (responses.length === 0) return { kind: "empty", status: 202 };
  return { kind: "json", status: 200, body: responses };
}
