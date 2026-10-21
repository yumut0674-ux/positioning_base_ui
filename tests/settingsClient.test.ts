import assert from "node:assert/strict";
import test from "node:test";
import { QueryClient, QueryObserver } from "@tanstack/react-query";
import { fetchSystemSettings, normalizeSystemSettingsResponse, saveSystemSettings } from "../src/features/settings/services/settingsApi";

test("settings client fills missing report defaults and preserves saved thresholds", async context => {
  const legacy = { version: 1, tracking: { noDataHideAfterMs: 120_000 } };
  let responseSettings: unknown = legacy;
  let sent: RequestInit | undefined;
  context.mock.method(globalThis, "fetch", async (_input: unknown, init?: RequestInit) => {
    sent = init;
    return Response.json({ settings: responseSettings, defaults: legacy });
  });
  const initial = await fetchSystemSettings();
  assert.equal(initial.settings.reports.routeHistoryMinDurationMs, 60_000);
  assert.equal(initial.defaults.reports.routeHistoryMinDurationMs, 60_000);
  assert.equal(initial.settings.tracking.noDataHideAfterMs, 120_000);

  for (const threshold of [0, 120_000]) {
    const settings = { ...initial.settings, reports: { routeHistoryMinDurationMs: threshold } };
    responseSettings = settings;
    assert.deepEqual((await saveSystemSettings(settings)).settings, settings);
    assert.deepEqual(JSON.parse(String(sent?.body)), settings);
  }
});

test("settings observer can render a legacy cached response before refetching", () => {
  const client = new QueryClient();
  const legacy = { version: 1, tracking: { noDataHideAfterMs: 60_000 } };
  const cached = { settings: legacy, defaults: legacy };
  client.setQueryData(["system-settings"], cached);
  const observer = new QueryObserver(client, {
    queryKey: ["system-settings"], queryFn: fetchSystemSettings, enabled: false, select: normalizeSystemSettingsResponse,
  });
  try {
    const result = observer.getCurrentResult();
    assert.equal(result.status, "success");
    assert.equal(result.data?.settings.reports.routeHistoryMinDurationMs, 60_000);
    assert.deepEqual(client.getQueryData(["system-settings"]), cached);
  } finally { observer.destroy(); client.clear(); }
});
