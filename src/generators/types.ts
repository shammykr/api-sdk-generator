import type { ApiSpec } from "../parser/types.js";

export const LANGUAGES = ["typescript", "python"] as const;
export type Language = (typeof LANGUAGES)[number];

export interface GeneratedFile {
  /** Path relative to the output directory, always using "/" separators. */
  path: string;
  contents: string;
}

export interface Generator {
  language: Language;
  generate(spec: ApiSpec): GeneratedFile[];
}

/** Normalise generated text: LF line endings, no trailing spaces, one final newline. */
export function finalize(lines: string[]): string {
  return (
    lines
      .join("\n")
      .split("\n")
      .map((l) => l.replace(/[ \t]+$/, ""))
      .join("\n")
      .replace(/\n{3,}/g, "\n\n")
      .trimEnd() + "\n"
  );
}

/** Class name for the generated client, e.g. "Petstore API" -> "PetstoreApiClient". */
export function clientClassName(spec: ApiSpec, pascal: (s: string) => string): string {
  const base = pascal(spec.title).replace(/^_+/, "");
  if (!base) return "ApiClient";
  return base.endsWith("Client") ? base : `${base}Client`;
}
