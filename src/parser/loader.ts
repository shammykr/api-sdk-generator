import { readFile } from "node:fs/promises";
import { extname, resolve } from "node:path";
import { parseDocument } from "yaml";
import { SpecError } from "./errors.js";

export type RawDocument = Record<string, unknown>;

/**
 * Read a spec file from disk and parse it as JSON or YAML.
 * Syntax errors are reported with the file name and line/column.
 */
export async function loadSpecFile(specPath: string): Promise<RawDocument> {
  const absPath = resolve(specPath);
  let text: string;
  try {
    text = await readFile(absPath, "utf8");
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT") throw new SpecError(`Spec file not found: ${specPath}`);
    if (code === "EISDIR") throw new SpecError(`Expected a file but got a directory: ${specPath}`);
    throw new SpecError(`Could not read spec file ${specPath}: ${(err as Error).message}`);
  }
  return parseSpecText(text, specPath, extname(absPath).toLowerCase() === ".json");
}

export function parseSpecText(text: string, source: string, isJson: boolean): RawDocument {
  let value: unknown;
  if (isJson) {
    try {
      value = JSON.parse(text);
    } catch (err) {
      throw new SpecError(`Invalid JSON in ${source}`, [(err as Error).message]);
    }
  } else {
    // YAML is a superset of JSON, so this also accepts JSON in .yaml/.yml/unknown files.
    const doc = parseDocument(text, { prettyErrors: true });
    if (doc.errors.length > 0) {
      throw new SpecError(
        `Invalid YAML in ${source}`,
        doc.errors.map((e) => e.message.split("\n")[0].replace(/:$/, "")),
      );
    }
    value = doc.toJS({ maxAliasCount: -1 });
  }
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new SpecError(`${source} does not contain an OpenAPI document (expected a top-level object).`);
  }
  return value as RawDocument;
}
