-- Normalize B1304 department name to use official Traditional Chinese wording.
update public.system_settings
set value = (
  select jsonb_agg(
    case
      when item->>'c' = 'B1304' then jsonb_set(item, '{n}', to_jsonb('臺北集中訓練課'::text), true)
      else item
    end
  )
  from jsonb_array_elements(value::jsonb) as item
)
where key = 'departments';
