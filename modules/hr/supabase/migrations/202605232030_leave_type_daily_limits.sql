begin;

update public.system_settings
set
  settings = jsonb_set(
    jsonb_set(
      settings,
      '{rules}',
      (
        select jsonb_agg(
          rule
          || jsonb_build_object(
            'minimumUnitMinutes',
            coalesce(
              nullif(rule ->> 'minimumUnitMinutes', '')::numeric,
              coalesce(nullif(rule ->> 'minimumUnitHours', '')::numeric, 1) * 60
            )::integer,
            'minimumUnitHours',
            coalesce(
              nullif(rule ->> 'minimumUnitMinutes', '')::numeric / 60,
              coalesce(nullif(rule ->> 'minimumUnitHours', '')::numeric, 1)
            ),
            'maxDailyHours',
            coalesce(nullif(rule ->> 'maxDailyHours', '')::numeric, 8)
          )
        )
        from jsonb_array_elements(settings -> 'rules') as rule
      )
    ),
    '{dailyLimitPolicy}',
    jsonb_build_object(
      'minimumUnitSource', 'minimumUnitMinutes',
      'defaultMaxDailyHours', 8,
      'blocking', true,
      'updatedAt', now()
    ),
    true
  ),
  version = version + 1,
  updated_at = now()
where setting_key = 'leave_type_rules'
  and category = 'leave_rules'
  and deleted_at is null
  and jsonb_typeof(settings -> 'rules') = 'array';

commit;
