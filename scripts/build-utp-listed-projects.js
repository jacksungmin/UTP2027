// Regenerates lib/utp-2027-listed-projects.json from TxDOT's official
// "2027 UTP - Listed Projects" spreadsheet, filtered to the 8-county H-GAC MPO.
//
// Re-run this whenever TxDOT publishes a new/revised UTP:
//   node scripts/build-utp-listed-projects.js [path-to-local-xlsx]
//
// With no argument it downloads the current file from TxDOT's UTP document
// library (https://www.txdot.gov/projects/planning/utp/utp-document-library.html).
//
// No xlsx-parsing dependency is used on purpose: an .xlsx is a zip of XML
// parts, and TxDOT's own file is a trusted, well-formed source, so a small
// hand-rolled zip + XML reader avoids pulling in a flagged dependency
// (the npm "xlsx" package has known prototype-pollution/ReDoS advisories)
// for what is otherwise a maintenance-only script.

import { inflateRawSync } from "node:zlib";
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const DEFAULT_SOURCE_URL =
  "https://ftp.txdot.gov/pub/txdot/get-involved/tpp/utp/2027utp-searchable.xlsx";
const LISTED_PROJECTS_SHEET_NAME = "2027 UTP_ListedProjects";
const OUTPUT_PATH = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "../lib/utp-2027-listed-projects.json",
);

const hgacCounties = [
  "Brazoria",
  "Chambers",
  "Fort Bend",
  "Galveston",
  "Harris",
  "Liberty",
  "Montgomery",
  "Waller",
];

async function loadXlsxBuffer() {
  const localPath = process.argv[2];
  if (localPath) {
    return await import("node:fs").then((fs) => fs.readFileSync(localPath));
  }

  const response = await fetch(DEFAULT_SOURCE_URL);
  if (!response.ok) {
    throw new Error(`Failed to download ${DEFAULT_SOURCE_URL}: ${response.status}`);
  }
  return Buffer.from(await response.arrayBuffer());
}

function readZipEntries(buffer, wantedNames) {
  const eocdSignature = 0x06054b50;
  let eocdOffset = -1;
  for (let i = buffer.length - 22; i >= 0; i -= 1) {
    if (buffer.readUInt32LE(i) === eocdSignature) {
      eocdOffset = i;
      break;
    }
  }
  if (eocdOffset === -1) {
    throw new Error("Not a valid zip/xlsx file (no end-of-central-directory record)");
  }

  const entryCount = buffer.readUInt16LE(eocdOffset + 10);
  let centralDirOffset = buffer.readUInt32LE(eocdOffset + 16);

  const results = new Map();
  for (let i = 0; i < entryCount; i += 1) {
    const signature = buffer.readUInt32LE(centralDirOffset);
    if (signature !== 0x02014b50) {
      throw new Error("Malformed central directory entry");
    }
    const compressionMethod = buffer.readUInt16LE(centralDirOffset + 10);
    const compressedSize = buffer.readUInt32LE(centralDirOffset + 20);
    const fileNameLength = buffer.readUInt16LE(centralDirOffset + 28);
    const extraLength = buffer.readUInt16LE(centralDirOffset + 30);
    const commentLength = buffer.readUInt16LE(centralDirOffset + 32);
    const localHeaderOffset = buffer.readUInt32LE(centralDirOffset + 42);
    const fileName = buffer.toString(
      "utf8",
      centralDirOffset + 46,
      centralDirOffset + 46 + fileNameLength,
    );

    if (wantedNames.includes(fileName)) {
      const localFileNameLength = buffer.readUInt16LE(localHeaderOffset + 26);
      const localExtraLength = buffer.readUInt16LE(localHeaderOffset + 28);
      const dataStart = localHeaderOffset + 30 + localFileNameLength + localExtraLength;
      const compressedData = buffer.subarray(dataStart, dataStart + compressedSize);
      const data =
        compressionMethod === 0 ? compressedData : inflateRawSync(compressedData);
      results.set(fileName, data.toString("utf8"));
    }

    centralDirOffset += 46 + fileNameLength + extraLength + commentLength;
  }

  return results;
}

