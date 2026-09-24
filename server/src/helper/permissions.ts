import permissions from "../../config/permissions.json";

export function can(actorPermission: string, required: string): boolean {
  if (required === "public") return true;
  const matrix = permissions as Record<string, Record<string, boolean>>;
  return Boolean(matrix[actorPermission]?.[required]);
}
