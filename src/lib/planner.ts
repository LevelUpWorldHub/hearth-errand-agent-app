import { DIET_LABEL, roundQty, slug } from "@/lib/format";
import { daysBetween, rangesOverlap, addDays, addMinutes } from "@/lib/household";
import type {
  DietFlag,
  DinnerPlan,
  ErrandSlot,
  Household,
  IngredientNeed,
  PantryItem,
  PantryReport,
  ScannedIngredient,
  ShoppingBuild,
  ShoppingLine,
} from "@/lib/types";

type RecipeIngredient = { name: string; quantity: number; unit: string };

type Recipe = {
  id: string;
  title: string;
  minutes: number;
  servings: number;
  violates: DietFlag[];
  ingredients: RecipeIngredient[];
  steps: string[];
};

const CATALOG: Record<string, { quantity: number; unit: string; cost: number }> = {
  garlic: { quantity: 1, unit: "head", cost: 0.7 },
  milk: { quantity: 1, unit: "L", cost: 1.6 },
  oats: { quantity: 1, unit: "kg", cost: 4.2 },
  pasta: { quantity: 400, unit: "g", cost: 1.8 },
  "canned tomatoes": { quantity: 1, unit: "can", cost: 1.4 },
  spinach: { quantity: 1, unit: "bunch", cost: 2.5 },
  "olive oil": { quantity: 15, unit: "ml", cost: 0.3 },
  eggs: { quantity: 1, unit: "count", cost: 0.4 },
  rice: { quantity: 0.3, unit: "kg", cost: 0.9 },
  yogurt: { quantity: 1, unit: "cup", cost: 0.9 },
  lemon: { quantity: 1, unit: "count", cost: 0.6 },
};

const ITEM_VIOLATIONS: Record<string, DietFlag> = {
  "chicken thighs": "vegetarian",
  mushrooms: "no-mushrooms",
};

const RECIPES: Recipe[] = [
  {
    id: "spinach-tomato-pasta",
    title: "Spinach tomato pasta",
    minutes: 20,
    servings: 3,
    violates: [],
    ingredients: [
      { name: "pasta", quantity: 400, unit: "g" },
      { name: "canned tomatoes", quantity: 1, unit: "can" },
      { name: "spinach", quantity: 1, unit: "bunch" },
      { name: "garlic", quantity: 1, unit: "head" },
      { name: "olive oil", quantity: 15, unit: "ml" },
    ],
    steps: [
      "Boil the pasta in salted water.",
      "Warm the olive oil, soften the garlic, then add tomatoes and spinach until the leaves wilt.",
      "Toss and serve. The pot stays vegetarian, nut-free, and mushroom-free.",
    ],
  },
  {
    id: "spinach-egg-rice",
    title: "Spinach egg rice",
    minutes: 22,
    servings: 3,
    violates: [],
    ingredients: [
      { name: "rice", quantity: 0.3, unit: "kg" },
      { name: "eggs", quantity: 3, unit: "count" },
      { name: "spinach", quantity: 1, unit: "bunch" },
      { name: "garlic", quantity: 1, unit: "head" },
      { name: "olive oil", quantity: 15, unit: "ml" },
    ],
    steps: [
      "Warm leftover rice in olive oil with garlic.",
      "Push it aside, scramble the eggs, then fold in the spinach.",
      "Season gently. Skip anything spicy.",
    ],
  },
  {
    id: "tomato-skillet-eggs",
    title: "Tomato skillet eggs",
    minutes: 18,
    servings: 3,
    violates: [],
    ingredients: [
      { name: "eggs", quantity: 4, unit: "count" },
      { name: "canned tomatoes", quantity: 1, unit: "can" },
      { name: "garlic", quantity: 1, unit: "head" },
      { name: "olive oil", quantity: 10, unit: "ml" },
    ],
    steps: [
      "Simmer garlic and tomatoes in olive oil.",
      "Crack in the eggs, cover, and cook until the whites set.",
      "Serve with rice if you want something more filling.",
    ],
  },
];

export function norm(value: string): string {
  return value.trim().toLowerCase();
}

export function householdConstraints(household: Household): DietFlag[] {
  const flags = new Set<DietFlag>();
  for (const member of household.members) {
    for (const flag of member.diet) flags.add(flag);
  }
  return [...flags];
}

export function costFor(name: string, quantity: number, unit: string): number {
  const pack = CATALOG[norm(name)];
  if (!pack || pack.unit !== unit || pack.quantity <= 0) {
    return roundQty(Math.max(quantity, 1) * 2);
  }
  return roundQty((quantity / pack.quantity) * pack.cost);
}

