import { z } from "zod";

/** Calendar date in YYYY-MM-DD that round-trips through Date. Rejects 2026-02-31 and NaN dates. */
export const isoDay = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Use a YYYY-MM-DD date.")
  .refine((value) => {
    const [year, month, day] = value.split("-").map(Number);
    if (year < 2000 || year > 2100) return false;
    const date = new Date(Date.UTC(year, month - 1, day));
    return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
  }, "Use a real calendar date between 2000 and 2100.");

const clock = z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/, "Use a HH:MM time.");
const shortText = (max: number) => z.string().trim().min(1).max(max);
const amount = (max: number) => z.number().finite().min(0).max(max);

const diet = z.enum(["vegetarian", "no-nuts", "no-shellfish", "no-mushrooms", "no-spicy"]);

const member = z.object({
  id: shortText(60),
  name: shortText(80),
  role: z.string().max(120).default(""),
  diet: z.array(diet).max(5).default([]),
});

const pantryItem = z.object({
  id: shortText(60),
  name: shortText(80),
  quantity: amount(100_000),
  unit: shortText(20),
  staple: z.boolean().default(false),
  lowAt: amount(100_000).default(0),
  expiresOn: isoDay.optional(),
  category: z.enum(["dairy", "produce", "grain", "pantry", "protein"]).default("pantry"),
});

const scheduleBlock = z
  .object({
    id: shortText(60),
    date: isoDay,
    start: clock,
    end: clock,
    title: z.string().max(120).default(""),
    who: z.string().max(80).default(""),
    kind: z.enum(["busy", "open", "errand"]),
  })
  .refine((block) => block.end > block.start, { message: "end must be after start.", path: ["end"] });

const shoppingLine = z.object({
  id: shortText(80),
  name: shortText(80),
  quantity: amount(100_000),
  unit: shortText(20),
  estimatedCost: amount(1_000_000),
  reason: z.string().max(200).default(""),
  held: z.boolean().default(false),
});

const need = z.object({
  name: shortText(80),
  quantity: amount(100_000),
  unit: shortText(20),
  estimatedCost: amount(1_000_000),
});

const committedDinner = z.object({
  id: shortText(80),
  date: isoDay,
  title: shortText(120),
  minutes: amount(1_440),
  missing: z.array(need).max(100).default([]),
  approvedAt: z.string().max(40),
});

const receipt = z.object({
  id: shortText(80),
  at: z.string().max(40),
  proposalId: z.string().max(80),
  summary: z.string().max(400),
  verified: z.boolean(),
  outcome: z.enum(["verified", "unverified"]),
  detail: z.string().max(400),
  externalOrderPlaced: z.literal(false),
});

export const householdSchema = z.object({
  id: z.string().max(60).optional(),
  name: z.string().max(120).optional(),
  owner: z.string().max(120).optional(),
  organization: z.string().max(120).optional(),
  weeklyBudget: amount(1_000_000).optional(),
  spent: amount(1_000_000).optional(),
  members: z.array(member).min(1).max(20),
  pantry: z.array(pantryItem).max(300),
  schedule: z.array(scheduleBlock).max(300),
  shoppingList: z.array(shoppingLine).max(300).default([]),
  committedDinner: committedDinner.nullable().default(null),
  receipts: z.array(receipt).max(300).default([]),
});

export const scanSchema = z
  .array(
    z.object({
      name: shortText(80),
      quantity: amount(10_000),
      unit: shortText(20),
      confidence: z.number().finite().min(0).max(1).default(1),
    }),
  )
  .max(60);

const base = {
  household: householdSchema.optional(),
  today: isoDay.optional(),
};

export const toolArgSchemas = {
  plan_dinner: z.object({
    ...base,
    scan: scanSchema.optional(),
    maxMinutes: z.number().int().min(5).max(240).optional(),
    servings: z.number().int().min(1).max(20).optional(),
  }),
  build_shopping_list: z.object({
    ...base,
    scan: scanSchema.optional(),
    includeLowStaples: z.boolean().optional(),
    maxMinutes: z.number().int().min(5).max(240).optional(),
  }),
  schedule_errands: z.object({
    ...base,
    durationMin: z.number().int().min(10).max(240).optional(),
  }),
  check_pantry: z.object({
    ...base,
    withinDays: z.number().int().min(0).max(60).optional(),
  }),
} as const;

export type ToolName = keyof typeof toolArgSchemas;

/** One short line per problem, safe to return to a caller. Never includes the submitted values. */
export function describeIssues(error: z.ZodError): string {
  return error.issues
    .slice(0, 5)
    .map((issue) => `${issue.path.length ? issue.path.join(".") : "arguments"}: ${issue.message}`)
    .join("; ");
}
