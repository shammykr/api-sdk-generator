import pc from "picocolors";
import { loadApiSpec } from "../../parser/index.js";
import type { Operation } from "../../parser/types.js";
import { printWarnings, typeLabel } from "../output.js";

export interface ListOptions {
  json?: boolean;
}

const METHOD_COLORS: Record<string, (s: string) => string> = {
  GET: pc.green,
  POST: pc.yellow,
  PUT: pc.blue,
  PATCH: pc.cyan,
  DELETE: pc.red,
};

/** Endpoint discovery: print every operation with its parameters and types. */
export async function listCommand(specPath: string, opts: ListOptions): Promise<void> {
  const spec = await loadApiSpec(specPath);

  if (opts.json) {
    console.log(JSON.stringify(spec.operations.map(toJson), null, 2));
    return;
  }

  printWarnings(spec.warnings);
  console.log(`${pc.bold(spec.title)} v${spec.version} — ${spec.operations.length} endpoint(s)\n`);
  const methodWidth = Math.max(...spec.operations.map((o) => o.method.length), 6);
  const pathWidth = Math.max(...spec.operations.map((o) => o.path.length), 4);

  for (const op of spec.operations) {
    const method = op.method.toUpperCase();
    const color = METHOD_COLORS[method] ?? ((s: string) => s);
    const returns = op.successType ? typeLabel(op.successType) : "void";
    console.log(
      `${color(method.padEnd(methodWidth))}  ${op.path.padEnd(pathWidth)}  ${pc.bold(op.id)}` +
        `${op.deprecated ? pc.dim(" (deprecated)") : ""}  ${pc.dim("→")} ${returns}`,
    );
    if (op.summary) console.log(`${" ".repeat(methodWidth + 2)}${pc.dim(op.summary)}`);
    const nameWidth = Math.max(0, ...op.parameters.map((p) => p.name.length + (p.required ? 0 : 1)));
    for (const p of op.parameters) {
      const name = `${p.name}${p.required ? "" : "?"}`.padEnd(nameWidth);
      console.log(`${" ".repeat(methodWidth + 2)}${pc.dim(p.in.padEnd(6))}  ${name}  ${typeLabel(p.type)}`);
    }
    if (op.requestBody) {
      const b = op.requestBody;
      console.log(
        `${" ".repeat(methodWidth + 2)}${pc.dim("body".padEnd(6))}  ${typeLabel(b.type)}${b.required ? "" : pc.dim(" (optional)")} ${pc.dim(b.contentType)}`,
      );
    }
    console.log("");
  }
}

function toJson(op: Operation) {
  return {
    operationId: op.id,
    method: op.method.toUpperCase(),
    path: op.path,
    summary: op.summary,
    tags: op.tags,
    deprecated: op.deprecated,
    parameters: op.parameters.map((p) => ({ name: p.name, in: p.in, required: p.required, type: typeLabel(p.type) })),
    requestBody: op.requestBody
      ? { contentType: op.requestBody.contentType, required: op.requestBody.required, type: typeLabel(op.requestBody.type) }
      : undefined,
    responses: op.responses.map((r) => ({ status: r.status, type: r.type ? typeLabel(r.type) : undefined })),
  };
}
