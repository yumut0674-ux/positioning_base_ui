CREATE TABLE IF NOT EXISTS room_test_sessions (
  id TEXT PRIMARY KEY,
  version INTEGER NOT NULL DEFAULT 0,
  payload JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS room_test_sessions_updated_idx ON room_test_sessions(updated_at DESC, id);
CREATE TABLE IF NOT EXISTS room_test_actions (
  session_id TEXT NOT NULL REFERENCES room_test_sessions(id),
  action_id UUID NOT NULL,
  sequence INTEGER NOT NULL,
  payload JSONB NOT NULL,
  received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (session_id, action_id),
  UNIQUE (session_id, sequence)
);
