/**
 * Identifier helpers shared by the parser and all generators.
 * Every function here is pure so code generation stays deterministic.
 */

/** Split an arbitrary string into lowercase-able words ("petId" -> ["pet", "Id"]). */
export function splitWords(input: string): string[] {
  return input
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean);
}

export function pascalCase(input: string): string {
  const name = splitWords(input)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join("");
  return /^[0-9]/.test(name) ? `_${name}` : name;
}

export function camelCase(input: string): string {
  const pascal = pascalCase(input);
  if (pascal.startsWith("_")) return pascal;
  return pascal.charAt(0).toLowerCase() + pascal.slice(1);
}

export function snakeCase(input: string): string {
  const name = splitWords(input)
    .map((w) => w.toLowerCase())
    .join("_");
  return /^[0-9]/.test(name) ? `_${name}` : name;
}

export function upperSnakeCase(input: string): string {
  return snakeCase(input).toUpperCase();
}

/** Is `name` usable as a bare JavaScript property key / identifier? */
export function isValidJsIdentifier(name: string): boolean {
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(name);
}

/** Fallback operation name when a spec omits operationId: GET /pets/{petId} -> getPetsByPetId */
export function operationNameFromPath(method: string, path: string): string {
  const parts = path
    .split("/")
    .filter(Boolean)
    .map((segment) => {
      const param = segment.match(/^\{(.+)\}$/);
      return param ? `By ${param[1]}` : segment;
    });
  return camelCase(`${method} ${parts.join(" ")}`) || method.toLowerCase();
}

/** Return `base`, or `base2`, `base3`, ... — the first one not already in `taken`. */
export function uniqueName(base: string, taken: Set<string>): string {
  let candidate = base;
  let n = 2;
  while (taken.has(candidate)) candidate = `${base}${n++}`;
  return candidate;
}