function availableQty(
  household: Household,
  scan: ScannedIngredient[],
  name: string,
  unit: string,
): number {
  const pantryItem = household.pantry.find(
    (item) => norm(item.name) === norm(name) && item.unit === unit,
  );
  const scanned = scan.find((item) => norm(item.name) === norm(name) && item.unit === unit);
  return Math.max(pantryItem?.quantity ?? 0, scanned?.quantity ?? 0);
}

function constraintLines(household: Household): string[] {
  return household.members.map((member) => {
    const diet = member.diet.map((flag) => DIET_LABEL[flag]).join(", ");
    return diet ? `${member.name}: ${diet}` : `${member.name}: no restrictions`;
  });
}

function skippedItems(household: Household, constraints: DietFlag[]): string[] {
  const blocked = new Set(constraints);
  return household.pantry
    .filter((item) => item.quantity > 0 && blocked.has(ITEM_VIOLATIONS[norm(item.name)]))
    .map((item) => {
      const flag = ITEM_VIOLATIONS[norm(item.name)];
      return `${item.name} (${DIET_LABEL[flag].toLowerCase()})`;
    });
}

export function planDinner(
  household: Household,
  options?: {
    today?: string;
    scan?: ScannedIngredient[];
    maxMinutes?: number;
    servings?: number;
  },
): DinnerPlan {
  const scan = options?.scan ?? [];
  const servings = options?.servings ?? household.members.length;
  const maxMinutes = options?.maxMinutes ?? 45;
  const constraints = householdConstraints(household);
  const blocked = new Set(constraints);
  const remaining =
    Math.round((household.weeklyBudget - household.spent) * 100) / 100;
  const scale = servings / 3;

  const ranked = RECIPES.filter((recipe) => recipe.violates.every((flag) => !blocked.has(flag)))
    .map((recipe) => {
      const usesOnHand: DinnerPlan["usesOnHand"] = [];
      const missing: IngredientNeed[] = [];
      let score = 0;
      for (const ingredient of recipe.ingredients) {
        const quantity = roundQty(ingredient.quantity * scale);
        const have = availableQty(household, scan, ingredient.name, ingredient.unit);
        const pantryItem = household.pantry.find(
          (item) => norm(item.name) === norm(ingredient.name) && item.unit === ingredient.unit,
        );
        if (have + 1e-9 >= quantity) {
          usesOnHand.push({ name: ingredient.name, quantity, unit: ingredient.unit });
          score += 3;
          if (pantryItem?.expiresOn && options?.today) {
            const days = daysBetween(options.today, pantryItem.expiresOn);
            if (days >= 0 && days <= 2) score += 8;
          }
        } else {
          const short = roundQty(quantity - Math.max(have, 0));
          missing.push({
            name: ingredient.name,
            quantity: short,
            unit: ingredient.unit,
            estimatedCost: costFor(ingredient.name, short, ingredient.unit),
          });
          score -= 4;
        }
      }
      const estimatedCost = roundQty(missing.reduce((sum, item) => sum + item.estimatedCost, 0));
      const fitsTime = recipe.minutes <= maxMinutes;
      const fitsBudget = estimatedCost <= remaining + 0.001;
      if (!fitsTime) score -= 100;
      if (!fitsBudget) score -= 20;
      return { recipe, usesOnHand, missing, score, estimatedCost, fitsTime, fitsBudget };
    })
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      if (a.missing.length !== b.missing.length) return a.missing.length - b.missing.length;
      if (a.recipe.minutes !== b.recipe.minutes) return a.recipe.minutes - b.recipe.minutes;
      return a.recipe.id.localeCompare(b.recipe.id);
    });

  const best = ranked[0];
  if (!best) {
    return {
      id: "none",
      title: "No shared dinner",
      minutes: 0,
      servings,
      why: "No recipe satisfies every dietary constraint on the board.",
      steps: [],
      usesOnHand: [],
      missing: [],
      fitsBudget: true,
      fitsTime: false,
      estimatedCost: 0,
      constraints: constraintLines(household),
      skipped: skippedItems(household, constraints),
    };
  }

  const expiringUsed = best.usesOnHand.filter((used) => {
    const item = household.pantry.find((pantryItem) => norm(pantryItem.name) === norm(used.name));
    if (!item?.expiresOn || !options?.today) return false;
    const days = daysBetween(options.today, item.expiresOn);
    return days >= 0 && days <= 2;
  });
  const missingText = best.missing.length
    ? `Only ${best.missing
        .map((item) => `${item.quantity} ${item.unit} ${item.name}`)
        .join(", ")} is missing.`
    : "Nothing is missing for this meal.";
  const expireText = expiringUsed.length
    ? `${expiringUsed.map((item) => item.name).join(" and ")} should be used soon.`
    : "No expiring ingredient is required.";

  return {
    id: best.recipe.id,
    title: best.recipe.title,
    minutes: best.recipe.minutes,
    servings,
    why: `${expireText} ${missingText} The meal fits ${constraintLines(household).join("; ")}.`,
    steps: best.recipe.steps,
    usesOnHand: best.usesOnHand,
    missing: best.missing,
    fitsBudget: best.fitsBudget,
    fitsTime: best.fitsTime,
    estimatedCost: best.estimatedCost,
    constraints: constraintLines(household),
    skipped: skippedItems(household, constraints),
  };
}

