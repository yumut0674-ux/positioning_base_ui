-- PostgreSQL migration for durable UWB position history.
-- Apply after 0001_tracked_entities_and_tag_assignments.sql.
CREATE TABLE IF NOT EXISTS tag_location_history (
  id BIGSERIAL PRIMARY KEY,
  tag_code VARCHAR(100) NOT NULL,
  x DOUBLE PRECISION NOT NULL,
  y DOUBLE PRECISION NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tag_location_history_tag_time
  ON tag_location_history (tag_code, created_at DESC, id DESC);

COMMENT ON TABLE tag_location_history IS
  'Only positions for tag codes registered in the tags table are persisted by TrackingBuffer.';
