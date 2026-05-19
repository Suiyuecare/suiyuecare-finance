-- Finance OS V3 organization settings seed
-- Keeps frontend selectable organization data aligned with Supabase settings.
-- Tax IDs are intentionally left blank until official company tax IDs are provided.

insert into public.system_settings(key, value, updated_at, updated_by)
values
(
  'entities',
  '[
    {"id":"E1","s":"歲悅股份","full":"歲悅股份有限公司","taxId":"","color":"#ea880c"},
    {"id":"E2","s":"樂齡歲悅股份有限公司","full":"樂齡歲悅股份有限公司","taxId":"","color":"#2a9040"},
    {"id":"E3","s":"移站式股份有限公司","full":"移站式股份有限公司","taxId":"","color":"#1a4080"},
    {"id":"E4","s":"大齡好好投資有限公司","full":"大齡好好投資有限公司","taxId":"","color":"#4a2890"},
    {"id":"E5","s":"歲悅股份有限公司附設臺北市私立歲悅居家長照機構","full":"歲悅股份有限公司附設臺北市私立歲悅居家長照機構","taxId":"","color":"#0a5040"},
    {"id":"E6","s":"歲悅萬華長照","full":"樂齡歲悅股份有限公司附設臺北市私立歲悅萬華社區長照機構","taxId":"","color":"#8a1010"}
  ]'::jsonb,
  now(),
  'codex_v3_seed'
),
(
  'departments',
  '[
    {"c":"A1000","n":"歲悅股份有限公司","eid":"E1","lv":0},
    {"c":"A1100","n":"行政部","eid":"E1","lv":1},
    {"c":"A1101","n":"會計課","eid":"E1","lv":2},
    {"c":"A1102","n":"人資課","eid":"E1","lv":2},
    {"c":"A1103","n":"行政總務課","eid":"E1","lv":2},
    {"c":"A1200","n":"教學品管部","eid":"E1","lv":1},
    {"c":"A1201","n":"教學課","eid":"E1","lv":2},
    {"c":"A1202","n":"品管課","eid":"E1","lv":2},
    {"c":"B1000","n":"歲悅居家長照機構","eid":"E5","lv":0},
    {"c":"B1100","n":"長照部","eid":"E5","lv":1},
    {"c":"B1101","n":"居家照顧課","eid":"E5","lv":2},
    {"c":"B1102","n":"士林失智據點課","eid":"E5","lv":2},
    {"c":"B1103","n":"大同失智據點課","eid":"E5","lv":2},
    {"c":"B1104","n":"信義失智據點課","eid":"E5","lv":2},
    {"c":"B1300","n":"移工培訓部","eid":"E5","lv":1},
    {"c":"B1301","n":"數位學習課","eid":"E5","lv":2},
    {"c":"B1302","n":"高雄到宅訓練課","eid":"E5","lv":2},
    {"c":"B1303","n":"台北到宅訓練課","eid":"E5","lv":2},
    {"c":"B1304","n":"台北集中訓練課","eid":"E5","lv":2},
    {"c":"C1000","n":"樂齡歲悅股份有限公司","eid":"E2","lv":0},
    {"c":"C1100","n":"萬華日照中心","eid":"E2","lv":1},
    {"c":"D1000","n":"移站式股份有限公司","eid":"E3","lv":1},
    {"c":"E1000","n":"大齡好好投資有限公司","eid":"E4","lv":1}
  ]'::jsonb,
  now(),
  'codex_v3_seed'
)
on conflict (key) do update
set value = excluded.value,
    updated_at = excluded.updated_at,
    updated_by = excluded.updated_by;
