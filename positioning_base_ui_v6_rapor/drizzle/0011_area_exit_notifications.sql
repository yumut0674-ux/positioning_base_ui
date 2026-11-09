ALTER TABLE IF EXISTS tags ADD COLUMN IF NOT EXISTS area_exit_notification_enabled BOOLEAN NOT NULL DEFAULT TRUE;
CREATE TABLE IF NOT EXISTS area_exit_notifications (
  notification_id TEXT PRIMARY KEY,
  tag_code VARCHAR(100) NOT NULL,
  map_id VARCHAR(100) NOT NULL,
  area_id TEXT,
  created_at TIMESTAMPTZ NOT NULL,
  payload JSONB NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_area_exit_notifications_time ON area_exit_notifications(created_at DESC, notification_id DESC);
CREATE INDEX IF NOT EXISTS idx_area_exit_notifications_tag_time ON area_exit_notifications(tag_code, created_at DESC);
