-- Face check diagnostics: keep the liveness score and Rekognition's retry hints
-- with each attempt, so failures can be explained and the pass mark tuned.
-- Additive only; safe on existing data.
ALTER TABLE driver_face_checks ADD COLUMN IF NOT EXISTS liveness_confidence DOUBLE PRECISION;
ALTER TABLE driver_face_checks ADD COLUMN IF NOT EXISTS detail TEXT;
