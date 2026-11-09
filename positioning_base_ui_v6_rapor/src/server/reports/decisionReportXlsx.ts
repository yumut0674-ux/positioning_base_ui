import { deflateRawSync } from "node:zlib";
import type { DecisionReportData } from "../../features/reports/types/decisionReport.types";
import { decisionReportColumns, decisionReportInfo } from "./decisionReportColumns";
import { DecisionReportError } from "./decisionReportRequest";

const xml = (value: string) => value.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\ufffe\uffff]/g, "")
  .replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
function columnName(index: number): string {
  let result = "";
  for (let value = index + 1; value > 0; value = Math.floor((value - 1) / 26)) result = String.fromCharCode(65 + (value - 1) % 26) + result;
  return result;
}
function cell(value: string | number | undefined, address: string, style = 0): string {
  if (typeof value === "number" && Number.isFinite(value)) return `<c r="${address}" s="${style}"><v>${value}</v></c>`;
  const text = value == null ? "" : String(value);
  if (text.length > 32_767) throw new DecisionReportError("Bir kararın açıklaması Excel hücre sınırını aşıyor. Eksiksiz ayrıntı için JSON biçimini seçin.", 422);
  // inlineStr keeps IDs, leading zeros and formula-looking text literal.
  return `<c r="${address}" s="${style}" t="inlineStr"><is><t xml:space="preserve">${xml(text)}</t></is></c>`;
}
function sheet(rows: readonly (readonly (string | number | undefined)[])[], widths: readonly number[], freezeColumns: number, filter: boolean, dateColumns: readonly number[] = []): string {
  const last = `${columnName(widths.length - 1)}${rows.length}`;
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<dimension ref="A1:${last}"/><sheetViews><sheetView workbookViewId="0"><pane xSplit="${freezeColumns}" ySplit="1" topLeftCell="${columnName(freezeColumns)}2" activePane="${freezeColumns ? "bottomRight" : "bottomLeft"}" state="frozen"/></sheetView></sheetViews>
<sheetFormatPr defaultRowHeight="19"/><cols>${widths.map((width, i) => `<col min="${i + 1}" max="${i + 1}" width="${width}" customWidth="1"/>`).join("")}</cols>
<sheetData>${rows.map((row, index) => `<row r="${index + 1}"${index === 0 ? ' ht="32" customHeight="1"' : ""}>${row.map((value, col) => cell(value, `${columnName(col)}${index + 1}`, index === 0 ? 1 : dateColumns.includes(col) ? 2 : 0)).join("")}</row>`).join("")}</sheetData>
${filter ? `<autoFilter ref="A1:${last}"/>` : ""}</worksheet>`;
}

const crcTable = Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit++) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  return value >>> 0;
});
function crc32(bytes: Buffer): number {
  let value = 0xffffffff;
  for (const byte of bytes) value = crcTable[(value ^ byte) & 255] ^ (value >>> 8);
  return (value ^ 0xffffffff) >>> 0;
}

/** Minimal OOXML ZIP writer: fixed workbook parts, text/numeric cells, no macros or formulas. */
function archive(entries: readonly (readonly [string, string])[]): Buffer {
  const local: Buffer[] = [], central: Buffer[] = [];
  let offset = 0;
  for (const [path, contents] of entries) {
    const name = Buffer.from(path), data = Buffer.from(contents, "utf8"), compressed = deflateRawSync(data), crc = crc32(data);
    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50, 0); header.writeUInt16LE(20, 4); header.writeUInt16LE(0x800, 6);
    header.writeUInt16LE(8, 8); header.writeUInt16LE(33, 12); header.writeUInt32LE(crc, 14);
    header.writeUInt32LE(compressed.length, 18); header.writeUInt32LE(data.length, 22); header.writeUInt16LE(name.length, 26);
    const directory = Buffer.alloc(46);
    directory.writeUInt32LE(0x02014b50, 0); directory.writeUInt16LE(20, 4); directory.writeUInt16LE(20, 6);
    directory.writeUInt16LE(0x800, 8); directory.writeUInt16LE(8, 10); directory.writeUInt16LE(33, 14);
    directory.writeUInt32LE(crc, 16); directory.writeUInt32LE(compressed.length, 20); directory.writeUInt32LE(data.length, 24);
    directory.writeUInt16LE(name.length, 28); directory.writeUInt32LE(offset, 42);
    local.push(header, name, compressed); central.push(directory, name);
    offset += header.length + name.length + compressed.length;
  }
  const directory = Buffer.concat(central), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(directory.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, directory, end]);
}

interface ReportWorkbook {
  readonly sheetName: string;
  readonly rows: readonly (readonly (string | number | undefined)[])[];
  readonly widths: readonly number[];
  readonly dateColumns: readonly number[];
  readonly freezeColumns: number;
  readonly info: readonly (readonly [string, string | number])[];
}

export function createReportWorkbook({ sheetName, rows, widths, dateColumns, freezeColumns, info }: ReportWorkbook): Uint8Array {
  return archive([
    ["[Content_Types].xml", `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/worksheets/sheet2.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>`],
    ["_rels/.rels", `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`],
    ["xl/workbook.xml", `<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><bookViews><workbookView/></bookViews><sheets><sheet name="${xml(sheetName)}" sheetId="1" r:id="rId1"/><sheet name="Bilgi" sheetId="2" r:id="rId2"/></sheets></workbook>`],
    ["xl/_rels/workbook.xml.rels", `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`],
    ["xl/styles.xml", `<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><numFmts count="1"><numFmt numFmtId="164" formatCode="dd.mm.yyyy hh:mm:ss"/></numFmts><fonts count="2"><font><sz val="10"/><name val="Arial"/></font><font><b/><sz val="10"/><color rgb="FFFFFFFF"/><name val="Arial"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF243B53"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="3"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf><xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`],
    ["xl/worksheets/sheet1.xml", sheet(rows, widths, freezeColumns, true, dateColumns)],
    ["xl/worksheets/sheet2.xml", sheet([["Alan", "Değer"], ...info], [30, 130], 0, false)],
  ]);
}

export function createDecisionReportXlsx(report: DecisionReportData): Uint8Array {
  const rows = [decisionReportColumns.map(column => column.title), ...report.items.map((item, index) => decisionReportColumns.map((column, col) =>
    col === 1 ? Date.parse(item.publishedAt) / 86_400_000 + 25_569 + 3 / 24 : column.value(item, index)))];
  return createReportWorkbook({ sheetName: "Motor_Kararlari", rows, widths: decisionReportColumns.map(column => column.width),
    dateColumns: [1], freezeColumns: 4, info: decisionReportInfo(report) });
}
