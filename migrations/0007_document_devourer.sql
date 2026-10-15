-- Document Devourer: process-and-forget documents.
--
-- Additive only. Every existing document becomes retention = 'keep', which
-- is exactly how documents behaved before this migration.
--
--   retention 'temporary' (default for new uploads, "Just sort it"): the
--     original lives under tmp/ in R2 until the user finishes reviewing, and
--     never longer than expires_at. Extracted text is not stored. Finishing,
--     cancelling, failing or expiring deletes the original, its pending
--     suggestions and this row; approved tasks/reminders/events stay.
--   retention 'keep' ("Keep this document"): saved until the user deletes it
--     and counted against the plan's storage allowance.

PRAGMA foreign_keys = ON;

ALTER TABLE documents ADD COLUMN retention TEXT NOT NULL DEFAULT 'keep'
  CHECK (retention IN ('keep', 'temporary'));
-- Hard deadline for temporary originals and for uploads that never finished.
ALTER TABLE documents ADD COLUMN expires_at TEXT;
-- What the goblin thinks this is (bill, appointment, school, …) and its
-- one-line explanation. Removed with the row for temporary documents.
ALTER TABLE documents ADD COLUMN document_type TEXT;
ALTER TABLE documents ADD COLUMN goblin_summary TEXT;

CREATE INDEX idx_documents_expiry ON documents(expires_at);
CREATE INDEX idx_documents_user_retention ON documents(user_id, retention);
