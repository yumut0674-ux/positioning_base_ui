import assert from "node:assert/strict";
import test from "node:test";
import { exportRange, parseExportTime, selectTags } from "./input";
import { csvCell, sqlLiteral } from "./exporter";

test("terminal dates use Istanbul regardless of the process timezone and preserve milliseconds", () => {
  assert.equal(parseExportTime("2026-10-13 09:30"), "2026-10-13T06:30:00.000Z");
  assert.equal(parseExportTime("13.10.2026 09:30:12.157"), "2026-10-13T06:30:12.157Z");
  assert.equal(parseExportTime("2026-10-13T09:30:12.1+03:00"), "2026-10-13T06:30:12.100Z");
  assert.equal(parseExportTime("2026-10-13T06:30:12.157Z"), "2026-10-13T06:30:12.157Z");
  assert.equal(parseExportTime("şimdi", new Date("2026-10-13T10:00:00Z")), "2026-10-13T10:00:00.000Z");
});

test("invalid calendar dates, malformed offsets and reversed intervals are rejected", () => {
  for (const value of ["2026-02-29 12:00", "2026-04-31 12:00", "2026-10-13 24:00", "2026-10-13 12:60", "2026-10-13T12:00+14:30", "2026-10-13", "12:00"]) {
    assert.throws(() => parseExportTime(value));
  }
  assert.equal(parseExportTime("2024-02-29 12:00"), "2024-02-29T09:00:00.000Z");
  assert.throws(() => exportRange("2026-10-13 12:00", "2026-10-13 12:00"));
  assert.throws(() => exportRange("2026-10-13 12:00", "2026-10-12 12:00"));
});

test("tag selection accepts indices, codes and all; duplicate selections collapse", () => {
  const tags = ["ABC123", "000123", "OTHER"];
  assert.deepEqual(selectTags("1,other,1", tags), ["ABC123", "OTHER"]);
  assert.deepEqual(selectTags("000123", tags), ["000123"]);
  assert.deepEqual(selectTags("tümü", tags), tags);
  assert.throws(() => selectTags("4", tags));
  assert.throws(() => selectTags("", tags));
});

test("SQL quotes and spreadsheet formula cells are escaped", () => {
  assert.equal(sqlLiteral("TAG'; DROP TABLE tags; --"), "'TAG''; DROP TABLE tags; --'");
  assert.throws(() => sqlLiteral("A\0B"));
  assert.ok(csvCell('=HYPERLINK("x")').startsWith('"\'='));
  assert.ok(csvCell(" \t@evil").startsWith('"\''));
  assert.equal(csvCell(-2.5), '"-2.5"');
  assert.equal(csvCell("9223372036854775807"), '"' + "'" + '9223372036854775807"');
  assert.ok(csvCell({ evidence: ["a", "b"] }).includes('""evidence""'));
});
