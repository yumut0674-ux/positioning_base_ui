CREATE TABLE IF NOT EXISTS tag_room_decisions (
  id BIGSERIAL PRIMARY KEY,
  event_id TEXT,
  tag_code VARCHAR(100) NOT NULL,
  measured_at TIMESTAMPTZ NOT NULL,
  published_at TIMESTAMPTZ NOT NULL,
  engine_version TEXT NOT NULL,
  config_version TEXT NOT NULL,
  payload JSONB NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_room_decisions_tag_time ON tag_room_decisions(tag_code, published_at DESC, id DESC);
ALTER TABLE tag_room_decisions ADD COLUMN IF NOT EXISTS event_id TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_room_decisions_event_id ON tag_room_decisions(event_id);
ALTER TABLE tag_location_history ADD COLUMN IF NOT EXISTS received_at TIMESTAMPTZ;
ALTER TABLE tag_location_history ADD COLUMN IF NOT EXISTS quality DOUBLE PRECISION;
