import crypto from "node:crypto";
import net from "node:net";

type PgField = {
  readonly name: string;
};

export type PgRow = Record<string, string | null>;

type PgConfig = {
  readonly host: string;
  readonly port: number;
  readonly database: string;
  readonly user: string;
  readonly password: string;
};

const AUTH_OK = 0;
const AUTH_CLEAR_TEXT = 3;
const AUTH_MD5 = 5;
const AUTH_SASL = 10;
const AUTH_SASL_CONTINUE = 11;
const AUTH_SASL_FINAL = 12;

function getConfig(): PgConfig {
  return {
    host: process.env.POSTGRES_HOST ?? "localhost",
    port: Number(process.env.POSTGRES_PORT ?? 5432),
    database: process.env.POSTGRES_DB ?? "uwb_db",
    user: process.env.POSTGRES_USER ?? "uwb_user",
    password: process.env.POSTGRES_PASSWORD ?? "uwb_local_123456",
  };
}

function cstring(value: string): Buffer {
  return Buffer.from(`${value}\0`, "utf8");
}

function message(type: string, payload: Buffer): Buffer {
  const header = Buffer.alloc(5);
  header.write(type, 0, "ascii");
  header.writeInt32BE(payload.length + 4, 1);
  return Buffer.concat([header, payload]);
}

function passwordMessage(password: string): Buffer {
  return message("p", cstring(password));
}

function startupMessage(config: PgConfig): Buffer {
  const params = Buffer.concat([
    cstring("user"),
    cstring(config.user),
    cstring("database"),
    cstring(config.database),
    cstring("client_encoding"),
    cstring("UTF8"),
    Buffer.from([0]),
  ]);
  const buffer = Buffer.alloc(8);
  buffer.writeInt32BE(params.length + 8, 0);
  buffer.writeInt32BE(196608, 4);
  return Buffer.concat([buffer, params]);
}

function md5Password(password: string, user: string, salt: Buffer): string {
  const inner = crypto.createHash("md5").update(password + user).digest("hex");
  return `md5${crypto.createHash("md5").update(Buffer.concat([Buffer.from(inner), salt])).digest("hex")}`;
}

function xor(left: Buffer, right: Buffer): Buffer {
  return Buffer.from(left.map((value, index) => value ^ right[index]));
}

function hmac(key: Buffer, value: string): Buffer {
  return crypto.createHmac("sha256", key).update(value).digest();
}

function parseSaslAttributes(input: string): Record<string, string> {
  return Object.fromEntries(input.split(",").map((part) => [part.slice(0, 1), part.slice(2)]));
}

function buildScramFirstMessage() {
  const nonce = crypto.randomBytes(18).toString("base64");
  const bare = `n=*,r=${nonce}`;
  return {
    nonce,
    bare,
    full: `n,,${bare}`,
  };
}

function buildScramFinalMessage(password: string, firstBare: string, serverFirst: string) {
  const attrs = parseSaslAttributes(serverFirst);
  const clientFinalWithoutProof = `c=biws,r=${attrs.r}`;
  const salt = Buffer.from(attrs.s, "base64");
  const iterations = Number(attrs.i);
  const saltedPassword = crypto.pbkdf2Sync(password, salt, iterations, 32, "sha256");
  const clientKey = hmac(saltedPassword, "Client Key");
  const storedKey = crypto.createHash("sha256").update(clientKey).digest();
  const authMessage = `${firstBare},${serverFirst},${clientFinalWithoutProof}`;
  const clientSignature = hmac(storedKey, authMessage);
  const clientProof = xor(clientKey, clientSignature).toString("base64");
  const serverSignature = hmac(hmac(saltedPassword, "Server Key"), authMessage).toString("base64");

  return {
    message: `${clientFinalWithoutProof},p=${clientProof}`,
    serverSignature,
  };
}

function saslInitialResponse(mechanism: string, response: string): Buffer {
  const mechanismBuffer = cstring(mechanism);
  const responseBuffer = Buffer.from(response, "utf8");
  const lengthBuffer = Buffer.alloc(4);
  lengthBuffer.writeInt32BE(responseBuffer.length, 0);
  return message("p", Buffer.concat([mechanismBuffer, lengthBuffer, responseBuffer]));
}

function readCString(buffer: Buffer, offset: number) {
  const end = buffer.indexOf(0, offset);
  return {
    value: buffer.toString("utf8", offset, end),
    nextOffset: end + 1,
  };
}

function parseRowDescription(payload: Buffer): PgField[] {
  const count = payload.readInt16BE(0);
  const fields: PgField[] = [];
  let offset = 2;

  for (let index = 0; index < count; index += 1) {
    const parsed = readCString(payload, offset);
    fields.push({ name: parsed.value });
    offset = parsed.nextOffset + 18;
  }

  return fields;
}

