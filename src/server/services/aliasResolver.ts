import { normalizeTextForMatching } from "../../shared/textNormalization";

export function normalizeAlias(value: string): string {
  return normalizeTextForMatching(value).replace(/^(?:الدكتورة|الدكتور|دكتورة|دكتور|د|doctor|dr)\s+/, "");
}

export type AliasCandidate<T> = {
  id: string;
  aliases: string[];
  value: T;
};

export type AliasMatch<T> =
  | { status: "not_found" }
  | { status: "matched"; value: T }
  | { status: "ambiguous"; values: T[] };

export function resolveAlias<T>(query: string, candidates: AliasCandidate<T>[]): AliasMatch<T> {
  const normalizedQuery = normalizeAlias(query);
  if (!normalizedQuery) return { status: "not_found" };

  const matchingById = new Map<string, T>();
  for (const candidate of candidates) {
    if (candidate.aliases.some((alias) => normalizeAlias(alias) === normalizedQuery)) {
      matchingById.set(candidate.id, candidate.value);
    }
  }

  const values = [...matchingById.values()];
  if (values.length === 0) return { status: "not_found" };
  if (values.length === 1) return { status: "matched", value: values[0] };
  return { status: "ambiguous", values };
}
