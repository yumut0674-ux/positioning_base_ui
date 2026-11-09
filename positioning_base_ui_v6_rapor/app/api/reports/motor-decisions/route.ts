import { createDecisionReportHandler } from "@/src/server/reports/decisionReportHttp";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const POST = createDecisionReportHandler();
