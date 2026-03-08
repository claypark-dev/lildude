-- 019_cron_channel_routing.sql
-- Add channel routing, owner tracking, and expiry support to cron_jobs.
-- Required for delivering cron job output to the correct channel
-- and supporting time-bounded recurrence (e.g. "for the next two hours").

ALTER TABLE cron_jobs ADD COLUMN channel_type TEXT;
ALTER TABLE cron_jobs ADD COLUMN channel_id TEXT;
ALTER TABLE cron_jobs ADD COLUMN owner_id TEXT;
ALTER TABLE cron_jobs ADD COLUMN expires_at DATETIME;
