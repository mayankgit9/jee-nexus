-- 0018: hide watermark-destroyed exam figures (2026-11-28)
-- The ExamGOAL re-rendered corpus contains ~1,290 'giant' figures where the
-- watermark stamp overlapped/replaced the actual figure content. A hidden
-- flag keeps the mapping (and the AI-remake queue) intact while excluding
-- unusable images from every read path. Remade images flip back to false.

ALTER TABLE question_images ADD COLUMN IF NOT EXISTS hidden BOOLEAN NOT NULL DEFAULT false;
