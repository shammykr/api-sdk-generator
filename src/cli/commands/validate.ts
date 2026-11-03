import pc from "picocolors";
import { loadApiSpec } from "../../parser/index.js";
import { printWarnings } from "../output.js";

/** Validate a spec against the OpenAPI 3.x schema and report what was found. */
export async function validateCommand(specPath: string): Promise<void> {
  const spec = await loadApiSpec(specPath);
  printWarnings(spec.warnings);
  console.log(
    `${pc.green("✔")} ${specPath} is a valid OpenAPI ${spec.openapiVersion} document: ` +
      `${pc.bold(spec.title)} v${spec.version} — ${spec.operations.length} endpoints, ${spec.models.length} models.`,
  );
}
