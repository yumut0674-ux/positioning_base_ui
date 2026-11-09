/** Start room detection before the server handles its first page or API request. */
export async function register(): Promise<void> {
  const { tagPresenceRuntime } = await import("./src/server/tracking/tagPresenceRuntime");
  await tagPresenceRuntime.start();
  const { regionEngineController } = await import("./src/server/regionEngine/controller");
  const { logger } = await import("./src/server/logger");
  const { notificationRuntime } = await import("./src/server/notifications/notificationRuntime");
  try { await notificationRuntime.start(); }
  catch (error) { logger.error("notifications.startup_failed", error); }
  try {
    await regionEngineController.setEnabled(true);
  } catch (error) {
    logger.error("region_engine.startup_failed", error);
  }
}
