import { buildDemoHousehold } from "@/lib/household";
import {
  buildShoppingList,
  checkPantry,
  planDinner,
  scheduleErrands,
} from "@/lib/planner";
import type { z } from "zod";
import { type ToolName, describeIssues, householdSchema, toolArgSchemas } from "@/lib/mcp-schema";
import type { Household, ScannedIngredient } from "@/lib/types";

export const MAX_BATCH = 20;

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
        today: { type: "string", format: "date", description: "ISO date, YYYY-MM-DD." },
        scan: { type: "array", maxItems: 60, items: { type: "object" } },
        maxMinutes: { type: "integer", minimum: 5, maximum: 240 },
        servings: { type: "integer", minimum: 1, maximum: 20 },
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
        today: { type: "string", format: "date" },
        scan: { type: "array", maxItems: 60, items: { type: "object" } },
        includeLowStaples: { type: "boolean" },
        maxMinutes: { type: "integer", minimum: 5, maximum: 240 },
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
        today: { type: "string", format: "date" },
        durationMin: { type: "integer", minimum: 10, maximum: 240 },
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
        today: { type: "string", format: "date" },
        withinDays: { type: "integer", minimum: 0, maximum: 60 },
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

function withDefaults(input: z.infer<typeof householdSchema> | undefined, today: string): Household {
  const demo = buildDemoHousehold(today);
  if (!input) return demo;
  return {
    ...demo,
    ...Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined)),
  } as Household;
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

type ToolOutcome = { ok: true; payload: unknown } | { ok: false; message: string };

function callTool(name: ToolName, rawArgs: unknown, today: string): ToolOutcome {
  const parsed = toolArgSchemas[name].safeParse(rawArgs ?? {});
  if (!parsed.success) return { ok: false, message: `Invalid arguments for ${name}. ${describeIssues(parsed.error)}` };
  const args = parsed.data as {
    household?: z.infer<typeof householdSchema>;
    today?: string;
    scan?: ScannedIngredient[];
    maxMinutes?: number;
    servings?: number;
    includeLowStaples?: boolean;
    durationMin?: number;
    withinDays?: number;
  };
  const day = args.today ?? today;
  const household = withDefaults(args.household, day);
  const scan = args.scan ?? [];
  if (name === "plan_dinner") {
    return { ok: true, payload: planDinner(household, { today: day, scan, maxMinutes: args.maxMinutes, servings: args.servings }) };
  }
  if (name === "build_shopping_list") {
    const plan = planDinner(household, { today: day, scan, maxMinutes: args.maxMinutes ?? 30 });
    return {
      ok: true,
      payload: buildShoppingList(household, day, {
        extras: plan.missing,
        includeLowStaples: args.includeLowStaples !== false,
        scan,
      }),
    };
  }
  if (name === "schedule_errands") {
    return { ok: true, payload: scheduleErrands(household, day, args.durationMin ?? 45) };
  }
  return { ok: true, payload: checkPantry(household, day, args.withinDays ?? 2) };
}

export function handleJsonRpc(body: unknown, ctx: { today: string }): McpDispatch {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return errorResult(null, -32600, "Invalid request.", 400);
  }
  const message = body as Rpc;
  if (message.jsonrpc !== "2.0" || typeof message.method !== "string") {
    return errorResult(message.id ?? null, -32600, "Invalid request.", 400);
  }
  if (message.id !== undefined && message.id !== null && typeof message.id !== "string" && typeof message.id !== "number") {
    return errorResult(null, -32600, "Invalid request id.", 400);
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
    const params = message.params;
    if (params !== undefined && (params === null || typeof params !== "object" || Array.isArray(params))) {
      return errorResult(id, -32602, "params must be an object.", 400);
    }
    const name = typeof params?.name === "string" ? params.name : "";
    if (!name) return errorResult(id, -32602, "Tool name is required.", 400);
    if (!(name in toolArgSchemas)) return errorResult(id, -32602, `Unknown tool ${name.slice(0, 60)}.`, 400);
    const rawArgs = params?.arguments;
    if (rawArgs !== undefined && (rawArgs === null || typeof rawArgs !== "object" || Array.isArray(rawArgs))) {
      return errorResult(id, -32602, "arguments must be an object.", 400);
    }
    let outcome: ToolOutcome;
    try {
      outcome = callTool(name as ToolName, rawArgs, ctx.today);
    } catch {
      return errorResult(id, -32603, `The ${name} tool failed on this input.`, 500);
    }
    if (!outcome.ok) return errorResult(id, -32602, outcome.message, 400);
    return toolResult(id, outcome.payload, false);
  }
  if (isNotification) return { kind: "empty", status: 202 };
  return errorResult(id, -32601, `Method not found: ${message.method}.`);
}

export function handleJsonRpcBatch(body: unknown, ctx: { today: string }): McpDispatch {
  if (!Array.isArray(body)) return handleJsonRpc(body, ctx);
  if (body.length === 0) return errorResult(null, -32600, "Invalid request.", 400);
  if (body.length > MAX_BATCH) {
    return errorResult(null, -32600, `Batch too large. Send at most ${MAX_BATCH} requests.`, 400);
  }
  const responses = body
    .map((entry) => handleJsonRpc(entry, ctx))
    .filter((entry) => entry.kind === "json")
    .map((entry) => entry.body);
  if (responses.length === 0) return { kind: "empty", status: 202 };
  return { kind: "json", status: 200, body: responses };
}
