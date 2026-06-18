const NUL = String.fromCharCode(0);

// Extract plain text from a PDF buffer (the creative director's brief / guideline).
// pdf-parse pulls in pdfjs, which references browser-only globals (DOMMatrix) and
// crashes on import in serverless runtimes — so it's loaded lazily, only when a
// PDF is actually parsed, never at module load (which would 500 every page that
// imports the actions module).
export async function extractPdfText(buf: Buffer): Promise<string> {
  const { PDFParse } = await import("pdf-parse");
  const parser = new PDFParse({ data: new Uint8Array(buf) });
  try {
    const result = await parser.getText();
    // Strip NUL bytes — SQLite/Postgres truncate TEXT at the first NUL.
    return result.text.split(NUL).join("").trim();
  } finally {
    await parser.destroy();
  }
}
