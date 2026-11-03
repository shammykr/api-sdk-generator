import type { ApiSpec } from "../parser/types.js";
import { pythonGenerator } from "./python/index.js";
import type { GeneratedFile, Generator, Language } from "./types.js";
import { typescriptGenerator } from "./typescript/index.js";

export { LANGUAGES, type GeneratedFile, type Generator, type Language } from "./types.js";

const GENERATORS: Record<Language, Generator> = {
  typescript: typescriptGenerator,
  python: pythonGenerator,
};

const ALIASES: Record<string, Language> = { ts: "typescript", typescript: "typescript", py: "python", python: "python" };

/** Map user input ("ts", "Python", ...) to a supported language, or undefined. */
export function resolveLanguage(input: string): Language | undefined {
  return ALIASES[input.trim().toLowerCase()];
}

export const LANGUAGE_LABELS: Record<Language, string> = { typescript: "TypeScript", python: "Python" };

/** Generate every file of an SDK. Output is sorted by path, so it is byte-for-byte reproducible. */
export function generateSdk(spec: ApiSpec, language: Language): GeneratedFile[] {
  return GENERATORS[language]
    .generate(spec)
    .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}

