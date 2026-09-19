-- Expand-only migration. Existing rows intentionally remain unmapped (NULL).
ALTER TABLE tag_location_history ADD COLUMN IF NOT EXISTS zone_id VARCHAR(100);
ALTER TABLE tag_location_history ADD COLUMN IF NOT EXISTS zone_name VARCHAR(160);
ALTER TABLE tag_location_history ADD COLUMN IF NOT EXISTS map_id VARCHAR(100);
CREATE INDEX IF NOT EXISTS idx_tag_location_history_tag_map_time
  ON tag_location_history(tag_code, map_id, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_tag_location_history_map_time
  ON tag_location_history(map_id, created_at DESC, id DESC);

ALTER TABLE tag_room_decisions ADD COLUMN IF NOT EXISTS map_id VARCHAR(100);
ALTER TABLE tag_room_decisions ADD COLUMN IF NOT EXISTS zone_id VARCHAR(100);
CREATE INDEX IF NOT EXISTS idx_room_decisions_tag_map_time
  ON tag_room_decisions(tag_code, map_id, published_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_room_decisions_map_time
  ON tag_room_decisions(map_id, published_at DESC, id DESC);

ALTER TABLE IF EXISTS anchors ADD COLUMN IF NOT EXISTS map_id VARCHAR(100);
DO $$
BEGIN
  IF to_regclass('public.anchors') IS NOT NULL THEN
    CREATE INDEX IF NOT EXISTS idx_anchors_map_id ON anchors(map_id);
  END IF;
END $$;
