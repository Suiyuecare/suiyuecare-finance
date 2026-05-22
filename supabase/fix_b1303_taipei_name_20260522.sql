-- Normalize B1303 department wording.

update public.system_settings
set value = (
  select jsonb_agg(
    case
      when item->>'c' = 'B1303' then jsonb_set(item, '{n}', to_jsonb('臺北到宅訓練課'::text), true)
      else item
    end
  )
  from jsonb_array_elements(value::jsonb) as item
)
where key = 'departments';
