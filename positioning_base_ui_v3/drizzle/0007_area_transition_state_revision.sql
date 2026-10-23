ALTER TABLE tag_area_states ADD COLUMN IF NOT EXISTS revision BIGINT NOT NULL DEFAULT 0;
CREATE INDEX IF NOT EXISTS idx_area_events_transition ON tag_area_events(transition_id) WHERE transition_id IS NOT NULL;