export function lowStaples(household: Household): PantryItem[] {
  return household.pantry.filter((item) => item.staple && item.quantity <= item.lowAt);
}

export function expiringItems(
  household: Household,
  today: string,
  withinDays: number,
): { item: PantryItem; daysLeft: number }[] {
  return household.pantry.flatMap((item) => {
    if (!item.expiresOn || item.quantity <= 0) return [];
    const daysLeft = daysBetween(today, item.expiresOn);
    if (daysLeft < 0 || daysLeft > withinDays) return [];
    return [{ item, daysLeft }];
  });
}

export function checkPantry(
  household: Household,
  today: string,
  withinDays = 2,
): PantryReport {
  return {
    asOf: today,
    low: lowStaples(household),
    out: household.pantry.filter((item) => item.quantity <= 0),
    expiring: expiringItems(household, today, withinDays),
  };
}

function lineFromNeed(need: IngredientNeed, reason: string, held: boolean): ShoppingLine {
  return {
    id: `shop-${slug(need.name)}`,
    name: need.name,
    quantity: need.quantity,
    unit: need.unit,
    estimatedCost: need.estimatedCost,
    reason,
    held,
  };
}

export function buildShoppingList(
  household: Household,
  today: string,
  options?: {
    extras?: IngredientNeed[];
    includeLowStaples?: boolean;
    scan?: ScannedIngredient[];
  },
): ShoppingBuild {
  const remaining = Math.round((household.weeklyBudget - household.spent) * 100) / 100;
  const drafts: { need: IngredientNeed; reason: string }[] = [];
  const seen = new Set<string>();

  for (const extra of options?.extras ?? []) {
    const key = norm(extra.name);
    if (seen.has(key) || extra.quantity <= 0) continue;
    seen.add(key);
    drafts.push({ need: extra, reason: "Missing for the planned dinner" });
  }

  if (options?.includeLowStaples) {
    for (const staple of lowStaples(household)) {
      const key = norm(staple.name);
      if (seen.has(key)) continue;
      const have = availableQty(household, options.scan ?? [], staple.name, staple.unit);
      const target = roundQty(staple.lowAt * 2);
      const short = roundQty(target - have);
      if (short <= 0) continue;
      seen.add(key);
      drafts.push({
        need: {
          name: staple.name,
          quantity: short,
          unit: staple.unit,
          estimatedCost: costFor(staple.name, short, staple.unit),
        },
        reason: `Below the staple line (${staple.quantity} ${staple.unit} on hand)`,
      });
    }
  }

  let estimatedSpend = 0;
  let heldSpend = 0;
  const lines = drafts.map(({ need, reason }) => {
    const held = estimatedSpend + need.estimatedCost > remaining + 0.001;
    if (held) heldSpend = roundQty(heldSpend + need.estimatedCost);
    else estimatedSpend = roundQty(estimatedSpend + need.estimatedCost);
    return lineFromNeed(need, reason, held);
  });

  return {
    lines,
    remaining,
    estimatedSpend,
    heldSpend: roundQty(heldSpend),
  };
}

export function isBusyEvening(household: Household, date: string): boolean {
  return household.schedule.some(
    (block) =>
      block.date === date &&
      block.kind === "busy" &&
      rangesOverlap(block.start, block.end, "17:00", "20:30"),
  );
}

const ERRAND_STARTS = ["09:00", "11:00", "14:00", "16:15"];

export function scheduleErrands(
  household: Household,
  today: string,
  durationMin = 45,
): { slot: ErrandSlot | null; reason: string } {
  for (let offset = 1; offset <= 3; offset += 1) {
    const date = addDays(today, offset);
    for (const start of ERRAND_STARTS) {
      const end = addMinutes(start, durationMin);
      const conflict = household.schedule.some(
        (block) => block.date === date && rangesOverlap(block.start, block.end, start, end),
      );
      if (conflict) continue;
      const busyTonight = isBusyEvening(household, today);
      return {
        slot: {
          id: `errand-${date}-${start}`,
          date,
          start,
          end,
          title: "Grocery run",
          who: "Mark",
          durationMin,
        },
        reason: busyTonight
          ? "Tonight is already full, so the run waits for the next open morning."
          : "The next open window on the board.",
      };
    }
  }
  return { slot: null, reason: "No 45-minute window is open in the next three days." };
}

export function dinnerMissingNames(plan: DinnerPlan): string[] {
  return plan.missing.map((item) => norm(item.name));
}
