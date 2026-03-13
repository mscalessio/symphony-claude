import path from "node:path";

/**
 * Sanitize an issue identifier to be safe as a directory name.
 * Replace any character not in [A-Za-z0-9._-] with underscore.
 */
export function sanitizeIdentifier(identifier: string): string {
  return identifier.replace(/[^A-Za-z0-9._-]/g, "_");
}

/**
 * Compute the workspace path for an issue under the workspace root.
 * Validates that the resolved path is contained within the root (no path traversal).
 * Throws if containment check fails.
 */
export function workspacePath(root: string, identifier: string): string {
  const sanitized = sanitizeIdentifier(identifier);
  const full = path.join(root, sanitized);
  const resolved = path.resolve(full);
  const resolvedRoot = path.resolve(root);
  if (!resolved.startsWith(resolvedRoot + path.sep) && resolved !== resolvedRoot) {
    throw new Error(`Workspace path traversal detected: ${resolved} is outside ${resolvedRoot}`);
  }
  return resolved;
}
