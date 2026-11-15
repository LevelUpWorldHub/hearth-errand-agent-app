import type { DietFlag } from "@/lib/types";

export const DIET_LABEL: Record<DietFlag, string> = {
  vegetarian: "Vegetarian",
  "no-nuts": "No tree nuts",
  "no-shellfish": "No shellfish",
  "no-mushrooms": "No mushrooms",
  "no-spicy": "No very spicy food",
};

export function money(amount: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(amount);
}

export function formatQty(quantity: number): string {
  if (Number.isInteger(quantity)) return String(quantity);
  return quantity.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
}

export function stepFor(unit: string): number {
  if (unit === "g" || unit === "ml") return 50;
  if (unit === "kg" || unit === "L") return 0.1;
  return 1;
}

export function roundQty(quantity: number): number {
  return Math.round(quantity * 100) / 100;
}

export function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}
