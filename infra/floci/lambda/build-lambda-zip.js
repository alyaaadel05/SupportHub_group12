#!/usr/bin/env node
"use strict";

// Builds the Editorial publication-outcome Lambda deployment package
// without needing a "zip" binary (Git Bash on Windows has none).
//
//   node infra/floci/lambda/build-lambda-zip.js <output.zip> [ca.crt]
//
// Contents:
//   index.js                         services/editorial-service/lambda/publicationOutcome/index.js
//   node_modules/<pg and its deps>   copied from services/editorial-service/node_modules
//   ca.crt (optional)                local Postgres CA, used via NODE_EXTRA_CA_CERTS
//
// Files are stored uncompressed (ZIP method 0), which every Lambda runtime accepts.

const fs = require("node:fs");
const path = require("node:path");
const zlib = require("node:zlib");

const root = path.resolve(__dirname, "..", "..", "..");
const editorial = path.join(root, "services", "editorial-service");
const handler = path.join(editorial, "lambda", "publicationOutcome", "index.js");
const modules = path.join(editorial, "node_modules");

const output = process.argv[2];
const caFile = process.argv[3];

if (!output) {
  console.error("Usage: build-lambda-zip.js <output.zip> [ca.crt]");
  process.exit(2);
}

if (!fs.existsSync(path.join(modules, "pg"))) {
  console.error("services/editorial-service/node_modules/pg is missing: run npm ci there first");
  process.exit(2);
}

// Resolve pg and its runtime dependencies from package.json files.
function dependencyClosure(start) {
  const seen = new Set();
  const queue = [start];

  while (queue.length) {
    const name = queue.shift();
    if (seen.has(name)) continue;
    const pkgFile = path.join(modules, name, "package.json");
    if (!fs.existsSync(pkgFile)) continue; // optional dependency not installed
    seen.add(name);
    const pkg = JSON.parse(fs.readFileSync(pkgFile, "utf8"));
    for (const dep of Object.keys(pkg.dependencies || {})) queue.push(dep);
  }

  return [...seen];
}

function walk(dir, base, files) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    const rel = path.posix.join(base, entry.name);
    if (entry.isDirectory()) walk(full, rel, files);
    else if (entry.isFile()) files.push([rel, full]);
  }
}

const files = [["index.js", handler]];
for (const name of dependencyClosure("pg")) {
  walk(path.join(modules, name), `node_modules/${name}`, files);
}
if (caFile) files.push(["ca.crt", path.resolve(caFile)]);

// Minimal ZIP writer (stored entries).
const chunks = [];
const central = [];
let offset = 0;

for (const [name, full] of files) {
  const data = fs.readFileSync(full);
  const nameBuf = Buffer.from(name, "utf8");
  const crc = zlib.crc32(data) >>> 0;

  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(20, 4);
  local.writeUInt16LE(0x0800, 6); // UTF-8 names
  local.writeUInt16LE(0, 8);      // stored
  local.writeUInt32LE(0, 10);     // time/date
  local.writeUInt32LE(crc, 14);
  local.writeUInt32LE(data.length, 18);
  local.writeUInt32LE(data.length, 22);
  local.writeUInt16LE(nameBuf.length, 26);
  local.writeUInt16LE(0, 28);
  chunks.push(local, nameBuf, data);

  const cen = Buffer.alloc(46);
  cen.writeUInt32LE(0x02014b50, 0);
  cen.writeUInt16LE(0x031e, 4);   // made by Unix
  cen.writeUInt16LE(20, 6);
  cen.writeUInt16LE(0x0800, 8);
  cen.writeUInt16LE(0, 10);
  cen.writeUInt32LE(0, 12);
  cen.writeUInt32LE(crc, 16);
  cen.writeUInt32LE(data.length, 20);
  cen.writeUInt32LE(data.length, 24);
  cen.writeUInt16LE(nameBuf.length, 28);
  cen.writeUInt32LE((0o100644 << 16) >>> 0, 38); // file mode
  cen.writeUInt32LE(offset, 42);
  central.push(cen, nameBuf);

  offset += local.length + nameBuf.length + data.length;
}

const centralBuf = Buffer.concat(central);
const end = Buffer.alloc(22);
end.writeUInt32LE(0x06054b50, 0);
end.writeUInt16LE(files.length, 8);
end.writeUInt16LE(files.length, 10);
end.writeUInt32LE(centralBuf.length, 12);
end.writeUInt32LE(offset, 16);

fs.mkdirSync(path.dirname(path.resolve(output)), { recursive: true });
fs.writeFileSync(output, Buffer.concat([...chunks, centralBuf, end]));
console.log(`Lambda package written: ${files.length} files`);
