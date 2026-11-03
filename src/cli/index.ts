#!/usr/bin/env node
import { Command, Option } from "commander";
import { readFileSync } from "node:fs";
import { LANGUAGES } from "../generators/index.js";
import { generateCommand } from "./commands/generate.js";
import { listCommand } from "./commands/list.js";
import { validateCommand } from "./commands/validate.js";
import { printError } from "./output.js";

const pkg = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8")) as { version: string };

const program = new Command()
  .name("api-sdk-generator")
  .description("Generate strongly typed API client SDKs from OpenAPI 3.x specs.")
  .version(pkg.version, "-v, --version")
  .showHelpAfterError();

program
  .command("generate", { isDefault: true })
  .description("generate an SDK (prompts for anything not passed as a flag)")
  .option("-i, --input <spec>", "path to the OpenAPI spec (YAML or JSON)")
  .option("-o, --output <dir>", "directory to write the SDK into")
  .addOption(new Option("-l, --lang <language>", `target language: ${LANGUAGES.join(" | ")} (or ts, py)`))
  .action(generateCommand);

program
  .command("list")
  .alias("endpoints")
  .description("list every endpoint with its method, path, parameters and types")
  .argument("<spec>", "path to the OpenAPI spec")
  .option("--json", "print machine-readable JSON")
  .action(listCommand);

program
  .command("validate")
  .description("validate a spec against the OpenAPI 3.x standard")
  .argument("<spec>", "path to the OpenAPI spec")
  .action(validateCommand);

program.parseAsync(process.argv).catch((err: unknown) => {
  if (err instanceof Error && err.name === "ExitPromptError") {
    process.exitCode = 130;
    return;
  }
  printError(err);
  process.exitCode = 1;
});
