import type { Household, PantryItem, ScannedIngredient } from "@/lib/types";

export const STORAGE_KEY = "hearth-household-v1";
export const BYOK_KEY = "hearth-byok-v1";

export function isoDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function addDays(iso: string, days: number): string {
  const [year, month, day] = iso.split("-").map(Number);
  const date = new Date(year, (month ?? 1) - 1, day ?? 1);
  date.setDate(date.getDate() + days);
  return isoDate(date);
}

export function daysBetween(from: string, to: string): number {
  const start = new Date(`${from}T00:00:00`);
  const end = new Date(`${to}T00:00:00`);
  return Math.round((end.getTime() - start.getTime()) / 86_400_000);
}

export function minutesOf(hhmm: string): number {
  const [hours, mins] = hhmm.split(":").map(Number);
  return (hours ?? 0) * 60 + (mins ?? 0);
}

export function addMinutes(hhmm: string, amount: number): string {
  const total = minutesOf(hhmm) + amount;
  const hours = Math.floor(total / 60) % 24;
  const mins = total % 60;
  return `${String(hours).padStart(2, "0")}:${String(mins).padStart(2, "0")}`;
}

export function rangesOverlap(
  startA: string,
  endA: string,
  startB: string,
  endB: string,
): boolean {
  return minutesOf(startA) < minutesOf(endB) && minutesOf(startB) < minutesOf(endA);
}

export const SAMPLE_SCAN: ScannedIngredient[] = [
  { name: "spinach", quantity: 1, unit: "bunch", confidence: 0.92 },
  { name: "garlic", quantity: 1, unit: "head", confidence: 0.81 },
  { name: "eggs", quantity: 6, unit: "count", confidence: 0.88 },
  { name: "yogurt", quantity: 2, unit: "cup", confidence: 0.74 },
];

function pantry(items: PantryItem[]): PantryItem[] {
  return items;
}

export function buildDemoHousehold(today: string): Household {
  return {
    id: "yukhimets",
    name: "Yukhimets household",
    owner: "Mark Yukhimets",
    organization: "Level Up Inc.",
    weeklyBudget: 160,
    spent: 72.5,
    members: [
      {
        id: "mark",
        name: "Mark",
        role: "Cooks Sundays",
        diet: ["no-spicy"],
      },
      {
        id: "mira",
        name: "Mira",
        role: "Soccer nights",
        diet: ["vegetarian", "no-nuts"],
      },
      {
        id: "leo",
        name: "Leo",
        role: "Age 9",
        diet: ["no-mushrooms", "no-shellfish"],
      },
    ],
    pantry: pantry([
      {
        id: "milk",
        name: "milk",
        quantity: 0.4,
        unit: "L",
        staple: true,
        lowAt: 1,
        expiresOn: addDays(today, 6),
        category: "dairy",
      },
      {
        id: "eggs",
        name: "eggs",
        quantity: 6,
        unit: "count",
        staple: true,
        lowAt: 4,
        expiresOn: addDays(today, 10),
        category: "protein",
      },
      {
        id: "spinach",
        name: "spinach",
        quantity: 1,
        unit: "bunch",
        staple: false,
        lowAt: 0,
        expiresOn: addDays(today, 1),
        category: "produce",
      },
      {
        id: "rice",
        name: "rice",
        quantity: 1.2,
        unit: "kg",
        staple: true,
        lowAt: 0.4,
        category: "grain",
      },
      {
        id: "tomatoes",
        name: "canned tomatoes",
        quantity: 2,
        unit: "can",
        staple: false,
        lowAt: 0,
        expiresOn: addDays(today, 365),
        category: "pantry",
      },
      {
        id: "pasta",
        name: "pasta",
        quantity: 400,
        unit: "g",
        staple: true,
        lowAt: 200,
        category: "grain",
      },
      {
        id: "oil",
        name: "olive oil",
        quantity: 250,
        unit: "ml",
        staple: true,
        lowAt: 80,
        category: "pantry",
      },
      {
        id: "garlic",
        name: "garlic",
        quantity: 0,
        unit: "head",
        staple: false,
        lowAt: 0,
        expiresOn: addDays(today, 14),
        category: "produce",
      },
      {
        id: "yogurt",
        name: "yogurt",
        quantity: 2,
        unit: "cup",
        staple: false,
        lowAt: 0,
        expiresOn: addDays(today, 2),
        category: "dairy",
      },
      {
        id: "oats",
        name: "oats",
        quantity: 0.2,
        unit: "kg",
        staple: true,
        lowAt: 0.5,
        category: "grain",
      },
      {
        id: "chicken",
        name: "chicken thighs",
        quantity: 0.6,
        unit: "kg",
        staple: false,
        lowAt: 0,
        expiresOn: addDays(today, 2),
        category: "protein",
      },
      {
        id: "mushrooms",
        name: "mushrooms",
        quantity: 1,
        unit: "box",
        staple: false,
        lowAt: 0,
        expiresOn: addDays(today, 3),
        category: "produce",
      },
    ]),
    schedule: [
      {
        id: "pickup",
        date: today,
        start: "17:15",
        end: "18:00",
        title: "Leo soccer pickup",
        who: "Mira",
        kind: "busy",
      },
      {
        id: "review",
        date: today,
        start: "18:30",
        end: "20:00",
        title: "Late review",
        who: "Mark",
        kind: "busy",
      },
    ],
    shoppingList: [],
    committedDinner: null,
    receipts: [],
  };
}

export function remainingBudget(household: Household): number {
  return Math.round((household.weeklyBudget - household.spent) * 100) / 100;
}

export function parseHousehold(raw: string, today: string): Household | null {
  try {
    const parsed = JSON.parse(raw) as { anchor?: string; household?: Household };
    if (parsed.anchor !== today || !parsed.household) return null;
    const household = parsed.household;
    if (!Array.isArray(household.members) || !Array.isArray(household.pantry)) return null;
    return {
      ...buildDemoHousehold(today),
      ...household,
      shoppingList: household.shoppingList ?? [],
      receipts: (household.receipts ?? []).map((receipt) => ({
        ...receipt,
        externalOrderPlaced: false as const,
      })),
      committedDinner: household.committedDinner ?? null,
    };
  } catch {
    return null;
  }
}
