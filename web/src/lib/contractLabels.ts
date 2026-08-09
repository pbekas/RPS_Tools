import type { FamilyRole, ObligationKind, ObligationStatus } from "@/lib/contractTypes";

export const OBLIGATION_KIND_LABELS: Record<ObligationKind, string> = {
  notice_window: "Notice deadline",
  auto_renew: "Auto-renewal",
  expiration: "Expiration",
  rent_escalation: "Rent escalation",
  insurance_coi: "Insurance / COI",
  personal_guarantee: "Personal guarantee",
  payment: "Payment",
  other: "Other",
};

export const FAMILY_ROLE_LABELS: Record<FamilyRole, string> = {
  standalone: "Standalone",
  original: "Original",
  amendment: "Amendment",
  assignment: "Assignment",
  sublease: "Sublease",
  addendum: "Addendum",
  renewal: "Renewal",
  other: "Other",
};

export function obligationKindLabel(kind: string): string {
  return OBLIGATION_KIND_LABELS[kind as ObligationKind] || kind.replace(/_/g, " ");
}

export function familyRoleLabel(role?: string | null): string {
  if (!role) return "Standalone";
  return FAMILY_ROLE_LABELS[role as FamilyRole] || role;
}

export function formatIsoDate(value?: string | null): string {
  if (!value) return "—";
  return value.slice(0, 10);
}

export function obligationTone(
  due?: string | null,
  status?: ObligationStatus | string
): string {
  if (status === "done") return "bg-pass/10 text-pass";
  if (status === "dismissed") return "bg-wash text-ink-soft";
  if (!due) return "bg-wash text-ink-soft";
  const today = new Date().toISOString().slice(0, 10);
  if (due < today && status === "open") return "bg-fail/10 text-fail";
  const soon = new Date();
  soon.setUTCDate(soon.getUTCDate() + 14);
  if (due <= soon.toISOString().slice(0, 10)) return "bg-warn/10 text-warn";
  return "bg-accent/10 text-accent";
}
