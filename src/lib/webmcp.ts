type ModelContext = {
  registerTool?: (tool: {
    name: string;
    description: string;
    inputSchema: Record<string, unknown>;
    execute: (args: Record<string, unknown>) => Promise<unknown>;
  }) => void;
  provideContext?: (context: { tools: unknown[] }) => void;
};

const TOOLS = [
  {
    name: "plan_dinner",
    description: "Plan one dinner the household can share and list only missing ingredients.",
  },
  {
    name: "build_shopping_list",
    description: "Build a shopping list from dinner gaps and low staples. Does not order anything.",
  },
  {
    name: "schedule_errands",
    description: "Find an open grocery window that does not overlap a busy block.",
  },
  {
    name: "check_pantry",
    description: "Report low staples and food that expires soon.",
  },
];

export function registerHouseholdWebMcp(
  execute: (name: string, args: Record<string, unknown>) => Promise<unknown>,
): boolean {
  if (typeof navigator === "undefined") return false;
  const context = (navigator as Navigator & { modelContext?: ModelContext }).modelContext;
  if (!context) return false;
  if (typeof context.registerTool === "function") {
    for (const tool of TOOLS) {
      context.registerTool({
        name: tool.name,
        description: tool.description,
        inputSchema: { type: "object", properties: {} },
        execute: (args) => execute(tool.name, args ?? {}),
      });
    }
    return true;
  }
  if (typeof context.provideContext === "function") {
    context.provideContext({
      tools: TOOLS.map((tool) => ({
        name: tool.name,
        description: tool.description,
        inputSchema: { type: "object", properties: {} },
        execute: (args: Record<string, unknown>) => execute(tool.name, args ?? {}),
      })),
    });
    return true;
  }
  return false;
}
