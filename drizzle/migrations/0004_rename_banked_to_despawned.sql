-- Data migration: rename inventory status value 'banked' → 'despawned'.
-- The old design-doc name 'banked' was jargon for "despawned, you have
-- leftover units"; the community uses 'despawned' for the same state.
-- Idempotent: re-running has no effect once rows are updated.
UPDATE inventory_entries SET status = 'despawned' WHERE status = 'banked';
