import { SpecError } from "./errors.js";
import type { RawDocument } from "./loader.js";
import type {
  ApiSpec,
  EnumValue,
  HttpMethod,
  Model,
  Operation,
  Parameter,
  ParameterLocation,
  Property,
  RequestBody,
  Response,
  TypeRef,
} from "./types.js";
import { camelCase, operationNameFromPath, pascalCase, uniqueName } from "../utils/naming.js";

type Schema = Record<string, unknown>;

const HTTP_METHODS: readonly HttpMethod[] = ["get", "put", "post", "delete", "options", "head", "patch", "trace"];

/**
 * Model names that would shadow built-ins in at least one target language
 * (TypeScript globals, Python typing/pydantic names, or generated runtime names).
 */
const RESERVED_MODEL_NAMES = new Set([
  "Array", "Boolean", "Date", "Number", "Object", "Promise", "Record", "String", "Symbol",
  "Any", "BaseModel", "ConfigDict", "Dict", "Enum", "Field", "List", "Literal", "Optional", "Union",
  "ApiError", "Client", "ClientOptions",
]);

const COMPONENT_SCHEMA_PREFIX = "#/components/schemas/";

const asSchema = (v: unknown): Schema | undefined =>
  v !== null && typeof v === "object" && !Array.isArray(v) ? (v as Schema) : undefined;

/**
 * Convert a validated (and bundled) OpenAPI 3.x document into the IR.
 *
 * Determinism: traversal follows the document's own key order, generated
 * names are derived purely from that order, and models are sorted by name at
 * the end. No timestamps, random values or environment data are involved.
 */
export function parseSpec(doc: RawDocument): ApiSpec {
  return new SpecParser(doc).run();
}

class SpecParser {
  private readonly models = new Map<string, Model>();
  private readonly takenModelNames = new Set<string>();
  private readonly componentModelNames = new Map<string, string>();
  private readonly refCache = new Map<string, TypeRef>();
  private readonly warnings: string[] = [];

  constructor(private readonly doc: RawDocument) {}