function parseDataRow(payload: Buffer, fields: PgField[]): PgRow {
  const count = payload.readInt16BE(0);
  const row: PgRow = {};
  let offset = 2;

  for (let index = 0; index < count; index += 1) {
    const length = payload.readInt32BE(offset);
    offset += 4;
    row[fields[index]?.name ?? `column_${index}`] =
      length === -1 ? null : payload.toString("utf8", offset, offset + length);
    if (length !== -1) offset += length;
  }

  return row;
}

function parseError(payload: Buffer): string {
  const parts: string[] = [];
  let offset = 0;

  while (offset < payload.length && payload[offset] !== 0) {
    const code = String.fromCharCode(payload[offset]);
    const parsed = readCString(payload, offset + 1);
    if (code === "S" || code === "M" || code === "D" || code === "H") {
      parts.push(parsed.value);
    }
    offset = parsed.nextOffset;
  }

  return parts.join(": ") || "PostgreSQL error";
}

function createMessageReader(socket: net.Socket) {
  let buffer = Buffer.alloc(0);
  let failure: Error | null = null;
  let notify: (() => void) | null = null;

  socket.on("data", (chunk: Buffer) => {
    buffer = Buffer.concat([buffer, chunk]);
    notify?.();
  });

  socket.on("error", (error: Error) => {
    failure = error;
    notify?.();
  });

  socket.on("end", () => {
    failure = new Error("PostgreSQL connection ended unexpectedly");
    notify?.();
  });

  async function waitForData(): Promise<void> {
    if (failure) throw failure;
    await new Promise<void>((resolve) => {
      notify = resolve;
    });
    notify = null;
    if (failure) throw failure;
  }

  return async function readMessage(): Promise<{ type: string; payload: Buffer }> {
    while (buffer.length < 5) {
      await waitForData();
    }

    const length = buffer.readInt32BE(1);
    const totalLength = length + 1;

    while (buffer.length < totalLength) {
      await waitForData();
    }

    const packet = buffer.subarray(0, totalLength);
    buffer = buffer.subarray(totalLength);

    return {
      type: packet.toString("ascii", 0, 1),
      payload: packet.subarray(5),
    };
  };
}

async function authenticate(
  socket: net.Socket,
  config: PgConfig,
  readMessage: () => Promise<{ type: string; payload: Buffer }>,
): Promise<void> {
  const scramFirst = buildScramFirstMessage();
  let expectedServerSignature = "";
  let authenticated = false;

  while (true) {
    const packet = await readMessage();

    if (packet.type === "E") {
      throw new Error(parseError(packet.payload));
    }

    if (packet.type !== "R") {
      if (packet.type === "Z" && authenticated) return;
      continue;
    }

    const authType = packet.payload.readInt32BE(0);

    if (authType === AUTH_OK) {
      authenticated = true;
      continue;
    }

    if (authType === AUTH_CLEAR_TEXT) {
      socket.write(passwordMessage(config.password));
      continue;
    }

    if (authType === AUTH_MD5) {
      socket.write(passwordMessage(md5Password(config.password, config.user, packet.payload.subarray(4, 8))));
      continue;
    }

    if (authType === AUTH_SASL) {
      socket.write(saslInitialResponse("SCRAM-SHA-256", scramFirst.full));
      continue;
    }

    if (authType === AUTH_SASL_CONTINUE) {
      const serverFirst = packet.payload.toString("utf8", 4);
      const final = buildScramFinalMessage(config.password, scramFirst.bare, serverFirst);
      expectedServerSignature = final.serverSignature;
      socket.write(message("p", Buffer.from(final.message, "utf8")));
      continue;
    }

    if (authType === AUTH_SASL_FINAL) {
      const attrs = parseSaslAttributes(packet.payload.toString("utf8", 4));
      if (attrs.v !== expectedServerSignature) {
        throw new Error("PostgreSQL SCRAM server signature mismatch");
      }
      continue;
    }

    throw new Error(`Unsupported PostgreSQL authentication type: ${authType}`);
  }
}

function connect(config: PgConfig): Promise<net.Socket> {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host: config.host, port: config.port });
    const timeout = setTimeout(() => {
      cleanup();
      socket.destroy();
      reject(new Error("PostgreSQL connection timed out"));
    }, 5_000);
    timeout.unref?.();

    const cleanup = () => {
      clearTimeout(timeout);
      socket.off("connect", onConnect);
      socket.off("error", onError);
    };
    const onConnect = () => {
      cleanup();
      resolve(socket);
    };
    const onError = (error: Error) => {
      cleanup();
      reject(error);
    };

    socket.once("connect", onConnect);
    socket.once("error", onError);
  });
}

