/**
 * Generate SLTerm icon PNGs from SVG using sharp
 * Run: node scripts/generate-icons.mjs
 */
import fs from "fs";
import { createRequire } from "module";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

// Load sharp from temp install
const tmpSharpPath = path.join(os.tmpdir(), "sharp-tmp", "node_modules", "sharp");
let sharp;
try {
  const require2 = createRequire(import.meta.url);
  sharp = require2(tmpSharpPath);
} catch {
  try {
    sharp = (await import("sharp")).default;
  } catch {
    console.error("ERROR: sharp not found. Install it first:");
    console.error('  npm install sharp --prefix "$env:TEMP/sharp-tmp"');
    process.exit(1);
  }
}

const SVG_PATH = path.join(ROOT, "assets", "appicon-windows.svg");
const svgBuffer = fs.readFileSync(SVG_PATH);

const SIZES = [16, 32, 48, 64, 128, 256, 512];

// Generate PNGs for build/icons/
console.log("Generating build/icons/ PNGs...");
for (const size of SIZES) {
  const outPath = path.join(ROOT, "build", "icons", `${size}x${size}.png`);
  await sharp(svgBuffer).resize(size, size).png().toFile(outPath);
  console.log(`  OK ${size}x${size}.png`);
}

// Generate assets/appicon-windows.png (256px)
console.log("Generating assets/appicon-windows.png...");
await sharp(svgBuffer)
  .resize(256, 256)
  .png()
  .toFile(path.join(ROOT, "assets", "appicon-windows.png"));

// Generate frontend/logos/ (128px)
console.log("Generating frontend/logos/...");
const logo128 = await sharp(svgBuffer).resize(128, 128).png().toBuffer();
fs.writeFileSync(path.join(ROOT, "frontend", "logos", "wave-logo.png"), logo128);
fs.writeFileSync(path.join(ROOT, "frontend", "logos", "wave-logo-dark.png"), logo128);

// Generate public/logos/ (various sizes)
console.log("Generating public/logos/...");
const logo256 = await sharp(svgBuffer).resize(256, 256).png().toBuffer();
fs.writeFileSync(path.join(ROOT, "public", "logos", "wave-logo.png"), logo128);
fs.writeFileSync(path.join(ROOT, "public", "logos", "wave-logo-dark.png"), logo128);
fs.writeFileSync(path.join(ROOT, "public", "logos", "wave-logo-256.png"), logo256);
fs.writeFileSync(path.join(ROOT, "public", "logos", "wave-dark.png"), logo256);

// Generate tsunami/frontend/public/ (256px)
console.log("Generating tsunami/frontend/public/...");
const tsunamiDir = path.join(ROOT, "tsunami", "frontend", "public");
if (fs.existsSync(tsunamiDir)) {
  fs.writeFileSync(path.join(tsunamiDir, "wave-logo-256.png"), logo256);
  console.log("  OK tsunami logo");
}

// Generate ICO (multi-size) for Windows
console.log("Generating build/icon.ico...");
const icoSizes = [16, 32, 48, 64, 128, 256];
const pngBuffers = [];
for (const size of icoSizes) {
  const buf = await sharp(svgBuffer).resize(size, size).png().toBuffer();
  pngBuffers.push({ size, data: buf });
}

function createIco(images) {
  const numImages = images.length;
  const headerSize = 6;
  const dirEntrySize = 16;
  const dirSize = dirEntrySize * numImages;

  let dataOffset = headerSize + dirSize;
  const entries = [];

  for (const img of images) {
    entries.push({
      width: img.size >= 256 ? 0 : img.size,
      height: img.size >= 256 ? 0 : img.size,
      dataSize: img.data.length,
      dataOffset: dataOffset,
      data: img.data,
    });
    dataOffset += img.data.length;
  }

  const totalSize = dataOffset;
  const buffer = Buffer.alloc(totalSize);

  buffer.writeUInt16LE(0, 0);
  buffer.writeUInt16LE(1, 2);
  buffer.writeUInt16LE(numImages, 4);

  let offset = headerSize;
  for (const entry of entries) {
    buffer.writeUInt8(entry.width, offset);
    buffer.writeUInt8(entry.height, offset + 1);
    buffer.writeUInt8(0, offset + 2);
    buffer.writeUInt8(0, offset + 3);
    buffer.writeUInt16LE(1, offset + 4);
    buffer.writeUInt16LE(32, offset + 6);
    buffer.writeUInt32LE(entry.dataSize, offset + 8);
    buffer.writeUInt32LE(entry.dataOffset, offset + 12);
    offset += dirEntrySize;
  }

  for (const entry of entries) {
    entry.data.copy(buffer, entry.dataOffset);
  }

  return buffer;
}

const icoBuffer = createIco(pngBuffers);
fs.writeFileSync(path.join(ROOT, "build", "icon.ico"), icoBuffer);

console.log("");
console.log("All icons generated successfully!");
