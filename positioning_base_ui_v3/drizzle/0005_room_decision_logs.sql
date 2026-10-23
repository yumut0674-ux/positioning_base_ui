-- Expand-only decision-log projection. The full immutable decision remains in payload.
ALTER TABLE tag_room_decisions ADD COLUMN IF NOT EXISTS event_type TEXT;
ALTER TABLE tag_room_decisions ADD COLUMN IF NOT EXISTS severity TEXT;
ALTER TABLE tag_room_decisions ADD COLUMN IF NOT EXISTS state TEXT;
ALTER TABLE tag_room_decisions ADD COLUMN IF NOT EXISTS region_id TEXT;
ALTER TABLE tag_room_decisions ADD COLUMN IF NOT EXISTS candidate_region_id TEXT;
ALTER TABLE tag_room_decisions ADD COLUMN IF NOT EXISTS measurement_kind TEXT;
ALTER TABLE tag_room_decisions ADD COLUMN IF NOT EXISTS confidence DOUBLE PRECISION;
ALTER TABLE tag_room_decisions ADD COLUMN IF NOT EXISTS reason_codes TEXT[];

CREATE INDEX IF NOT EXISTS idx_room_decisions_published
  ON tag_room_decisions(published_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_room_decisions_region_time
  ON tag_room_decisions(region_id, published_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_room_decisions_event_time
  ON tag_room_decisions(event_type, published_at DESC, id DESC);
