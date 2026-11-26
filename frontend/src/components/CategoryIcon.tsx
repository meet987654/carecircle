import { ClipboardList, Phone, Pill, Stethoscope } from "lucide-react";
import type { Category } from "../types";

const ICONS = { medicine: Pill, appointment: Stethoscope, call: Phone, other: ClipboardList };

export const CATEGORY_LABEL: Record<Category, string> = {
  medicine: "Medicine",
  appointment: "Appointment",
  call: "Call",
  other: "Other",
};

export function CategoryIcon({ category, size = 24 }: { category: Category; size?: number }) {
  const Icon = ICONS[category];
  return (
    <span className={`cat cat--${category}`} aria-hidden>
      <Icon size={size} strokeWidth={2.2} />
    </span>
  );
}
