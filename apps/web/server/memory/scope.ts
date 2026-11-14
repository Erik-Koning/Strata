// The filter for one scope's memories: its organisation and person, in this project or in every project ("*").
import type { Scope } from "@strata/contracts";

export const ALL_PROJECTS = "*";

export function scopeFilter(scope: Scope): Record<string, unknown> {
  return { "scope.org": scope.org, "scope.user": scope.user, "scope.project": { $in: [scope.project, ALL_PROJECTS] } };
}
