-- Assessment deadlines belong to the original document, not the chosen study day.
-- Older saved sessions deliberately have NULL until their deadline can be verified.
ALTER TABLE study_pathway_sessions ADD COLUMN deadline_date TEXT;
