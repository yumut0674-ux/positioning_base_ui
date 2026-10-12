CREATE TABLE IF NOT EXISTS assistant_settings (
  id SMALLINT PRIMARY KEY CHECK (id = 1),
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  version INTEGER NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by TEXT,
  recording_started_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
INSERT INTO assistant_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS assistant_requests (
  id UUID PRIMARY KEY,
  session_key TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  duration_ms INTEGER,
  question TEXT NOT NULL,
  answer TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','success','error','disabled','interrupted')),
  provider TEXT CHECK (provider IN ('local','gemini')),
  model TEXT,
  mode TEXT CHECK (mode IN ('live','history')),
  error_code TEXT,
  error_summary TEXT,
  upstream_status INTEGER,
  provider_attempted BOOLEAN NOT NULL DEFAULT FALSE
);
CREATE INDEX IF NOT EXISTS assistant_requests_created_idx ON assistant_requests (created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS assistant_requests_status_created_idx ON assistant_requests (status, created_at DESC);
CREATE INDEX IF NOT EXISTS assistant_requests_pending_idx ON assistant_requests (created_at) WHERE status = 'pending';

CREATE TABLE IF NOT EXISTS assistant_setting_events (
  id BIGSERIAL PRIMARY KEY,
  old_enabled BOOLEAN NOT NULL,
  new_enabled BOOLEAN NOT NULL,
  version INTEGER NOT NULL,
  changed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  changed_by TEXT NOT NULL
);
