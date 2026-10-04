import path from "node:path";
import { fileURLToPath } from "node:url";

export const projectRoot = fileURLToPath(new URL("../../", import.meta.url));

export function projectPath(...segments) {
  return path.join(projectRoot, ...segments);
}
