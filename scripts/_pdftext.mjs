// Extract text from a single PDF and print it to stdout. Run as its own
// process (no other native modules loaded) so pdfjs extracts reliably.
//   node scripts/_pdftext.mjs "<path>"
import { PDFParse } from "pdf-parse";
import { readFileSync } from "node:fs";

const NUL = String.fromCharCode(0);
const p = process.argv[2];
let best = "";
for (let i = 0; i < 3; i++) {
  const parser = new PDFParse({ data: new Uint8Array(readFileSync(p)) });
  const r = await parser.getText();
  await parser.destroy();
  const t = r.text.split(NUL).join("").trim(); // strip NUL — SQLite truncates TEXT at it
  if (t.length > best.length) best = t;
}
process.stdout.write(best);