  run(): ApiSpec {
    const info = asSchema(this.doc.info) ?? {};
    const schemas = asSchema(asSchema(this.doc.components)?.schemas) ?? {};

    // Reserve names for every component first so forward/recursive refs resolve.
    for (const key of Object.keys(schemas)) {
      this.componentModelNames.set(key, this.reserveModelName(key));
    }
    for (const [key, schema] of Object.entries(schemas)) {
      this.defineModel(this.componentModelNames.get(key)!, asSchema(schema) ?? {});
    }

    const operations = this.parseOperations();
    const models = [...this.models.values()].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));

    return {
      title: typeof info.title === "string" ? info.title : "API",
      version: typeof info.version === "string" ? info.version : "0.0.0",
      description: typeof info.description === "string" ? info.description : undefined,
      openapiVersion: String(this.doc.openapi),
      baseUrl: this.baseUrl(),
      models,
      operations,
      warnings: this.warnings,
    };
  }

  // ---------------------------------------------------------------- models

  private reserveModelName(raw: string): string {
    let name = pascalCase(raw) || "Model";
    if (RESERVED_MODEL_NAMES.has(name)) name += "Model";
    name = uniqueName(name, this.takenModelNames);
    this.takenModelNames.add(name);
    return name;
  }

  private defineModel(name: string, schema: Schema): void {
    const description = describe(schema);
    const enumValues = this.enumValues(schema);
    if (enumValues && !schema.oneOf && !schema.anyOf) {
      this.models.set(name, { kind: "enum", name, description, values: enumValues.values });
      return;
    }
    if (this.isObjectLike(schema) && !schema.$ref) {
      this.models.set(name, this.buildObject(name, schema, description));
      return;
    }
    // Register a placeholder before recursing so self-references terminate.
    this.models.set(name, { kind: "alias", name, description, type: { kind: "primitive", name: "unknown" } });
    this.models.set(name, { kind: "alias", name, description, type: this.toType(schema, `${name} Value`, true) });
  }

  private buildObject(name: string, schema: Schema, description?: string): Model {
    const props = new Map<string, Schema>();
    const required = new Set<string>();
    let additional: unknown;
    const collect = (s: Schema, seen: Set<string>) => {
      if (typeof s.$ref === "string") {
        if (seen.has(s.$ref)) return;
        seen.add(s.$ref);
        collect(this.resolvePointer(s.$ref), seen);
        return;
      }
      for (const member of (Array.isArray(s.allOf) ? s.allOf : []) as unknown[]) {
        collect(asSchema(member) ?? {}, seen);
      }
      for (const [k, v] of Object.entries(asSchema(s.properties) ?? {})) props.set(k, asSchema(v) ?? {});
      if (Array.isArray(s.required)) for (const r of s.required) required.add(String(r));
      if (s.additionalProperties !== undefined) additional = s.additionalProperties;
    };
    collect(schema, new Set());

    // Register before converting properties so recursive types work.
    const model: Model = { kind: "object", name, description, properties: [] };
    this.models.set(name, model);

    const properties: Property[] = [];
    for (const [propName, propSchema] of props) {
      properties.push({
        name: propName,
        type: this.toType(propSchema, `${name} ${propName}`),
        required: required.has(propName),
        description: describe(propSchema),
      });
    }
    model.properties = properties;
    if (additional === true || (asSchema(additional) && Object.keys(additional as Schema).length === 0)) {
      model.additionalProperties = { kind: "primitive", name: "unknown" };
    } else if (asSchema(additional)) {
      model.additionalProperties = this.toType(additional as Schema, `${name} Value`);
    }
    return model;
  }

  private isObjectLike(schema: Schema): boolean {
    if (schema.oneOf || schema.anyOf || schema.enum) return false;
    if (Array.isArray(schema.allOf)) return this.allOfIsObject(schema);
    return !!schema.properties;
  }

  private allOfIsObject(schema: Schema): boolean {
    if (schema.properties) return true;
    return (schema.allOf as unknown[]).some((m) => {
      const s = asSchema(m) ?? {};
      const target = typeof s.$ref === "string" ? this.resolvePointer(s.$ref) : s;
      return !!target.properties || !!target.allOf || primitiveTypes(target).includes("object");
    });
  }

  private enumValues(schema: Schema): { values: EnumValue[]; nullable: boolean } | undefined {
    const raw = schema.enum ?? (schema.const !== undefined ? [schema.const] : undefined);
    if (!Array.isArray(raw)) return undefined;
    const values = raw.filter(
      (v): v is EnumValue => typeof v === "string" || typeof v === "number" || typeof v === "boolean",
    );
    return { values, nullable: raw.includes(null) };
  }

  /** Hoist an inline schema into a named model and return a reference to it. */
  private hoist(hint: string, schema: Schema): TypeRef {
    const title = typeof schema.title === "string" ? schema.title : undefined;
    const name = this.reserveModelName(title && !this.takenModelNames.has(pascalCase(title)) ? title : hint);
    this.defineModel(name, schema);
    return { kind: "ref", name };
  }

  // ----------------------------------------------------------------- types

  /**
   * Convert a schema to a TypeRef. Inline objects are hoisted into named
   * models (named after `hint`) so that every target language can declare them.
   */
  private toType(schemaIn: unknown, hint: string, isModelRoot = false): TypeRef {
    const schema = asSchema(schemaIn);
    if (!schema) return { kind: "primitive", name: "unknown" };

    if (typeof schema.$ref === "string") return this.refType(schema.$ref, hint);

    const types = primitiveTypes(schema);
    let nullable = schema.nullable === true || types.includes("null");
    const nonNull = types.filter((t) => t !== "null");
    let result: TypeRef;

    const enumInfo = this.enumValues(schema);
    const unionMembers = (schema.oneOf ?? schema.anyOf) as unknown[] | undefined;

    if (Array.isArray(unionMembers)) {
      const variants: TypeRef[] = [];
      unionMembers.forEach((member, i) => {
        const m = asSchema(member) ?? {};
        if (primitiveTypes(m).length === 1 && primitiveTypes(m)[0] === "null") {
          nullable = true;
          return;
        }
        variants.push(this.toType(m, `${hint} Option ${i + 1}`));
      });
      const mode = schema.oneOf ? "oneOf" : "anyOf";
      result = variants.length === 1 ? variants[0] : { kind: "union", variants: dedupe(variants), mode };
    } else if (enumInfo) {
      nullable ||= enumInfo.nullable;
      result = { kind: "enum", values: enumInfo.values };
    } else if (Array.isArray(schema.allOf) && schema.allOf.length === 1 && !schema.properties) {
      result = this.toType(schema.allOf[0], hint);
    } else if (this.isObjectLike(schema)) {
      if (isModelRoot) throw new Error("unreachable: object roots are handled by defineModel");
      result = this.hoist(hint, schema);
    } else if (nonNull.length > 1) {
      result = {
        kind: "union",
        mode: "anyOf",
        variants: nonNull.map((t) => this.toType({ ...schema, type: t, nullable: false }, hint)),
      };
    } else {
      const t = nonNull[0] ?? (schema.properties ? "object" : schema.items ? "array" : undefined);
      switch (t) {
        case "array":
          result = { kind: "array", items: this.toType(schema.items, `${hint} Item`) };
          break;
        case "object": {
          const ap = schema.additionalProperties;
          result = {
            kind: "map",
            values: asSchema(ap) && Object.keys(ap as Schema).length > 0
              ? this.toType(ap, `${hint} Value`)
              : { kind: "primitive", name: "unknown" },
          };
          break;
        }
        case "string":
        case "integer":
        case "number":
        case "boolean":
          result = { kind: "primitive", name: t, ...(typeof schema.format === "string" ? { format: schema.format } : {}) };
          break;
        case "null":
          result = { kind: "primitive", name: "null" };
          nullable = false;
          break;
        default:
          result = { kind: "primitive", name: "unknown" };
      }
    }
    return nullable ? { ...result, nullable: true } : result;
  }

  private refType(ref: string, hint: string): TypeRef {
    if (ref.startsWith(COMPONENT_SCHEMA_PREFIX)) {
      const key = decodePointerSegment(ref.slice(COMPONENT_SCHEMA_PREFIX.length));
      const name = this.componentModelNames.get(key);
      if (name) return { kind: "ref", name };
    }
    const cached = this.refCache.get(ref);
    if (cached) return cached;

    // A ref to some other location (e.g. produced by bundling external files).
    const target = this.resolvePointer(ref);
    const lastSegment = decodePointerSegment(ref.split("/").pop() ?? "");
    if (this.isObjectLike(target) || this.enumValues(target)) {
      const name = this.reserveModelName(/^[A-Za-z]/.test(lastSegment) ? lastSegment : hint);
      const t: TypeRef = { kind: "ref", name };
      this.refCache.set(ref, t);
      this.defineModel(name, target);
      return t;
    }
    const t = this.toType(target, hint);
    this.refCache.set(ref, t);
    return t;
  }

  private resolvePointer(ref: string): Schema {
    if (!ref.startsWith("#")) {
      throw new SpecError(`Unresolved external reference "${ref}".`);
    }
    let node: unknown = this.doc;
    for (const raw of ref.slice(1).split("/").filter(Boolean)) {
      node = asSchema(node)?.[decodePointerSegment(raw)];
      if (node === undefined) throw new SpecError(`Reference "${ref}" does not point to anything.`);
    }
    return asSchema(node) ?? {};
  }

  /** Follow $ref for parameters, request bodies and responses. */
  private deref(value: unknown): Schema {
    let s = asSchema(value) ?? {};
    const seen = new Set<string>();
    while (typeof s.$ref === "string" && !seen.has(s.$ref)) {
      seen.add(s.$ref);
      s = this.resolvePointer(s.$ref);
    }
    return s;
  }

  // ------------------------------------------------------------ operations

  private parseOperations(): Operation[] {
    const operations: Operation[] = [];
    const takenIds = new Set<string>();

    for (const [path, rawItem] of Object.entries(asSchema(this.doc.paths) ?? {})) {
      const item = this.deref(rawItem);
      const sharedParams = Array.isArray(item.parameters) ? item.parameters : [];

      for (const [key, rawOp] of Object.entries(item)) {
        if (!HTTP_METHODS.includes(key as HttpMethod)) continue;
        const method = key as HttpMethod;
        const op = asSchema(rawOp) ?? {};

        const baseId = typeof op.operationId === "string" && op.operationId.trim()
          ? camelCase(op.operationId)
          : operationNameFromPath(method, path);
        const id = uniqueName(baseId || method, takenIds);
        takenIds.add(id);
        const hint = pascalCase(id);

        const parameters = this.parseParameters(
          [...sharedParams, ...(Array.isArray(op.parameters) ? op.parameters : [])],
          hint,
          `${method.toUpperCase()} ${path}`,
        );
        const requestBody = this.parseRequestBody(op.requestBody, hint, `${method.toUpperCase()} ${path}`);
        const responses = this.parseResponses(op.responses, hint);

        const success = responses
          .filter((r) => /^2/.test(r.status))
          .sort((a, b) => (a.status < b.status ? -1 : 1))
          .find((r) => r.type);
        const errorTypes = dedupe(
          responses.filter((r) => !/^2/.test(r.status) && r.type).map((r) => r.type as TypeRef),
        );

        operations.push({
          id,
          method,
          path,
          summary: typeof op.summary === "string" ? op.summary.trim() : undefined,
          description: typeof op.description === "string" ? op.description.trim() : undefined,
          tags: Array.isArray(op.tags) ? op.tags.map(String) : [],
          deprecated: op.deprecated === true,
          parameters,
          requestBody,
          responses,
          successType: success?.type,
          errorTypes,
        });
      }
    }
    return operations;
  }

  private parseParameters(raw: unknown[], hint: string, where: string): Parameter[] {
    const byKey = new Map<string, Parameter>();
    for (const entry of raw) {
      const p = this.deref(entry);
      const location = p.in as string;
      const name = String(p.name);
      if (location === "cookie") {
        this.warnings.push(`${where}: cookie parameter "${name}" is not supported and was skipped.`);
        continue;
      }
      const schema = p.schema ?? firstMediaSchema(p.content);
      byKey.set(`${location}:${name}`, {
        name,
        in: location as ParameterLocation,
        required: location === "path" ? true : p.required === true,
        type: this.toType(schema, `${hint} ${name}`),
        description: describe(p),
      });
    }
    // Path params first (in URL order), then required, then optional.
    return [...byKey.values()].sort((a, b) => rank(a) - rank(b));
  }

  private parseRequestBody(raw: unknown, hint: string, where: string): RequestBody | undefined {
    if (raw === undefined) return undefined;
    const body = this.deref(raw);
    const content = asSchema(body.content) ?? {};
    const contentType = pickMediaType(Object.keys(content));
    if (!contentType) return undefined;
    const json = isJsonMediaType(contentType);
    if (!json) {
      this.warnings.push(`${where}: request body "${contentType}" is passed through as-is (untyped).`);
    }
    return {
      contentType,
      required: body.required === true,
      type: json
        ? this.toType(asSchema(content[contentType])?.schema, `${hint} Request`)
        : { kind: "primitive", name: "unknown" },
      description: describe(body),
    };
  }

  private parseResponses(raw: unknown, hint: string): Response[] {
    const responses: Response[] = [];
    for (const [status, value] of Object.entries(asSchema(raw) ?? {})) {
      const resp = this.deref(value);
      const content = asSchema(resp.content) ?? {};
      const contentType = pickMediaType(Object.keys(content));
      let type: TypeRef | undefined;
      if (contentType) {
        const schema = asSchema(content[contentType])?.schema;
        const suffix = /^2/.test(status) ? "Response" : `${status === "default" ? "Default" : status} Response`;
        type = schema
          ? this.toType(schema, `${hint} ${suffix}`)
          : { kind: "primitive", name: isJsonMediaType(contentType) ? "unknown" : "string" };
      }
      responses.push({
        status,
        description: typeof resp.description === "string" ? resp.description.trim() : "",
        contentType,
        type,
      });
    }
    return responses;
  }

  private baseUrl(): string {
    const server = asSchema((this.doc.servers as unknown[] | undefined)?.[0]);
    if (!server || typeof server.url !== "string") return "";
    const vars = asSchema(server.variables) ?? {};
    return server.url.replace(/\{([^}]+)\}/g, (match, name: string) => {
      const def = asSchema(vars[name])?.default;
      return def !== undefined ? String(def) : match;
    });
  }
}

