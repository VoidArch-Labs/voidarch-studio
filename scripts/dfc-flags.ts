// Print the Voidarch Context / Voidarch Studio feature-flag registry.
//   pnpm dfc:flags [--json] [--owner memory|studio]
import { FLAGS } from "../src/flags.js";

const args = process.argv.slice(2);
const asJson = args.includes("--json");
const ownerIdx = args.indexOf("--owner");
const owner = ownerIdx >= 0 ? args[ownerIdx + 1] : undefined;

const rows = FLAGS.filter((f) => !owner || f.owner === owner);

if (asJson) {
  console.log(JSON.stringify(rows, null, 2));
} else {
  const width = Math.max(...rows.map((f) => f.id.length));
  for (const f of rows) {
    const gates = [f.defaultEnabled ? "on" : "off", f.requiresApproval ? "approval" : null]
      .filter(Boolean)
      .join(", ");
    console.log(`${f.id.padEnd(width)}  ${f.status.padEnd(12)} [${gates}]  ${f.description}`);
  }
}
process.exit(0);
