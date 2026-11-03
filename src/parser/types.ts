/**
 * Language-neutral intermediate representation (IR) of an OpenAPI document.
 * The parser produces it; every generator consumes it. Generators never look
 * at the raw spec, which keeps them small and keeps output deterministic.
 */

export type PrimitiveName = "string" | "integer" | "number" | "boolean" | "null" | "unknown";

export type TypeRef =
  | { kind: "primitive"; name: PrimitiveName; format?: string; nullable?: boolean }
  | { kind: "array"; items: TypeRef; nullable?: boolean }
  | { kind: "map"; values: TypeRef; nullable?: boolean }
  /** Reference to a named model in `ApiSpec.models`. */
  | { kind: "ref"; name: string; nullable?: boolean }
  /** Inline enum (named enums become models). */
  | { kind: "enum"; values: EnumValue[]; nullable?: boolean }
  /** oneOf / anyOf. */
  | { kind: "union"; variants: TypeRef[]; mode: "oneOf" | "anyOf"; nullable?: boolean };

export type EnumValue = string | number | boolean;

export interface Property {
  /** Name exactly as it appears on the wire. */
  name: string;
  type: TypeRef;
  required: boolean;
  description?: string;
}

export type Model =
  | {
      kind: "object";
      name: string;
      description?: string;
      properties: Property[];
      /** Type of additionalProperties, when the object also allows extra keys. */
      additionalProperties?: TypeRef;
    }
  | { kind: "enum"; name: string; description?: string; values: EnumValue[] }
  /** Named alias for any other type: unions, arrays, primitives... */
  | { kind: "alias"; name: string; description?: string; type: TypeRef };

export type ParameterLocation = "path" | "query" | "header";

export interface Parameter {
  name: string;
  in: ParameterLocation;
  required: boolean;
  type: TypeRef;
  description?: string;
}

export interface RequestBody {
  contentType: string;
  required: boolean;
  type: TypeRef;
  description?: string;
}

export interface Response {
  /** "200", "404", "default", ... */
  status: string;
  description: string;
  contentType?: string;
  type?: TypeRef;
}

export type HttpMethod = "get" | "put" | "post" | "delete" | "options" | "head" | "patch" | "trace";

export interface Operation {
  /** Stable, unique identifier (operationId or derived from method + path). */
  id: string;
  method: HttpMethod;
  path: string;
  summary?: string;
  description?: string;
  tags: string[];
  deprecated: boolean;
  parameters: Parameter[];
  requestBody?: RequestBody;
  responses: Response[];
  /** Type returned on success (lowest 2xx response), undefined = no body. */
  successType?: TypeRef;
  /** Distinct body types of non-2xx responses. */
  errorTypes: TypeRef[];
}

export interface ApiSpec {
  title: string;
  version: string;
  description?: string;
  openapiVersion: string;
  /** Default base URL taken from servers[0], with variables substituted. */
  baseUrl: string;
  models: Model[];
  operations: Operation[];
  warnings: string[];
}