export async function queryPostgres(sql: string, options: { timeoutMs?: number } = {}): Promise<PgRow[]> {
  const config = getConfig();
  const socket = await connect(config);
  const readMessage = createMessageReader(socket);
  const queryTimer = options.timeoutMs ? setTimeout(() => socket.destroy(new Error("PostgreSQL query timed out")), options.timeoutMs) : undefined;
  let fields: PgField[] = [];
  let rows: PgRow[] = [];

  try {
    socket.write(startupMessage(config));
    await authenticate(socket, config, readMessage);
    socket.write(message("Q", cstring(sql)));

    while (true) {
      const packet = await readMessage();

      if (packet.type === "T") {
        fields = parseRowDescription(packet.payload);
        rows = [];
        continue;
      }

      if (packet.type === "D") {
        rows.push(parseDataRow(packet.payload, fields));
        continue;
      }

      if (packet.type === "E") {
        throw new Error(parseError(packet.payload));
      }

      if (packet.type === "Z") {
        return rows;
      }
    }
  } finally {
    if (queryTimer) clearTimeout(queryTimer);
    socket.end();
  }
}

export interface PgReadOnlySnapshot {
  query(sql: string): Promise<PgRow[]>;
  stream(sql: string, onRow: (row: PgRow) => Promise<void>): Promise<void>;
}

/** A dedicated connection: all reads share one snapshot, and cursors bound result memory. */
export async function withPostgresReadOnlySnapshot<T>(
  work: (client: PgReadOnlySnapshot) => Promise<T>,
  options: { batchSize?: number; timeoutMs?: number; signal?: AbortSignal } = {},
): Promise<T> {
  const batchSize = options.batchSize ?? 1000;
  const timeoutMs = options.timeoutMs ?? 60_000;
  if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 10_000) throw new Error("Invalid PostgreSQL cursor batch size");
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 600_000) throw new Error("Invalid PostgreSQL query timeout");
  options.signal?.throwIfAborted();
  const config = getConfig();
  const socket = await connect(config);
  const readMessage = createMessageReader(socket);
  const abort = () => socket.destroy(new Error("Veri aktarımı iptal edildi."));
  options.signal?.addEventListener("abort", abort, { once: true });
  let cursorIndex = 0;
  let busy = false;

  const timed = async <R>(operation: () => Promise<R>): Promise<R> => {
    options.signal?.throwIfAborted();
    const timer = setTimeout(() => socket.destroy(new Error("PostgreSQL query timed out")), timeoutMs);
    try { return await operation(); } finally { clearTimeout(timer); }
  };
  const query = async (sql: string): Promise<PgRow[]> => {
    if (busy) throw new Error("Snapshot queries must run sequentially");
    if (sql.includes("\0")) throw new Error("SQL must not contain a null byte");
    busy = true;
    try {
      return await timed(async () => {
        socket.write(message("Q", cstring(sql)));
        let fields: PgField[] = [];
        const rows: PgRow[] = [];
        while (true) {
          const packet = await readMessage();
          if (packet.type === "T") fields = parseRowDescription(packet.payload);
          else if (packet.type === "D") rows.push(parseDataRow(packet.payload, fields));
          else if (packet.type === "E") throw new Error(parseError(packet.payload));
          else if (packet.type === "Z") return rows;
        }
      });
    } finally { busy = false; }
  };
  try {
    await timed(async () => {
      socket.write(startupMessage(config));
      await authenticate(socket, config, readMessage);
    });
    await query("BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY");
    await query("SET LOCAL TIME ZONE 'UTC'");
    await query("SET LOCAL standard_conforming_strings = on");
    await query(`SET LOCAL statement_timeout = ${timeoutMs}`);
    const result = await work({
      query,
      stream: async (sql, onRow) => {
        const cursor = `uwb_export_${++cursorIndex}`;
        await query(`DECLARE ${cursor} NO SCROLL CURSOR FOR ${sql}`);
        while (true) {
          const rows = await query(`FETCH FORWARD ${batchSize} FROM ${cursor}`);
          for (const row of rows) { options.signal?.throwIfAborted(); await onRow(row); }
          if (rows.length < batchSize) break;
        }
        await query(`CLOSE ${cursor}`);
      },
    });
    await query("COMMIT");
    return result;
  } finally {
    options.signal?.removeEventListener("abort", abort);
    // Disconnect also rolls back an interrupted transaction and closes its cursors.
    socket.destroy();
  }
}
