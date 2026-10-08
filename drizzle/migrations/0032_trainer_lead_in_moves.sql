-- 0025_trainer_lead_in_moves.sql
-- Add lead_in_moves column to trainer_saved_position.
-- Stores a JSON array of SAN moves from the standard starting position to
-- the saved FEN, so training PGNs always start from move 1.

ALTER TABLE trainer_saved_position ADD COLUMN lead_in_moves TEXT;
