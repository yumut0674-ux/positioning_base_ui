-- Bu migration bilerek otomatik uygulanmaz. Önce yedek ve bakım penceresi doğrulanmalıdır.
CREATE TABLE IF NOT EXISTS tracked_entities (
  id BIGSERIAL PRIMARY KEY,
  entity_code VARCHAR(100) UNIQUE NOT NULL,
  name VARCHAR(150) NOT NULL,
  entity_type VARCHAR(50) NOT NULL DEFAULT 'product',
  aliases TEXT[] NOT NULL DEFAULT '{}',
  status VARCHAR(30) NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS tag_assignments (
  id BIGSERIAL PRIMARY KEY,
  entity_id BIGINT NOT NULL REFERENCES tracked_entities(id),
  tag_code VARCHAR(100) NOT NULL,
  assigned_at TIMESTAMPTZ NOT NULL,
  unassigned_at TIMESTAMPTZ,
  CONSTRAINT tag_assignments_valid_range CHECK (unassigned_at IS NULL OR unassigned_at > assigned_at)
);

CREATE INDEX IF NOT EXISTS idx_tag_assignments_entity_time ON tag_assignments (entity_id, assigned_at DESC);
CREATE INDEX IF NOT EXISTS idx_tag_assignments_tag_time ON tag_assignments (tag_code, assigned_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_tag_assignments_one_active_tag ON tag_assignments (tag_code) WHERE unassigned_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_tag_assignments_one_active_entity ON tag_assignments (entity_id) WHERE unassigned_at IS NULL;

INSERT INTO tracked_entities (entity_code, name, entity_type, aliases, status, created_at)
SELECT tag_code, COALESCE(display_name, tag_name, tag_code), 'tracked_tag', '{}', status, created_at
FROM tags ON CONFLICT (entity_code) DO NOTHING;

INSERT INTO tag_assignments (entity_id, tag_code, assigned_at)
SELECT e.id, t.tag_code, t.created_at
FROM tags t JOIN tracked_entities e ON e.entity_code = t.tag_code
WHERE t.status = 'active' AND NOT EXISTS (
  SELECT 1 FROM tag_assignments a
  WHERE a.entity_id = e.id AND a.tag_code = t.tag_code AND a.unassigned_at IS NULL
);
