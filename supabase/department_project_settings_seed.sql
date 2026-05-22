-- Seed/repair selectable department-project settings used by the frontend,
-- dashboards, ledgers, and three financial statements.
-- This preserves existing system_settings.departments rows by code, but forces
-- D1000/E1000 to be selectable for 「該筆費用支出組別/部門/專案」.

with base_departments(value) as (
  values (
    '[
      {"c":"A1000","n":"歲悅股份有限公司","eid":"E1","lv":0},
      {"c":"A1100","n":"行政部","eid":"E1","lv":1},
      {"c":"A1101","n":"會計課","eid":"E1","lv":2},
      {"c":"A1102","n":"人資課","eid":"E1","lv":2},
      {"c":"A1103","n":"行政總務課","eid":"E1","lv":2},
      {"c":"A1200","n":"教學品管部","eid":"E1","lv":1},
      {"c":"A1201","n":"教學課","eid":"E1","lv":2},
      {"c":"A1202","n":"品管課","eid":"E1","lv":2},
      {"c":"B1000","n":"歲悅股份有限公司附設臺北市私立歲悅居家長照機構","eid":"E5","lv":0},
      {"c":"B1100","n":"長照部","eid":"E5","lv":1},
      {"c":"B1101","n":"居家照顧課","eid":"E5","lv":2},
      {"c":"B1102","n":"士林失智據點課","eid":"E5","lv":2,"shared":true},
      {"c":"B1103","n":"大同失智據點課","eid":"E5","lv":2,"shared":true},
      {"c":"B1104","n":"信義失智據點課","eid":"E5","lv":2,"shared":true},
      {"c":"B1300","n":"移工培訓部","eid":"E5","lv":1},
      {"c":"B1301","n":"數位學習課","eid":"E5","lv":2},
      {"c":"B1302","n":"高雄到宅訓練課","eid":"E5","lv":2},
      {"c":"B1303","n":"臺北到宅訓練課","eid":"E5","lv":2},
      {"c":"B1304","n":"台北集中訓練課","eid":"E5","lv":2},
      {"c":"C1000","n":"樂齡歲悅股份有限公司","eid":"E2","lv":0},
      {"c":"C1100","n":"萬華日照中心","eid":"E2","lv":1},
      {"c":"D1000","n":"移站式股份有限公司","eid":"E3","lv":1,"shared":true},
      {"c":"E1000","n":"大齡好好投資有限公司","eid":"E4","lv":1,"shared":true}
    ]'::jsonb
  )
),
forced_departments(value) as (
  values (
    '[
      {"c":"D1000","n":"移站式股份有限公司","eid":"E3","lv":1,"shared":true},
      {"c":"E1000","n":"大齡好好投資有限公司","eid":"E4","lv":1,"shared":true}
    ]'::jsonb
  )
),
current_departments(value) as (
  select coalesce((select value from public.system_settings where key = 'departments'), '[]'::jsonb)
),
items as (
  select 1 as priority, elem
  from base_departments, jsonb_array_elements(base_departments.value) elem
  union all
  select 2 as priority, elem
  from current_departments, jsonb_array_elements(current_departments.value) elem
  union all
  select 3 as priority, elem
  from forced_departments, jsonb_array_elements(forced_departments.value) elem
),
deduped as (
  select distinct on (elem ->> 'c') elem
  from items
  where elem ? 'c'
  order by elem ->> 'c', priority desc
),
merged as (
  select jsonb_agg(elem order by elem ->> 'c') as value
  from deduped
)
insert into public.system_settings (key, value, updated_by, updated_at)
select 'departments', value, 'system-seed', now()
from merged
on conflict (key) do update
set value = excluded.value,
    updated_by = excluded.updated_by,
    updated_at = now();
