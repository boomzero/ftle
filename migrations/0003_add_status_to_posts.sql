ALTER TABLE posts ADD COLUMN status TEXT NOT NULL DEFAULT 'listed';
UPDATE posts SET status = CASE WHEN listed = 1 THEN 'listed' ELSE 'unlisted' END;
ALTER TABLE posts DROP COLUMN listed;