// ------------------------------------------------------------------ helpers

function primitiveTypes(schema: Schema): string[] {
  if (Array.isArray(schema.type)) return schema.type.map(String);
  return typeof schema.type === "string" ? [schema.type] : [];
}

function describe(schema: Schema): string | undefined {
  const d = schema.description;
  return typeof d === "string" && d.trim() ? d.trim() : undefined;
}

function decodePointerSegment(seg: string): string {
  return decodeURIComponent(seg).replace(/~1/g, "/").replace(/~0/g, "~");
}

function isJsonMediaType(mediaType: string): boolean {
  return /^application\/json\b/.test(mediaType) || /\+json\b/.test(mediaType);
}

function pickMediaType(types: string[]): string | undefined {
  return types.find((t) => t === "application/json") ?? types.find(isJsonMediaType) ?? types[0];
}

function firstMediaSchema(content: unknown): unknown {
  const c = asSchema(content) ?? {};
  const t = pickMediaType(Object.keys(c));
  return t ? asSchema(c[t])?.schema : undefined;
}

function rank(p: Parameter): number {
  if (p.in === "path") return 0;
  return p.required ? 1 : 2;
}

function dedupe(types: TypeRef[]): TypeRef[] {
  const seen = new Set<string>();
  return types.filter((t) => {
    const key = JSON.stringify(t);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
