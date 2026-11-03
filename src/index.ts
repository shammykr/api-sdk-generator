/** Programmatic API: everything the CLI does is available as plain functions. */
export { loadApiSpec, loadSpecFile, parseSpec, parseSpecText, validateSpec, SpecError } from "./parser/index.js";
export type * from "./parser/types.js";
export { generateSdk, resolveLanguage, LANGUAGES, type GeneratedFile, type Language } from "./generators/index.js";
export { writeFiles } from "./cli/output.js";
