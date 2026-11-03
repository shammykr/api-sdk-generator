#!/usr/bin/env bash
# Demo: generate TypeScript and Python SDKs from the sample petstore spec,
# prove the output is deterministic, and check that it compiles.
set -euo pipefail
cd "$(dirname "$0")/.."

SPEC=examples/petstore.yaml
OUT=examples/generated
TMP=.tmp-demo
CLI="node dist/cli/index.js"

step() { printf '\n\033[1m==> %s\033[0m\n' "$1"; }

step "Building the CLI"
npm run --silent build

step "Validating $SPEC"
$CLI validate "$SPEC"

step "Discovering endpoints"
$CLI list "$SPEC"

step "Generating SDKs into $OUT/"
$CLI generate --input "$SPEC" --lang typescript --output "$OUT/petstore_ts"
$CLI generate --input "$SPEC" --lang python --output "$OUT/petstore_py"

step "Checking determinism (regenerate and compare byte-for-byte)"
rm -rf "$TMP" && mkdir -p "$TMP"
$CLI generate -i "$SPEC" -l ts -o "$TMP/petstore_ts" > /dev/null
$CLI generate -i "$SPEC" -l py -o "$TMP/petstore_py" > /dev/null
diff -r "$OUT/petstore_ts" "$TMP/petstore_ts"
diff -r "$OUT/petstore_py" "$TMP/petstore_py"
echo "Both SDKs are byte-identical across runs."

step "Type-checking the generated TypeScript SDK (tsc --strict)"
cat > "$TMP/tsconfig.json" <<JSON
{
  "compilerOptions": {
    "strict": true, "noEmit": true, "skipLibCheck": true, "types": [],
    "target": "ES2022", "module": "NodeNext", "moduleResolution": "NodeNext", "lib": ["ES2022", "DOM"]
  },
  "files": ["../$OUT/petstore_ts/index.ts"]
}
JSON
npx tsc -p "$TMP/tsconfig.json"
echo "TypeScript SDK compiles cleanly."

step "Checking the generated Python SDK"
if command -v python3 > /dev/null; then
  python3 -m py_compile "$OUT"/petstore_py/*.py
  if python3 -c "import pydantic, httpx" 2> /dev/null; then
    (cd "$OUT" && python3 -c "import petstore_py as sdk; print('Imported', sdk.PetstoreAPIClient.__name__, 'with', len(sdk.models.__all__), 'models')")
  else
    echo "Python SDK byte-compiles (install pydantic and httpx to also import it)."
  fi
  find "$OUT" -name __pycache__ -type d -prune -exec rm -rf {} +
else
  echo "python3 not found; skipping."
fi

rm -rf "$TMP"
step "Done. See $OUT/ for the generated SDKs and their API.md references."
