/** null/undefined = unrestricted. [] = match nobody. */
export type Allowlist<T> = "all" | "none" | T[];

export function allowlist<T>(values: readonly T[] | null | undefined): Allowlist<T> {
  if (values == null) return "all";
  if (values.length === 0) return "none";
  return [...values];
}
