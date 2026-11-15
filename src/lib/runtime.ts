import { applyProposal, noticeNeeds } from "@/lib/autonomy";
import { money } from "@/lib/format";
import {
  buildShoppingList,
  checkPantry,
  planDinner,
  scheduleErrands,
} from "@/lib/planner";
import type { HealEvent } from "@/lib/healing";
import { resilient } from "@/lib/healing";
import type {
  DinnerPlan,
  Household,
  Proposal,
  ScannedIngredient,
  ShoppingBuild,
} from "@/lib/types";

export type AgentTool = string | { url: string; tools?: string[] };

export type AgentNode = {
  name: string;
  function?: {
    description?: string;
    parameters?: Record<string, unknown>;
  };
  instructions?: string;
  tools?: AgentTool[];
  allow?: {
    to_downstream?: { sly_data?: string[] };
  };
};

export type AgentNetwork = {
  metadata?: { description?: string; tags?: string[] };
  llm_config?: { model_name?: string; temperature?: number };
  max_steps?: number;
  max_execution_seconds?: number;
  tools: AgentNode[];
};

export type TraceEvent = {
  agent: string;
  action: string;
  detail: string;
};

export type LlmTool = {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
};

export type LlmMessage =
  | { role: "system" | "user"; content: string }
  | {
      role: "assistant";
      content: string | null;
      tool_calls?: { id: string; name: string; arguments: string }[];
    }
  | { role: "tool"; tool_call_id: string; content: string };

export type LlmClient = (input: {
  model: string;
  messages: LlmMessage[];
  tools: LlmTool[];
  signal: AbortSignal;
}) => Promise<{ content: string | null; toolCalls: { id: string; name: string; arguments: string }[] }>;

export type RuntimeContext = {
  household: Household;
  today: string;
  scan: ScannedIngredient[];
  networkName: string;
  links?: Record<string, string>;
  peerPolicy?: { mode?: "closed" | "ask"; denyOrigins?: string[] };
  origin?: string;
  slyData?: Record<string, unknown>;
  stack?: string[];
  invocations?: { count: number };
  maxInvocations?: number;
  confirmWrite?: (summary: string) => boolean | Promise<boolean>;
  confirmPeer?: (origin: string, purpose: string) => boolean | Promise<boolean>;
  confirmSameOrigin?: boolean;
  resolvePeer?: (url: string) => Promise<{
    network: AgentNetwork;
    frontMan: string;
    name: string;
    links?: Record<string, string>;
  }>;
  onPeerInvocation?: (info: { url: string; inquiry: string; sly: Record<string, unknown> }) => void;
  callMcp?: (url: string, tool: string, args: Record<string, unknown>) => Promise<unknown>;
  llm?: LlmClient | null;
  llmTimeoutMs?: number;
};

export type RunResult = {
  ok: boolean;
  answer: string;
  source: "deterministic" | "llm" | "deterministic-fallback";
  trace: TraceEvent[];
  heal: HealEvent[];
  error?: string;
  household: Household;
  proposals: Proposal[];
};

const LLM_TOOLS: LlmTool[] = [
  {
    name: "plan_dinner",
    description: "Plan one dinner the whole household can eat. Lists only missing ingredients.",
    parameters: { type: "object", properties: { maxMinutes: { type: "number" } } },
  },
  {
    name: "build_shopping_list",
    description: "Build a shopping list from dinner gaps and low staples. Does not order anything.",
    parameters: {
      type: "object",
      properties: { includeLowStaples: { type: "boolean" } },
    },
  },
  {
    name: "schedule_errands",
    description: "Find an open grocery window. Does not write the calendar until approval.",
    parameters: { type: "object", properties: {} },
  },
  {
    name: "check_pantry",
    description: "Report low staples and items that expire soon.",
    parameters: { type: "object", properties: { withinDays: { type: "number" } } },
  },
  {
    name: "apply_proposal",
    description: "Write an approved proposal onto the household board. Never places an order.",
    parameters: {
      type: "object",
      properties: { proposalId: { type: "string" } },
      required: ["proposalId"],
    },
  },
];

