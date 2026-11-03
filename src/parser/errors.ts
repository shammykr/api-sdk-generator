/**
 * Error raised for anything wrong with the input spec. The CLI prints these
 * without a stack trace: `message` is a one-line summary and `details` holds
 * one human-readable line per problem found.
 */
export class SpecError extends Error {
  constructor(
    message: string,
    public readonly details: string[] = [],
    public readonly hint?: string,
  ) {
    super(message);
    this.name = "SpecError";
  }

  format(): string {
    const lines = [this.message, ...this.details.map((d) => `  - ${d}`)];
    if (this.hint) lines.push("", `Hint: ${this.hint}`);
    return lines.join("\n");
  }
}
