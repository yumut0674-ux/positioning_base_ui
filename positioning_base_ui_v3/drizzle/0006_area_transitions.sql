CREATE TABLE IF NOT EXISTS tag_area_states (
  tag_code TEXT NOT NULL,
  map_id TEXT NOT NULL,
  area_id TEXT NOT NULL,
  state JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (tag_code, map_id, area_id)
);

CREATE TABLE IF NOT EXISTS tag_area_events (
  id TEXT PRIMARY KEY,
  tag_code TEXT NOT NULL,
  map_id TEXT NOT NULL,
  area_id TEXT NOT NULL,
  area_name TEXT NOT NULL,
  gate_id TEXT,
  event_type TEXT NOT NULL,
  observed BOOLEAN NOT NULL,
  last_measured_at TIMESTAMPTZ NOT NULL,
  decided_at TIMESTAMPTZ NOT NULL,
  reason TEXT NOT NULL,
  config_version TEXT NOT NULL,
  transition_id TEXT,
  payload JSONB NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_area_events_time ON tag_area_events(decided_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_area_events_tag_time ON tag_area_events(tag_code, decided_at DESC);
CREATE INDEX IF NOT EXISTS idx_area_events_area_time ON tag_area_events(map_id, area_id, decided_at DESC);
