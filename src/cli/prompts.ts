import { input, select } from "@inquirer/prompts";
import { existsSync, statSync } from "node:fs";
import { LANGUAGES, LANGUAGE_LABELS, resolveLanguage, type Language } from "../generators/index.js";
import { SpecError } from "../parser/errors.js";

export interface GenerateOptions {
  input?: string;
  output?: string;
  lang?: string;
}

export interface ResolvedGenerateOptions {
  input: string;
  output: string;
  language: Language;
}

const defaultOutput = (language: Language) => (language === "python" ? "./sdk_python" : "./sdk-typescript");

/**
 * Fill in any missing generate options. In an interactive terminal the user
 * is prompted for each missing value; otherwise a clear error lists the flags.
 */
export async function resolveGenerateOptions(opts: GenerateOptions, interactive: boolean): Promise<ResolvedGenerateOptions> {
  let language: Language | undefined;
  if (opts.lang !== undefined) {
    language = resolveLanguage(opts.lang);
    if (!language) {
      throw new SpecError(`Unknown language "${opts.lang}".`, [], `Use one of: ${LANGUAGES.join(", ")} (or ts, py).`);
    }
  }

  const missing = [
    !opts.input && "--input <spec>",
    !language && "--lang <typescript|python>",
    !opts.output && "--output <dir>",
  ].filter(Boolean) as string[];
  if (missing.length && !interactive) {
    throw new SpecError(
      `Missing required option${missing.length > 1 ? "s" : ""}: ${missing.join(", ")}`,
      [],
      "Pass the flags, or run in an interactive terminal to be prompted.",
    );
  }

  const specPath =
    opts.input ??
    (await input({
      message: "Path to the OpenAPI spec (YAML or JSON):",
      validate: (value) => {
        const v = value.trim();
        if (!v) return "Please enter a path.";
        if (!existsSync(v)) return `File not found: ${v}`;
        if (!statSync(v).isFile()) return `Not a file: ${v}`;
        return true;
      },
    })).trim();

  language ??= await select<Language>({
    message: "Target language:",
    choices: LANGUAGES.map((value) => ({ value, name: LANGUAGE_LABELS[value] })),
  });

  const output =
    opts.output ??
    (await input({
      message: "Output directory:",
      default: defaultOutput(language),
      validate: (value) => (value.trim() ? true : "Please enter a directory."),
    })).trim();

  return { input: specPath, output, language };
}
