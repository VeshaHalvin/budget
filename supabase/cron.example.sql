-- Run this ONCE in the Supabase SQL Editor after deploying the functions.
-- It makes the database call the poll-gmail function every 2 minutes.
-- Copy to cron.sql and replace the two placeholder values first.

create extension if not exists pg_cron;
create extension if not exists pg_net;

select vault.create_secret('https://YOUR-PROJECT-REF.supabase.co', 'project_url');
select vault.create_secret('YOUR-CRON-SECRET', 'cron_secret');

select cron.schedule(
  'poll-gmail',
  '*/2 * * * *',
  $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url')
           || '/functions/v1/poll-gmail',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 30000
  );
  $$
);
