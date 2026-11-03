import { mkdir, stat, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import pc from "picocolors";
import { SpecError } from "../parser/errors.js";
import type { TypeRef } from "../parser/types.js";
import type { GeneratedFile } from "../generators/types.js";

/** Write generated files under `outDir`, creating directories as needed. */
export async function writeFiles(outDir: string, files: GeneratedFile[]): Promise<string[]> {
  const root = resolve(outDir);
  const existing = await stat(root).catch(() => undefined);
  if (existing && !existing.isDirectory()) {
    throw new SpecError(`Output path exists and is not a directory: ${outDir}`);
  }
  const written: string[] = [];
  for (const file of files) {
    const target = join(root, ...file.path.split("/"));
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, file.contents, "utf8");
    written.push(target);
  }
  return written;
}

/** Compact, language-neutral type label used by `list` and `validate`. */
export function typeLabel(t: TypeRef): string {
  let s: string;
  switch (t.kind) {
    case "primitive":
      s = t.format ? `${t.name}<${t.format}>` : t.name;
      break;
    case "array": {
      const inner = typeLabel(t.items);
      s = t.items.kind === "union" || t.items.kind === "enum" || t.items.nullable ? `(${inner})[]` : `${inner}[]`;
      break;
    }
    case "map":
      s = `map<string, ${typeLabel(t.values)}>`;
      break;
    case "ref":
      s = t.name;
      break;
    case "enum":
      s = t.values.map((v) => JSON.stringify(v)).join(" | ");
      break;
    case "union":
      s = t.variants.map(typeLabel).join(" | ");
      break;
  }
  return t.nullable ? `${s} | null` : s;
}

export function printError(err: unknown): void {
  if (err instanceof SpecError) {
    const [first, ...rest] = err.format().split("\n");
    console.error(`${pc.red("✖")} ${pc.bold(first)}`);
    for (const line of rest) console.error(line.startsWith("Hint:") ? pc.cyan(line) : line);
  } else {
    console.error(`${pc.red("✖")} ${(err as Error)?.message ?? String(err)}`);
    if (process.env.DEBUG && err instanceof Error) console.error(err.stack);
  }
}

export function printWarnings(warnings: string[]): void {
  for (const w of warnings) console.warn(`${pc.yellow("!")} ${w}`);
}
