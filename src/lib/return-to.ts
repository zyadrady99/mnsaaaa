// Preserve a local course path only; never accept an external redirect.
export function courseReturnTo(value: string | string[] | undefined) {
  if (typeof value !== "string") return undefined;
  const match = /^\/courses\/([a-z0-9-]+)$/.exec(value);
  return match ? value : undefined;
}
