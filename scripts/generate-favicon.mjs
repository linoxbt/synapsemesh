import sharp from "sharp";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.resolve(__dirname, "..", "public");
const svgPath = path.join(publicDir, "favicon.svg");

const svg = fs.readFileSync(svgPath);

// Render the SVG at a high density first, then resample down. For tiny favicon
// targets this produces noticeably sharper output than rendering directly at
// the target size.
async function renderPng(size) {
  const out = path.join(publicDir, `favicon-${size}.png`);
  await sharp(svg, { density: 384 })
    .resize(size, size, { kernel: "lanczos3", fit: "contain" })
    .png({ compressionLevel: 9 })
    .toFile(out);
  const { size: bytes } = fs.statSync(out);
  console.log(`${path.basename(out)}: ${bytes} bytes`);
}

await renderPng(32);
await renderPng(16);
