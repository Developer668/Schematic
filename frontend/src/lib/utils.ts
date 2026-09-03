export type ClassValue = string | false | null | undefined;

/** Small dependency-free class combiner for local shadcn-style components. */
export function cn(...values: ClassValue[]) {
  return values.filter(Boolean).join(" ");
}
