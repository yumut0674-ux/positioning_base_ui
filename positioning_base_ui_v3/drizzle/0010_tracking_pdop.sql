-- Existing measurements keep unknown geometry quality (NULL).
ALTER TABLE tag_location_history ADD COLUMN IF NOT EXISTS pdop DOUBLE PRECISION;
COMMENT ON COLUMN tag_location_history.pdop IS
  'Dimensionless position geometry quality; NULL means unknown. Ingest discards values above 20.';