function hasProblem(value: unknown): string | null {
  if (typeof value === "string") {
    if (value.includes("${")) return "Network still contains unresolved substitutions.";
    return null;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      const problem = hasProblem(item);
      if (problem) return problem;
    }
    return null;
  }
  if (value && typeof value === "object") {
    for (const [key, child] of Object.entries(value)) {
      if (key === "include") return "Network still contains an unresolved include.";
      const problem = hasProblem(child);
      if (problem) return problem;
    }
  }
  return null;
}

export function validateNetwork(
  input: unknown,
  frontMan: string,
  options?: { peers?: string[] },
): { ok: true; network: AgentNetwork } | { ok: false; error: string } {
  const problem = hasProblem(input);
  if (problem) return { ok: false, error: problem };
  if (!input || typeof input !== "object") {
    return { ok: false, error: "Network definition is not an object." };
  }
  const network = input as AgentNetwork;
  if (!Array.isArray(network.tools) || network.tools.length === 0) {
    return { ok: false, error: "Network has no agents." };
  }
  const names = network.tools.map((agent) => agent?.name);
  if (names.some((name) => typeof name !== "string" || name.length === 0)) {
    return { ok: false, error: "An agent is missing a name." };
  }
  const duplicate = names.find((name, index) => names.indexOf(name) !== index);
  if (duplicate) return { ok: false, error: `Duplicate agent name ${duplicate}.` };
  if (!names.includes(frontMan)) {
    return { ok: false, error: `Front agent ${frontMan} is not in the network.` };
  }
  const peers = new Set(options?.peers ?? []);
  for (const agent of network.tools) {
    if (agent.instructions !== undefined && typeof agent.instructions !== "string") {
      return { ok: false, error: `Agent ${agent.name} has invalid instructions.` };
    }
    for (const tool of agent.tools ?? []) {
      if (typeof tool === "string") {
        if (names.includes(tool) || peers.has(tool) || /^https?:\/\//.test(tool)) continue;
        return { ok: false, error: `Agent ${agent.name} references unknown tool ${tool}.` };
      }
      if (!tool || typeof tool.url !== "string" || tool.url.length === 0) {
        return { ok: false, error: `Agent ${agent.name} has an invalid MCP descriptor.` };
      }
    }
  }
  return { ok: true, network };
}

export function classifyIntent(
  text: string,
): "approve" | "errand" | "shop" | "dinner" | "pantry" | "overview" {
  const inquiry = text.toLowerCase();
  if (/\bapprov/.test(inquiry)) return "approve";
  if (/errand|schedule|calendar|what time|when can/.test(inquiry)) return "errand";
  if (/shop|grocery|buy|shopping/.test(inquiry)) return "shop";
  if (/dinner|cook|meal|recipe|eat tonight|what should we/.test(inquiry)) return "dinner";
  if (/pantry|expir|staple|running low|fridge|milk|oats/.test(inquiry)) return "pantry";
  return "overview";
}

export function splitPeerUrl(url: string, origin: string): {
  absolute: string;
  origin: string;
  name: string;
} {
  const absolute = /^https?:\/\//.test(url) ? url : new URL(url, origin.endsWith("/") ? origin : `${origin}/`).toString();
  const parsed = new URL(absolute);
  const parts = parsed.pathname.split("/").filter(Boolean);
  const name = decodeURIComponent(parts[parts.length - 1] ?? "");
  return { absolute, origin: parsed.origin, name };
}

function finished(
  partial: Omit<RunResult, "proposals"> & { proposals?: Proposal[] },
  ctx: RuntimeContext,
): RunResult {
  return {
    ...partial,
    proposals: partial.proposals ?? noticeNeeds(partial.household, ctx.today, ctx.scan),
  };
}

function describeDinner(plan: DinnerPlan): string {
  const missing = plan.missing.length
    ? plan.missing.map((item) => `${item.quantity} ${item.unit} ${item.name}`).join(", ")
    : "nothing";
  const skipped = plan.skipped.length ? ` Left aside: ${plan.skipped.join("; ")}.` : "";
  return `${plan.title} (${plan.minutes} min, ${plan.servings} people). ${plan.why} Missing: ${missing}.${skipped}`;
}

function describeList(list: ShoppingBuild): string {
  if (list.lines.length === 0) return "The shopping list has no new lines.";
  const lines = list.lines
    .map((line) => `${line.quantity} ${line.unit} ${line.name}${line.held ? " (held, over budget)" : ""}`)
    .join("; ");
  return `Shopping list: ${lines}. Estimated spend ${money(list.estimatedSpend)} of ${money(list.remaining)} remaining.`;
}

function isDinnerPlan(value: unknown): value is DinnerPlan {
  if (!value || typeof value !== "object") return false;
  const plan = value as DinnerPlan;
  return typeof plan.title === "string" && typeof plan.minutes === "number" && Array.isArray(plan.missing) && Array.isArray(plan.steps);
}

function mcpDescriptor(agent: AgentNode, tool: string): { url: string } | null {
  for (const entry of agent.tools ?? []) {
    if (typeof entry === "string" || !entry.url) continue;
    if (!entry.tools || entry.tools.includes(tool)) return { url: entry.url };
  }
  return null;
}

async function groundedDinner(
  agent: AgentNode,
  ctx: RuntimeContext,
  trace: TraceEvent[],
  maxMinutes: number,
): Promise<DinnerPlan> {
  const local = () => planDinner(ctx.household, { today: ctx.today, scan: ctx.scan, maxMinutes });
  const mcp = mcpDescriptor(agent, "plan_dinner");
  if (!mcp || !ctx.callMcp) {
    trace.push({ agent: agent.name, action: "plan_dinner", detail: "In-browser tool." });
    return local();
  }
  try {
    const raw = await ctx.callMcp(mcp.url, "plan_dinner", {
      household: ctx.household,
      today: ctx.today,
      scan: ctx.scan,
      maxMinutes,
    });
    if (isDinnerPlan(raw)) {
      trace.push({ agent: agent.name, action: "plan_dinner", detail: `MCP ${mcp.url}` });
      return raw;
    }
    trace.push({
      agent: agent.name,
      action: "fallback",
      detail: "MCP plan_dinner returned an unusable payload. Used the in-browser tool.",
    });
  } catch (error) {
    trace.push({
      agent: agent.name,
      action: "fallback",
      detail: `MCP plan_dinner failed (${error instanceof Error ? error.message : "error"}). Used the in-browser tool.`,
    });
  }
  return local();
}

async function runDeterministic(
  network: AgentNetwork,
  frontMan: string,
  inquiry: string,
  ctx: RuntimeContext,
  trace: TraceEvent[],
): Promise<RunResult> {
  const agent = network.tools.find((entry) => entry.name === frontMan);
  if (!agent) {
    return finished(
      {
        ok: false,
        answer: "",
        error: `Front agent ${frontMan} is not in the network.`,
        source: "deterministic",
        trace,
        heal: [],
        household: ctx.household,
      },
      ctx,
    );
  }
  const intent = classifyIntent(inquiry);
  trace.push({ agent: agent.name, action: "route", detail: intent });

  if (agent.name === "household_coordinator") {
    if (intent === "dinner" || intent === "shop" || intent === "errand") {
      const childName =
        intent === "errand" ? "errand_scheduler" : "dinner_planner";
      const child = network.tools.find((entry) => entry.name === childName);
      if (child) {
        const nextInquiry = intent === "shop" ? "build the shopping list" : inquiry;
        return runDeterministic(network, child.name, nextInquiry, ctx, trace);
      }
    }
    if (intent === "pantry" && ctx.links?.pantry_watch) {
      return contactPeer("pantry_watch", inquiry, agent, ctx, trace);
    }
  }

  if (intent === "approve" || agent.name === "household_coordinator") {
    if (intent === "approve") {
      const proposal = noticeNeeds(ctx.household, ctx.today, ctx.scan)[0];
      if (!proposal) {
        return finished(
          {
            ok: true,
            answer: "Nothing is waiting for approval.",
            source: "deterministic",
            trace,
            heal: [],
            household: ctx.household,
          },
          ctx,
        );
      }
      const summary = `Approve "${proposal.title}" on this household board. proposalId=${proposal.id}. No order will be placed.`;
      const allowed = ctx.confirmWrite ? await ctx.confirmWrite(summary) : false;
      if (!allowed) {
        trace.push({ agent: agent.name, action: "deny-write", detail: summary });
        return finished(
          {
            ok: true,
            answer: "Approval denied. The board was not changed, and nothing was ordered.",
            source: "deterministic",
            trace,
            heal: [],
            household: ctx.household,
          },
          ctx,
        );
      }
      const applied = applyProposal(ctx.household, proposal, new Date().toISOString());
      trace.push({ agent: agent.name, action: "apply_proposal", detail: proposal.id });
      return finished(
        {
          ok: true,
          answer: `${applied.receipt.detail} ${applied.receipt.summary}`,
          source: "deterministic",
          trace,
          heal: [],
          household: applied.household,
        },
        ctx,
      );
    }
  }

  if (agent.name === "dinner_planner" || (agent.name === "household_coordinator" && (intent === "dinner" || intent === "shop"))) {
    if (intent === "shop" || inquiry.toLowerCase().includes("shopping")) {
      const plan = await groundedDinner(agent, ctx, trace, 45);
      const list = buildShoppingList(ctx.household, ctx.today, {
        extras: plan.missing,
        includeLowStaples: true,
        scan: ctx.scan,
      });
      trace.push({ agent: agent.name, action: "build_shopping_list", detail: "In-browser tool." });
      return finished(
        {
          ok: true,
          answer: `${describeDinner(plan)} ${describeList(list)}`,
          source: "deterministic",
          trace,
          heal: [],
          household: ctx.household,
        },
        ctx,
      );
    }
    const busyCap = /tonight|busy|quick|short/.test(inquiry.toLowerCase()) ? 30 : 45;
    const plan = await groundedDinner(agent, ctx, trace, busyCap);
    return finished(
      {
        ok: true,
        answer: describeDinner(plan),
        source: "deterministic",
        trace,
        heal: [],
        household: ctx.household,
      },
      ctx,
    );
  }

  if (agent.name === "errand_scheduler") {
    const errand = scheduleErrands(ctx.household, ctx.today);
    trace.push({ agent: agent.name, action: "schedule_errands", detail: "In-browser tool." });
    const answer = errand.slot
      ? `${errand.reason} Grocery run ${errand.slot.date} ${errand.slot.start}–${errand.slot.end} with ${errand.slot.who}. It is not on the calendar until you approve it.`
      : errand.reason;
    return finished(
      {
        ok: true,
        answer,
        source: "deterministic",
        trace,
        heal: [],
        household: ctx.household,
      },
      ctx,
    );
  }

  if (agent.name === "pantry_sentinel" || intent === "pantry") {
    const report = checkPantry(ctx.household, ctx.today, 2);
    trace.push({ agent: agent.name, action: "check_pantry", detail: "In-browser tool." });
    const low = report.low.map((item) => `${item.name} (${item.quantity} ${item.unit})`).join(", ") || "none";
    const expiring =
      report.expiring
        .map((entry) => `${entry.item.name} in ${entry.daysLeft} day${entry.daysLeft === 1 ? "" : "s"}`)
        .join(", ") || "none";
    return finished(
      {
        ok: true,
        answer: `Low staples: ${low}. Expiring soon: ${expiring}.`,
        source: "deterministic",
        trace,
        heal: [],
        household: ctx.household,
      },
      ctx,
    );
  }

  const proposals = noticeNeeds(ctx.household, ctx.today, ctx.scan);
  const headline = proposals.length
    ? proposals.map((proposal) => proposal.title).join(" ")
    : "Nothing urgent is on the board.";
  return finished(
    {
      ok: true,
      answer: `${headline} I can plan dinner, list only what is missing, check the pantry, or find a grocery window. Nothing is ordered unless you approve it.`,
      source: "deterministic",
      trace,
      heal: [],
      household: ctx.household,
    },
    ctx,
  );
}

async function contactPeer(
  peerName: string,
  inquiry: string,
  agent: AgentNode,
  ctx: RuntimeContext,
  trace: TraceEvent[],
): Promise<RunResult> {
  const url = ctx.links?.[peerName];
  if (!url) {
    return finished(
      {
        ok: false,
        answer: "",
        error: `Peer ${peerName} is not in links.json.`,
        source: "deterministic",
        trace,
        heal: [],
        household: ctx.household,
      },
      ctx,
    );
  }
  const origin = ctx.origin ?? "http://localhost";
  const resolved = splitPeerUrl(url, origin);
  const stack = ctx.stack ?? [];
  if (stack.includes(resolved.name) || resolved.name === ctx.networkName) {
    trace.push({ agent: agent.name, action: "cycle", detail: resolved.name });
    return finished(
      {
        ok: false,
        answer: "Stopped a composition cycle.",
        error: "Stopped a composition cycle.",
        source: "deterministic",
        trace,
        heal: [],
        household: ctx.household,
      },
      ctx,
    );
  }
  const external = resolved.origin !== origin;
  const denied = (ctx.peerPolicy?.denyOrigins ?? []).includes(resolved.origin);
  if (denied || (ctx.peerPolicy?.mode !== "ask" && external)) {
    trace.push({ agent: agent.name, action: "deny", detail: `Denied origin ${resolved.origin}` });
    return finished(
      {
        ok: false,
        answer: `Denied origin ${resolved.origin}. The network was not loaded.`,
        error: `Denied origin ${resolved.origin}. The network was not loaded.`,
        source: "deterministic",
        trace,
        heal: [],
        household: ctx.household,
      },
      ctx,
    );
  }
  if (external || ctx.confirmSameOrigin) {
    const purpose = `Load published network ${resolved.name}`;
    const allowed = ctx.confirmPeer ? await ctx.confirmPeer(resolved.origin, purpose) : false;
    if (!allowed) {
      trace.push({ agent: agent.name, action: "deny", detail: `Denied origin ${resolved.origin}` });
      return finished(
        {
          ok: false,
          answer: `Denied origin ${resolved.origin}. Contact was not approved.`,
          error: `Denied origin ${resolved.origin}. Contact was not approved.`,
          source: "deterministic",
          trace,
          heal: [],
          household: ctx.household,
        },
        ctx,
      );
    }
  }
  if (!ctx.resolvePeer) {
    return finished(
      {
        ok: false,
        answer: "",
        error: `No peer loader is attached for ${resolved.absolute}.`,
        source: "deterministic",
        trace,
        heal: [],
        household: ctx.household,
      },
      ctx,
    );
  }
  const allowedFields = agent.allow?.to_downstream?.sly_data ?? [];
  const sly: Record<string, unknown> = {};
  for (const field of allowedFields) {
    if (ctx.slyData && Object.prototype.hasOwnProperty.call(ctx.slyData, field)) {
      sly[field] = ctx.slyData[field];
    }
  }
  ctx.onPeerInvocation?.({ url: resolved.absolute, inquiry, sly });
  trace.push({ agent: agent.name, action: "peer", detail: resolved.absolute });
  const peer = await ctx.resolvePeer(resolved.absolute);
  const child = await runInquiry({
    network: peer.network,
    frontMan: peer.frontMan,
    inquiry,
    ctx: {
      ...ctx,
      networkName: peer.name,
      links: peer.links ?? {},
      stack: [...stack, ctx.networkName],
      slyData: sly,
      confirmSameOrigin: false,
      llm: null,
    },
  });
  return { ...child, trace: [...trace, ...child.trace] };
}

async function runTool(
  name: string,
  args: Record<string, unknown>,
  state: { household: Household },
  ctx: RuntimeContext,
): Promise<string> {
  if (name === "plan_dinner") {
    const maxMinutes = typeof args.maxMinutes === "number" ? args.maxMinutes : 30;
    return JSON.stringify(planDinner(state.household, { today: ctx.today, scan: ctx.scan, maxMinutes }));
  }
  if (name === "build_shopping_list") {
    const plan = planDinner(state.household, { today: ctx.today, scan: ctx.scan, maxMinutes: 30 });
    return JSON.stringify(
      buildShoppingList(state.household, ctx.today, {
        extras: plan.missing,
        includeLowStaples: args.includeLowStaples !== false,
        scan: ctx.scan,
      }),
    );
  }
  if (name === "schedule_errands") return JSON.stringify(scheduleErrands(state.household, ctx.today));
  if (name === "check_pantry") {
    const withinDays = typeof args.withinDays === "number" ? args.withinDays : 2;
    return JSON.stringify(checkPantry(state.household, ctx.today, withinDays));
  }
  if (name === "apply_proposal") {
    const proposalId = typeof args.proposalId === "string" ? args.proposalId : "";
    const proposal = noticeNeeds(state.household, ctx.today, ctx.scan).find((item) => item.id === proposalId);
    if (!proposal) return JSON.stringify({ ok: false, error: "That proposal is not on the board." });
    const summary = `Approve "${proposal.title}" on this household board. proposalId=${proposal.id}. No order will be placed.`;
    const allowed = ctx.confirmWrite ? await ctx.confirmWrite(summary) : false;
    if (!allowed) return JSON.stringify({ ok: false, error: "Approval denied. The board was not changed." });
    const applied = applyProposal(state.household, proposal, new Date().toISOString());
    state.household = applied.household;
    return JSON.stringify({ ok: true, receipt: applied.receipt });
  }
  return JSON.stringify({ ok: false, error: `Unknown tool ${name}.` });
}

async function llmLoop(
  network: AgentNetwork,
  agent: AgentNode,
  inquiry: string,
  ctx: RuntimeContext,
  signal: AbortSignal,
): Promise<RunResult> {
  if (!ctx.llm) throw new Error("No LLM client is configured.");
  const state = { household: ctx.household };
  const messages: LlmMessage[] = [
    {
      role: "system",
      content: `${agent.instructions ?? "You help run this household."}\nUse the tools for inventory, prices, and the calendar. Never claim an order was placed. Household state:\n${JSON.stringify({
        members: ctx.household.members,
        pantry: ctx.household.pantry,
        schedule: ctx.household.schedule,
        budget: { weekly: ctx.household.weeklyBudget, spent: ctx.household.spent },
        scan: ctx.scan,
      })}`,
    },
    { role: "user", content: inquiry },
  ];
  const trace: TraceEvent[] = [{ agent: agent.name, action: "llm", detail: network.llm_config?.model_name ?? "visitor model" }];
  const maxSteps = network.max_steps ?? 6;
  for (let step = 0; step < maxSteps; step += 1) {
    if (signal.aborted) throw new Error("The model call was aborted.");
    const turn = await ctx.llm({
      model: network.llm_config?.model_name ?? "grok-4.7",
      messages,
      tools: LLM_TOOLS,
      signal,
    });
    if (!turn.toolCalls.length) {
      return finished(
        {
          ok: true,
          answer: turn.content?.trim() || "The model returned an empty answer.",
          source: "llm",
          trace,
          heal: [],
          household: state.household,
        },
        { ...ctx, household: state.household },
      );
    }
    messages.push({ role: "assistant", content: turn.content, tool_calls: turn.toolCalls });
    for (const call of turn.toolCalls) {
      let args: Record<string, unknown> = {};
      try {
        args = call.arguments ? (JSON.parse(call.arguments) as Record<string, unknown>) : {};
      } catch {
        args = {};
      }
      const content = await runTool(call.name, args, state, ctx);
      trace.push({ agent: agent.name, action: call.name, detail: "Model tool call, executed locally." });
      messages.push({ role: "tool", tool_call_id: call.id, content });
    }
  }
  throw new Error("The model exceeded the step budget.");
}

export async function runInquiry(input: {
  network: AgentNetwork;
  frontMan: string;
  inquiry: string;
  ctx: RuntimeContext;
}): Promise<RunResult> {
  const trace: TraceEvent[] = [];
  const validation = validateNetwork(input.network, input.frontMan, {
    peers: Object.keys(input.ctx.links ?? {}),
  });
  if (!validation.ok) {
    return finished(
      {
        ok: false,
        answer: validation.error,
        error: validation.error,
        source: "deterministic",
        trace,
        heal: [],
        household: input.ctx.household,
      },
      input.ctx,
    );
  }
  if ((input.ctx.stack ?? []).includes(input.ctx.networkName)) {
    return finished(
      {
        ok: false,
        answer: "Stopped a composition cycle.",
        error: "Stopped a composition cycle.",
        source: "deterministic",
        trace,
        heal: [],
        household: input.ctx.household,
      },
      input.ctx,
    );
  }
  const invocations = input.ctx.invocations ?? { count: 0 };
  input.ctx.invocations = invocations;
  invocations.count += 1;
  if (invocations.count > (input.ctx.maxInvocations ?? 8)) {
    return finished(
      {
        ok: false,
        answer: "Stopped an over-budget request.",
        error: "Stopped an over-budget request.",
        source: "deterministic",
        trace,
        heal: [],
        household: input.ctx.household,
      },
      input.ctx,
    );
  }

  const agent = validation.network.tools.find((entry) => entry.name === input.frontMan);
  const useLlm = Boolean(input.ctx.llm) && (input.ctx.stack ?? []).length === 0 && agent;
  if (useLlm && agent) {
    const report = await resilient({
      op: "llm",
      timeoutMs: input.ctx.llmTimeoutMs ?? (validation.network.max_execution_seconds ?? 25) * 1000,
      retries: 1,
      run: (_attempt, signal) => llmLoop(validation.network, agent, input.inquiry, input.ctx, signal),
      fallback: () => runDeterministic(validation.network, input.frontMan, input.inquiry, input.ctx, trace),
      verify: (result) => result.ok,
    });
    if (report.value) {
      const source = report.outcome === "fallback" ? "deterministic-fallback" : report.value.source;
      return { ...report.value, source, heal: [...report.events, ...report.value.heal] };
    }
    return finished(
      {
        ok: false,
        answer: "The model call failed and the deterministic planner was unavailable.",
        error: "The model call failed and the deterministic planner was unavailable.",
        source: "deterministic-fallback",
        trace,
        heal: report.events,
        household: input.ctx.household,
      },
      input.ctx,
    );
  }

  return runDeterministic(validation.network, input.frontMan, input.inquiry, input.ctx, trace);
}

function demoCtx(name: string, extra: Partial<RuntimeContext> = {}): RuntimeContext {
  const today = "2026-11-13";
  return {
    household: buildDemo(),
    today,
    scan: [],
    networkName: name,
    origin: "http://localhost:43123",
    links: {},
    peerPolicy: { mode: "closed" },
    ...extra,
  };
}

function buildDemo(): Household {
  return {
    id: "probe",
    name: "Probe",
    owner: "Mark Yukhimets",
    organization: "Level Up Inc.",
    weeklyBudget: 10,
    spent: 0,
    members: [],
    pantry: [],
    schedule: [],
    shoppingList: [],
    committedDinner: null,
    receipts: [],
  };
}

const loneNetwork: AgentNetwork = {
  tools: [
    {
      name: "household_coordinator",
      instructions: "Probe front agent.",
      tools: [],
    },
  ],
};

const peerNetwork: AgentNetwork = {
  tools: [
    {
      name: "household_coordinator",
      instructions: "Probe front agent.",
      tools: ["pantry_watch"],
      allow: { to_downstream: { sly_data: ["sessionId"] } },
    },
  ],
};

export async function probeInvalidNetwork(): Promise<string> {
  const result = await runInquiry({
    network: {
      tools: [
        { name: "household_coordinator", instructions: "One.", tools: [] },
        { name: "household_coordinator", instructions: "Two.", tools: [] },
      ],
    },
    frontMan: "household_coordinator",
    inquiry: "hello",
    ctx: demoCtx("hearth"),
  });
  return result.error ?? "";
}

export async function probeCycle(): Promise<string> {
  const result = await runInquiry({
    network: loneNetwork,
    frontMan: "household_coordinator",
    inquiry: "hello",
    ctx: demoCtx("hearth", { stack: ["hearth"] }),
  });
  return result.error ?? "";
}

export async function probeBudget(): Promise<string> {
  const result = await runInquiry({
    network: loneNetwork,
    frontMan: "household_coordinator",
    inquiry: "hello",
    ctx: demoCtx("hearth", { maxInvocations: 0 }),
  });
  return result.error ?? "";
}

export async function probeDeniedOrigin(): Promise<string> {
  const result = await runInquiry({
    network: peerNetwork,
    frontMan: "household_coordinator",
    inquiry: "What is running low in the pantry?",
    ctx: demoCtx("hearth", {
      links: { pantry_watch: "https://evil.example/pantry_watch" },
      peerPolicy: { mode: "closed", denyOrigins: ["https://evil.example"] },
      resolvePeer: () => {
        throw new Error("Peer loader should not run for a denied origin.");
      },
    }),
  });
  return result.error ?? "";
}

