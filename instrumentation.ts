/** Start room detection before the server handles its first page or API request. */
export async function register(): Promise<void> {
  const { regionEngineController } = await import("./src/server/regionEngine/controller");
  const { logger } = await import("./src/server/logger");
  try {
    await regionEngineController.setEnabled(true);
  } catch (error) {
    logger.error("region_engine.startup_failed", error);
  }
}
