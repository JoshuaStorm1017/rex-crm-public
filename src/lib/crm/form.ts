import { isDomainError } from "./errors";

export type ActionState = { error: string; code?: string } | null;

export function blank(
  value: FormDataEntryValue | null | undefined,
): string | undefined {
  if (value == null) return undefined;
  const text = String(value).trim();
  return text === "" ? undefined : text;
}

/**
 * For update forms. A field the form does not render is `undefined` (keep
 * the stored value); a rendered field left blank is `null` (clear it).
 */
export function clearable(
  formData: FormData,
  name: string,
): string | null | undefined {
  if (!formData.has(name)) return undefined;
  return blank(formData.get(name)) ?? null;
}

export function optionalInt(
  value: FormDataEntryValue | null | undefined,
): number | undefined {
  const text = blank(value);
  if (text == undefined) return undefined;
  const n = Number(text);
  return n;
}

export function formatError(error: unknown): string {
  if (error && typeof error === "object" && "issues" in error) {
    const issues = (error as { issues: { message: string }[] }).issues;
    if (Array.isArray(issues) && issues.length > 0) {
      return issues.map((issue) => issue.message).join(" ");
    }
  }
  if (error instanceof Error) return error.message;
  return "Something went wrong";
}

/** Action failure. Domain errors keep their code so a caller can see FORBIDDEN. */
export function actionError(error: unknown): { error: string; code?: string } {
  return {
    error: formatError(error),
    ...(isDomainError(error) ? { code: error.code } : {}),
  };
}
