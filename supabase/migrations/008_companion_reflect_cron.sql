-- Schedule companion reflection every 4 hours
select cron.schedule(
  'companion-reflect',
  '0 */4 * * *',
  $$
  select net.http_post(
    url := 'https://enjnvmrzjkprzovdjxxa.supabase.co/functions/v1/companion-reflect',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || current_setting('supabase.service_role_key', true)
    ),
    body := '{"mode": "reflect"}'::jsonb
  );
  $$
);