function parseSharedStrings(xml) {
  const shared = [];
  const siRe = /<si>([\s\S]*?)<\/si>/g;
  let match;
  while ((match = siRe.exec(xml))) {
    const text = [...match[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((m) => m[1]).join("");
    shared.push(decodeXmlEntities(text));
  }
  return shared;
}

function decodeXmlEntities(value) {
  return value
    .replaceAll("&amp;", "&")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&apos;", "'");
}

function parseSheetRows(xml, sharedStrings) {
  const rowRe = /<row[^>]*r="(\d+)"[^>]*>([\s\S]*?)<\/row>/g;
  const cellRe = /<c\s+([^>]*?)(\/>|>([\s\S]*?)<\/c>)/g;
  const rows = [];

  let rowMatch;
  while ((rowMatch = rowRe.exec(xml))) {
    const cells = {};
    cellRe.lastIndex = 0;
    let cellMatch;
    while ((cellMatch = cellRe.exec(rowMatch[2]))) {
      const attrs = cellMatch[1];
      const inner = cellMatch[3] || "";
      const columnMatch = attrs.match(/r="([A-Z]+)\d+"/);
      if (!columnMatch) continue;
      const isSharedString = /t="s"/.test(attrs);
      const valueMatch = inner.match(/<v>([\s\S]*?)<\/v>/);
      const inlineStringMatch = inner.match(/<is>[\s\S]*?<t[^>]*>([\s\S]*?)<\/t>[\s\S]*?<\/is>/);

      let value = "";
      if (isSharedString && valueMatch) {
        value = sharedStrings[Number.parseInt(valueMatch[1], 10)] || "";
      } else if (inlineStringMatch) {
        value = decodeXmlEntities(inlineStringMatch[1]);
      } else if (valueMatch) {
        value = decodeXmlEntities(valueMatch[1]);
      }
      cells[columnMatch[1]] = value;
    }
    rows.push(cells);
  }

  return rows;
}

async function main() {
  const buffer = await loadXlsxBuffer();
  const entries = readZipEntries(buffer, [
    "xl/workbook.xml",
    "xl/_rels/workbook.xml.rels",
    "xl/sharedStrings.xml",
  ]);

  const workbookXml = entries.get("xl/workbook.xml");
  const relsXml = entries.get("xl/_rels/workbook.xml.rels");
  const sharedStrings = parseSharedStrings(entries.get("xl/sharedStrings.xml"));

  const sheetMatch = workbookXml.match(
    new RegExp(`<sheet name="${LISTED_PROJECTS_SHEET_NAME}"[^>]*r:id="(rId\\d+)"`),
  );
  if (!sheetMatch) {
    throw new Error(`Could not find the "${LISTED_PROJECTS_SHEET_NAME}" sheet in the workbook`);
  }
  const relMatch = relsXml.match(
    new RegExp(`<Relationship Id="${sheetMatch[1]}"[^>]*Target="([^"]+)"`),
  );
  const sheetPath = `xl/${relMatch[1]}`;

  const sheetEntries = readZipEntries(buffer, [sheetPath]);
  const rows = parseSheetRows(sheetEntries.get(sheetPath), sharedStrings);

  const [header, ...dataRows] = rows;
  const columnByLabel = Object.fromEntries(
    Object.entries(header).map(([column, label]) => [label, column]),
  );

  const hgacSet = new Set(hgacCounties);
  const projects = dataRows
    .map((row) => ({
      district: row[columnByLabel["TxDOT District"]] || "",
      highway: row[columnByLabel["Highway"]] || "",
      csj: row[columnByLabel["Project ID (CSJ)"]] || "",
      estLetDateRange: row[columnByLabel["Est. Let Date Range"]] || "",
      county: (row[columnByLabel["County"]] || "").trim(),
      limitsFrom: row[columnByLabel["Limits From"]] || "",
      limitsTo: row[columnByLabel["Limits To"]] || "",
      utpAction: row[columnByLabel["UTP Action"]] || "",
      estConstructionCost: Number(row[columnByLabel["Est. Construction Cost"]] || 0),
      fundingCategory2: Number(row[columnByLabel["Authorized Funding Category 2"]] || 0),
      fundingCategory4: Number(row[columnByLabel["Authorized Funding Category 4"]] || 0),
      fundingCategory12: Number(row[columnByLabel["Authorized Funding Category 12"]] || 0),
    }))
    .filter((project) => hgacSet.has(project.county));

  writeFileSync(OUTPUT_PATH, `${JSON.stringify(projects, null, 2)}\n`);
  console.log(`Wrote ${projects.length} H-GAC projects to ${OUTPUT_PATH}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
