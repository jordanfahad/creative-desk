import { PDFParse } from "pdf-parse";

const NUL = String.fromCharCode(0);

// Extract plain text from a PDF buffer (the creative director's brief).
// Used to feed the uploaded brief into the OpenAI brief-generation prompt.
export async function extractPdfText(buf: Buffer): Promise<string> {
  const parser = new PDFParse({ data: new Uint8Array(buf) });
  try {
    const result = await parser.getText();
    // Strip NUL bytes — SQLite truncates a TEXT value at the first NUL, so a
    // PDF containing one would otherwise silently store only the text before it.
    return result.text.split(NUL).join("").trim();
  } finally {
    await parser.destroy();
  }
}
