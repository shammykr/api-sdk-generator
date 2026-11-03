# API SDK Generator

[![CI](https://github.com/shammykr/api-sdk-generator/actions/workflows/ci.yml/badge.svg)](https://github.com/shammykr/api-sdk-generator/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

An open-source CLI that parses **OpenAPI 3.x** specs (YAML or JSON) and generates **strongly typed API client SDKs** for **TypeScript** and **Python**.

Point it at a spec and you get a ready-to-use client library: typed request parameters, typed response bodies, typed error bodies, and a markdown API reference to go with it.

```bash
npx @shammykr/api-sdk-generator generate -i openapi.yaml -l typescript -o ./sdk
```

## Features

- **OpenAPI 3.0 and 3.1 parsing**, YAML or JSON: endpoints, parameters, request and response schemas, enums, `oneOf`/`anyOf` unions, `allOf` composition, maps and nested objects. External `$ref` files are bundled automatically.
- **Spec validation before generation**: the spec is checked against the OpenAPI 3.x schema and every `$ref` must resolve. Problems are reported as readable paths (`paths["/pets"].get.responses["200"].description must be string`), not raw JSON pointers.
- **TypeScript SDK**: a dependency-free `fetch` client with interfaces for every schema, a typed `Params` interface per endpoint, typed return values, and `ApiError<T>` typed with each endpoint's documented error schemas.
- **Python SDK**: Pydantic v2 models, `Enum` classes and type aliases, plus an `httpx` client with full type hints. Responses are validated into models, and error bodies are parsed into their documented types.
- **Nested types, enums and unions**: inline nested objects are hoisted into named types (`Pet.medical` becomes `PetMedical`). Enums become literal unions in TypeScript and `Enum`/`Literal` in Python. `oneOf`/`anyOf` become `A | B` and `Union[A, B]`.
- **Deterministic output**: the same spec always produces byte-identical files. There are no timestamps, ordering is stable, and line endings are normalised.
- **Endpoint discovery**: `list` prints every endpoint with its method, path, parameters and types (`--json` for scripts).
- **Interactive prompts**: run it without flags and it asks for the spec path, target language and output directory.
- **API reference docs**: each SDK ships with an `API.md` listing every endpoint, its parameters, request body, responses and an example call, written in that SDK's language.

## Install

```bash
# one-off, no install
npx @shammykr/api-sdk-generator --help

# or globally
npm install -g @shammykr/api-sdk-generator
api-sdk-generator --help
```

Requires Node.js 20 or newer.

## Usage

### Generate an SDK

```bash
api-sdk-generator generate --input examples/petstore.yaml --lang typescript --output ./petstore-sdk
api-sdk-generator generate -i examples/petstore.yaml -l py -o ./petstore_sdk
```

| Flag | Description |
| --- | --- |
| `-i, --input <spec>` | Path to the OpenAPI spec (`.yaml`, `.yml` or `.json`) |
| `-l, --lang <language>` | `typescript` or `python` (aliases `ts`, `py`) |
| `-o, --output <dir>` | Directory to write the SDK into (created if missing) |

`generate` is the default command. If any flag is missing and you are in a terminal, you are prompted for it:

```text
$ npx @shammykr/api-sdk-generator
✔ Path to the OpenAPI spec (YAML or JSON): examples/petstore.yaml
✔ Target language: Python
✔ Output directory: ./sdk_python
✔ Generated Python SDK for Petstore API v1.2.0 (8 endpoints, 20 models)
  → sdk_python/API.md
  → sdk_python/__init__.py
  → sdk_python/client.py
  → sdk_python/models.py
  → sdk_python/requirements.txt
```

In CI or another non-interactive shell, missing flags produce an error that names them.

### List endpoints

```text
$ api-sdk-generator list examples/petstore.yaml
Petstore API v1.2.0 — 8 endpoint(s)

GET     /pets              listPets  → PetPage
        List pets
        query   limit?    integer
        query   cursor?   string
        query   status?   PetStatus
        query   species?  ("dog" | "cat" | "bird")[]

POST    /pets              createPet  → Pet
        Create a pet
        header  Idempotency-Key?  string
        body    NewPet application/json
...
```

Add `--json` for machine-readable output. `endpoints` is an alias for `list`.

### Validate a spec

```text
$ api-sdk-generator validate broken.yaml
✖ broken.yaml is not a valid OpenAPI 3.0.3 document
  - info must have required property 'version'
  - paths["/a"] has unknown property "fetch"
  - paths["/a"].get.responses["200"].description must be string
```

The command exits with code `1` on any error, so you can use it as a CI gate. Swagger 2.0 files are rejected, with a hint on how to convert them.

## Using the generated SDKs

The full output for the sample spec is committed under [`examples/generated/`](examples/generated). See [`petstore_ts/API.md`](examples/generated/petstore_ts/API.md) and [`petstore_py/API.md`](examples/generated/petstore_py/API.md).

### TypeScript

Output: `models.ts`, `client.ts`, `index.ts`, `API.md`. There are no runtime dependencies; the client uses the global `fetch` (Node 18+ or any browser).

```ts
import { PetstoreAPIClient, ApiError, type CreatePetError } from "./petstore-sdk/index.js";

const client = new PetstoreAPIClient({ headers: { Authorization: "Bearer <token>" } });

const page = await client.listPets({ status: "available", limit: 10 }); // page: PetPage
for (const pet of page.items) {
  if (pet.details?.kind === "dog") console.log(pet.details.breed); // narrowed union
}

try {
  await client.createPet({ name: "Rex", species: "dog" }, { idempotencyKey: "abc" });
} catch (err) {
  if (err instanceof ApiError) {
    const body = err.body as CreatePetError; // ValidationError | Error
    console.error(err.status, body.message);
  }
}
```

### Python

Output: an importable package with `models.py`, `client.py`, `__init__.py`, `requirements.txt` (`httpx`, `pydantic>=2`) and `API.md`. Pick an output directory name that is a valid Python identifier, such as `petstore_sdk`.

```python
from petstore_sdk import PetstoreAPIClient, ApiError, NewPet, PetStatus

with PetstoreAPIClient(headers={"Authorization": "Bearer <token>"}) as client:
    page = client.list_pets(status=PetStatus.AVAILABLE, limit=10)  # -> PetPage
    for pet in page.items:
        print(pet.name, pet.created_at)  # snake_case attributes, camelCase on the wire

    try:
        client.create_pet(NewPet(name="Rex", species="dog"), idempotency_key="abc")
    except ApiError as err:
        print(err.status_code, err.body)  # body is a ValidationError / Error model
```

## Architecture

```text
                 ┌──────────────────────────── src/parser ─────────────────────────────┐
 spec.yaml ───▶  │ loader.ts       validator.ts                 parse.ts                │
 spec.json       │ YAML/JSON  ──▶  OpenAPI 3.x schema check ──▶ spec ──▶ IR (types.ts)   │
                 │ syntax errors   $ref resolution / bundling   hoist nested types,     │
                 │                                              enums, unions, allOf    │
                 └───────────────────────────────────┬─────────────────────────────────┘
                                                     │  ApiSpec (language-neutral IR)
                      ┌──────────────────────────────┼───────────────────────────────┐
                      ▼                              ▼                               ▼
         src/generators/typescript      src/generators/python          src/generators/docs
         models.ts / client.ts          models.py / client.py          API.md (shared, styled
         (fetch, ApiError<T>)           (pydantic v2, httpx)            per language)
                      └──────────────────────────────┬───────────────────────────────┘
                                                     ▼
                       src/cli  (commander + inquirer): generate · list · validate
                                                     │
                                                     ▼
                                     files written to --output
```

- **`src/parser`** turns a spec into an `ApiSpec` intermediate representation (IR): a flat list of named models and operations whose types are `TypeRef`s (`primitive`, `array`, `map`, `ref`, `enum`, `union`). Inline objects are hoisted into named models, so every generator only has to handle named types.
- **`src/generators/*`** are pure functions from IR to `{ path, contents }[]`. They never read the raw spec or touch the filesystem.
- **`src/generators/docs`** renders `API.md` from the IR. Each language passes a small `DocStyle` (type renderer, method naming, example snippets), so the docs match the SDK they ship with.
- **`src/cli`** handles flags, prompts, terminal output and writing files.

**Determinism**: the parser walks the document in its own key order, generated names come only from that order, models are sorted by name, output files are sorted by path, and every file goes through `finalize()` (LF endings, no trailing whitespace, single final newline). Nothing depends on time, randomness or the environment. `npm run demo` regenerates the examples and `diff`s them byte-for-byte, and CI fails if the committed examples drift.

### Programmatic API

```ts
import { loadApiSpec, generateSdk, writeFiles } from "@shammykr/api-sdk-generator";

const spec = await loadApiSpec("openapi.yaml"); // load + validate + parse
await writeFiles("./sdk", generateSdk(spec, "typescript"));
```

## Development

```bash
git clone https://github.com/shammykr/api-sdk-generator.git
cd api-sdk-generator
npm install
npm run build        # compile to dist/
npm run lint         # eslint
npm run demo         # generate SDKs from examples/petstore.yaml, check determinism, compile the output
node dist/cli/index.js list examples/petstore.yaml
```

`npm run demo` expects `python3`, and optionally `pip install httpx pydantic`, to import-check the Python SDK.

## Contributing

Contributions are welcome. Issues and pull requests are the place to start.

1. **Open an issue first** for anything bigger than a small fix, so we can agree on the approach.
2. **Fork and branch** from `main` (`feat/xyz`, `fix/xyz`).
3. **Make the change** in the module that owns it:
   - New schema feature: extend the IR in `src/parser/types.ts`, produce it in `src/parser/parse.ts`, then render it in each generator.
   - Generator output change: `src/generators/<language>/index.ts`.
   - New target language: add `src/generators/<language>/index.ts` exporting a `Generator`, register it in `src/generators/index.ts`, and give it a `DocStyle` for `API.md`.
4. **Keep output deterministic.** Don't use `Date`, randomness or unordered iteration in generators. If your change affects the sample output, run `npm run demo` and commit the updated `examples/generated/` files. CI checks that they match.
5. **Run `npm run lint && npm run demo`** before pushing. Both must pass.
6. **Use Conventional Commits** (`feat(parser): ...`, `fix(python): ...`, `docs: ...`) and describe the user-visible effect in the PR.

### Releasing (maintainers)

Bump `version` in `package.json`, push a tag `vX.Y.Z`, and publish a GitHub Release for it. The **Publish to npm** workflow lints, builds and runs `npm publish --provenance`. It needs an `NPM_TOKEN` repository secret.

## Limitations

- Swagger 2.0 is not supported; convert to OpenAPI 3 first.
- Cookie parameters are skipped, with a warning.
- Non-JSON request bodies (multipart, form-encoded, binary) are passed through untyped.
- Authentication is not generated from `securitySchemes`; pass auth headers through the client's `headers` option.

## License

[MIT](LICENSE)
