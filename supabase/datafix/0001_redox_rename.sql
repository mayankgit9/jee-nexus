-- JEE NEXUS datafix 0001: rename chemistry:redox-reactions chapter.
-- Its name was "Redox Reactions and Electrochemistry" from the original
-- 65-chapter seed; migration 0005 added the separate Electrochemistry
-- chapter, but the old name was never corrected — the year breakdown now
-- shows a chapter that claims to cover BOTH topics next to a dedicated
-- Electrochemistry chapter. Pure DML (UPDATE) — safe for the jee_app role
-- via the apply-migration workflow.
update chapters set name = 'Redox Reactions'
where key = 'chemistry:redox-reactions' and name <> 'Redox Reactions';
