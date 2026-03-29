-- Enable required extensions
create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;

-- Schedule companion outreach every hour at :15
-- Uses the service_role_key from Supabase vault for auth
select cron.schedule(
  'companion-outreach',
  '15 * * * *',
  $$
  select net.http_post(
    url := 'https://enjnvmrzjkprzovdjxxa.supabase.co/functions/v1/companion-outreach',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || current_setting('supabase.service_role_key', true)
    ),
    body := '{"mode": "outreach"}'::jsonb
  );
  $$
);
