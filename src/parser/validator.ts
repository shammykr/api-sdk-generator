import SwaggerParser from "@apidevtools/swagger-parser";
import { resolve } from "node:path";
import { SpecError } from "./errors.js";
import type { RawDocument } from "./loader.js";

interface AjvIssue {
  instancePath?: string;
  keyword?: string;
  message?: string;
  params?: Record<string, unknown>;
}

type BundleFn = (path: string, api: RawDocument, options: object) => Promise<RawDocument>;

/**
 * Validate a parsed document against the OpenAPI 3.x JSON schema and check
 * every $ref resolves. External $refs (other files) are bundled into the
 * document so the parser only ever has to follow internal references.
 *
 * Returns the bundled document; throws SpecError with one line per problem.
 */
export async function validateSpec(doc: RawDocument, specPath: string): Promise<RawDocument> {
  checkVersion(doc);

  let bundled: RawDocument;
  try {
    const bundle = SwaggerParser.bundle as unknown as BundleFn;
    bundled = await bundle(resolve(specPath), structuredClone(doc), {});
  } catch (err) {
    throw new SpecError(`Could not resolve references in ${specPath}`, [cleanMessage(err)]);
  }

  try {
    // validate() dereferences in place, so give it a throwaway copy.
    await SwaggerParser.validate(structuredClone(bundled) as never);
  } catch (err) {
    throw new SpecError(
      `${specPath} is not a valid OpenAPI ${String(doc.openapi)} document`,
      formatIssues(err),
    );
  }
  return bundled;
}

function checkVersion(doc: RawDocument): void {
  if (typeof doc.swagger === "string") {
    throw new SpecError(
      `Swagger ${doc.swagger} documents are not supported; this tool targets OpenAPI 3.x.`,
      [],
      "Convert the file first, e.g. `npx swagger2openapi spec.yaml -o openapi.yaml`.",
    );
  }
  if (typeof doc.openapi !== "string") {
    throw new SpecError(
      "Missing `openapi` version field.",
      [],
      'Add e.g. `openapi: "3.0.3"` at the top of the document.',
    );
  }
  if (!/^3\.[01]\.\d+$/.test(doc.openapi)) {
    throw new SpecError(`Unsupported OpenAPI version "${doc.openapi}". Supported: 3.0.x and 3.1.x.`);
  }
}

/** Turn ajv's JSON-pointer issues into readable lines and drop oneOf noise. */
function formatIssues(err: unknown): string[] {
  const details = (err as { details?: AjvIssue[] }).details;
  if (!Array.isArray(details) || details.length === 0) return [cleanMessage(err)];

  const isNoise = (i: AjvIssue) =>
    i.keyword === "oneOf" ||
    i.keyword === "anyOf" ||
    i.keyword === "if" ||
    (i.keyword === "required" && i.params?.missingProperty === "$ref");
  const useful = details.filter((i) => !isNoise(i));
  const issues = useful.length > 0 ? useful : details;

  const lines = issues.map((i) => {
    let msg = i.message ?? "is invalid";
    if (i.keyword === "additionalProperties" && i.params?.additionalProperty) {
      msg = `has unknown property "${String(i.params.additionalProperty)}"`;
    } else if (i.keyword === "enum" && Array.isArray(i.params?.allowedValues)) {
      msg = `must be one of: ${(i.params.allowedValues as unknown[]).join(", ")}`;
    }
    return `${pointerToPath(i.instancePath ?? "")} ${msg}`;
  });
  return [...new Set(lines)];
}

/** "/paths/~1pets/get" -> 'paths["/pets"].get' */
function pointerToPath(pointer: string): string {
  if (!pointer) return "(document root)";
  return pointer
    .split("/")
    .slice(1)
    .map((seg) => seg.replace(/~1/g, "/").replace(/~0/g, "~"))
    .reduce((acc, seg) => {
      if (/^[A-Za-z_$][\w$]*$/.test(seg)) return acc ? `${acc}.${seg}` : seg;
      return `${acc}[${JSON.stringify(seg)}]`;
    }, "");
}

function cleanMessage(err: unknown): string {
  return (err instanceof Error ? err.message : String(err)).split("\n")[0];
}
