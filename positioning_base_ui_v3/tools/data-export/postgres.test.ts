import assert from "node:assert/strict";
import net from "node:net";
import test from "node:test";
import { withPostgresReadOnlySnapshot, type PgRow } from "../../src/server/postgresClient";

const cstring = (value: string) => Buffer.from(value + "\0");
const frame = (type: string, body: Buffer) => {
  const header = Buffer.alloc(5); header.write(type); header.writeInt32BE(body.length + 4, 1); return Buffer.concat([header, body]);
};
const ready = () => frame("Z", Buffer.from("T"));
function result(rows: PgRow[]): Buffer {
  const packets: Buffer[] = [];
  if (rows.length) {
    const fields = Object.keys(rows[0]), count = Buffer.alloc(2); count.writeInt16BE(fields.length);
    packets.push(frame("T", Buffer.concat([count, ...fields.map(name => Buffer.concat([cstring(name), Buffer.alloc(18)]))])));
    for (const row of rows) {
      const values = fields.map(field => {
        const value = row[field], data = value === null ? Buffer.alloc(0) : Buffer.from(value);
        const length = Buffer.alloc(4); length.writeInt32BE(value === null ? -1 : data.length);
        return Buffer.concat([length, data]);
      });
      packets.push(frame("D", Buffer.concat([count, ...values])));
    }
  }
  packets.push(frame("C", cstring("SELECT")), ready()); return Buffer.concat(packets);
}

async function mockDatabase(work: (queries: string[]) => Promise<void>, stalled = false): Promise<void> {
  const queries: string[] = [], sockets = new Set<net.Socket>();
  const data = [{ record: '{"tag":"A","text":"Türkçe"}' }, { record: '{"tag":"B"}' }, { record: '{"tag":"C"}' }];
  let offset = 0;
  const server = net.createServer(socket => {
    sockets.add(socket); socket.on("close", () => sockets.delete(socket)); socket.on("error", () => undefined);
    let buffer = Buffer.alloc(0), startup = true;
    socket.on("data", chunk => {
      buffer = Buffer.concat([buffer, chunk]);
      while (true) {
        if (startup) {
          if (buffer.length < 4 || buffer.length < buffer.readInt32BE(0)) return;
          buffer = buffer.subarray(buffer.readInt32BE(0)); startup = false;
          socket.write(Buffer.concat([frame("R", Buffer.alloc(4)), ready()]));
        } else {
          if (buffer.length < 5 || buffer.length < buffer.readInt32BE(1) + 1) return;
          const size = buffer.readInt32BE(1) + 1, sql = buffer.toString("utf8", 5, size - 1);
          buffer = buffer.subarray(size); queries.push(sql);
          if (stalled && sql === "SELECT stalled") continue;
          const fetch = /^FETCH FORWARD (\d+) FROM/.exec(sql);
          if (fetch) { const batch = data.slice(offset, offset + Number(fetch[1])); offset += batch.length; socket.write(result(batch)); }
          else socket.write(result([]));
        }
      }
    });
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const original = { POSTGRES_HOST: process.env.POSTGRES_HOST, POSTGRES_PORT: process.env.POSTGRES_PORT };
  process.env.POSTGRES_HOST = "127.0.0.1"; process.env.POSTGRES_PORT = String((server.address() as net.AddressInfo).port);
  try { await work(queries); }
  finally {
    for (const [key, value] of Object.entries(original)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
    for (const socket of sockets) socket.destroy();
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
}

test("one read-only connection streams every cursor batch and commits after the last row", async () => {
  await mockDatabase(async queries => {
    const rows: PgRow[] = [];
    await withPostgresReadOnlySnapshot(async client => client.stream("SELECT record FROM fixture", async row => { rows.push(row); }), { batchSize: 1 });
    assert.deepEqual(rows.map(row => JSON.parse(row.record!).tag), ["A", "B", "C"]);
    assert.equal(JSON.parse(rows[0].record!).text, "Türkçe");
    assert.equal(queries[0], "BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY");
    assert.equal(queries.filter(query => query.startsWith("FETCH")).length, 4);
    assert.ok(queries.some(query => query.startsWith("DECLARE uwb_export_1 NO SCROLL CURSOR")));
    assert.equal(queries.at(-1), "COMMIT");
  });
});

test("write failure interrupts the snapshot, never commits, and does not leak the connection", async () => {
  await mockDatabase(async queries => {
    await assert.rejects(withPostgresReadOnlySnapshot(client => client.stream("SELECT record FROM fixture", async () => { throw new Error("disk full"); }), { batchSize: 1 }), /disk full/);
    assert.ok(!queries.includes("COMMIT"));
  });
});

test("stalled query times out; cancellation also interrupts an active read", async () => {
  await mockDatabase(async () => {
    await assert.rejects(withPostgresReadOnlySnapshot(client => client.query("SELECT stalled"), { timeoutMs: 100 }), /timed out/);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 100);
    try { await assert.rejects(withPostgresReadOnlySnapshot(client => client.query("SELECT stalled"), { signal: controller.signal }), /iptal/); }
    finally { clearTimeout(timer); }
  }, true);
});
