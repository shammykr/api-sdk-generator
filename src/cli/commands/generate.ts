import { relative } from "node:path";
import pc from "picocolors";
import { generateSdk, LANGUAGE_LABELS } from "../../generators/index.js";
import { loadApiSpec } from "../../parser/index.js";
import { printWarnings, writeFiles } from "../output.js";
import { resolveGenerateOptions, type GenerateOptions } from "../prompts.js";

export async function generateCommand(opts: GenerateOptions): Promise<void> {
  const interactive = Boolean(process.stdin.isTTY && process.stdout.isTTY);
  const { input, output, language } = await resolveGenerateOptions(opts, interactive);

  const spec = await loadApiSpec(input);
  printWarnings(spec.warnings);

  const files = generateSdk(spec, language);
  const written = await writeFiles(output, files);

  console.log(
    `${pc.green("✔")} Generated ${pc.bold(LANGUAGE_LABELS[language])} SDK for ${pc.bold(spec.title)} v${spec.version}` +
      ` (${spec.operations.length} endpoints, ${spec.models.length} models)`,
  );
  for (const file of written) console.log(`  ${pc.dim("→")} ${relative(process.cwd(), file) || file}`);
}
