import { loadSpecFile } from "./loader.js";
import { parseSpec } from "./parse.js";
import type { ApiSpec } from "./types.js";
import { validateSpec } from "./validator.js";

export { SpecError } from "./errors.js";
export { loadSpecFile, parseSpecText } from "./loader.js";
export { parseSpec } from "./parse.js";
export { validateSpec } from "./validator.js";
export type * from "./types.js";

/** Load, validate and parse a spec file into the IR in one call. */
export async function loadApiSpec(specPath: string): Promise<ApiSpec> {
  const raw = await loadSpecFile(specPath);
  const bundled = await validateSpec(raw, specPath);
  return parseSpec(bundled);
}
