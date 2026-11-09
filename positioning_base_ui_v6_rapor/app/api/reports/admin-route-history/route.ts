import { createAdminRouteReportHandler } from "@/src/server/reports/adminRouteReportHttp";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const POST = createAdminRouteReportHandler();
