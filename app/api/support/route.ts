import { NextResponse } from "next/server";
import { queryPostgres } from "@/src/server/postgresClient";

export const runtime = "nodejs";

type SupportMessageInput = {
  messageType?: unknown;
  senderName?: unknown;
  senderEmail?: unknown;
  subject?: unknown;
  message?: unknown;
};

const schemaSql = `
CREATE TABLE IF NOT EXISTS support_messages (
  id BIGSERIAL PRIMARY KEY,
  message_type VARCHAR(30) NOT NULL,
  sender_name VARCHAR(150) NOT NULL,
  sender_email VARCHAR(255) NOT NULL,
  subject VARCHAR(180) NOT NULL,
  message TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_support_messages_created_at
  ON support_messages (created_at DESC);
`;

const allowedMessageTypes = new Set(["support", "suggestion", "bug"]);

function sqlString(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

function cleanText(value: unknown, label: string, minimum: number, maximum: number): string {
  if (typeof value !== "string") throw new Error(`${label} is required`);
  const cleaned = value.trim();
  if (cleaned.length < minimum || cleaned.length > maximum) {
    throw new Error(`${label} must be between ${minimum} and ${maximum} characters`);
  }
  return cleaned;
}

function cleanMessage(input: SupportMessageInput) {
  const messageType = typeof input.messageType === "string" ? input.messageType.trim() : "";
  if (!allowedMessageTypes.has(messageType)) throw new Error("Message type is invalid");

  const senderName = cleanText(input.senderName, "Name", 2, 150);
  const senderEmail = cleanText(input.senderEmail, "Email", 5, 255).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(senderEmail)) throw new Error("Email is invalid");

  return {
    messageType,
    senderName,
    senderEmail,
    subject: cleanText(input.subject, "Subject", 3, 180),
    message: cleanText(input.message, "Message", 10, 4000),
  };
}

export async function POST(request: Request) {
  try {
    const input = cleanMessage((await request.json()) as SupportMessageInput);
    const rows = await queryPostgres(`${schemaSql}
      INSERT INTO support_messages (message_type, sender_name, sender_email, subject, message)
      VALUES (
        ${sqlString(input.messageType)},
        ${sqlString(input.senderName)},
        ${sqlString(input.senderEmail)},
        ${sqlString(input.subject)},
        ${sqlString(input.message)}
      )
      RETURNING id, created_at AS "createdAt";
    `);
    const row = rows[0];
    return NextResponse.json({ message: { id: row?.id ?? "", createdAt: row?.createdAt ?? "" } }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Support message could not be saved";
    const isInputError = /required|between|invalid/.test(message);
    return NextResponse.json({ error: message }, { status: isInputError ? 400 : 500 });
  }
}
