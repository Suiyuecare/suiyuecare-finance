-- Keep legacy test/login accounts recognized by Storage RLS.
-- Supabase Auth may authenticate 1@suiyuecare.com ~ 6@suiyuecare.com,
-- so finance_users must keep matching active rows or attachment uploads are blocked.

insert into public.finance_users (id, name, email, demo_password, role, role_label, department_code, init, active, entity_id)
values
  ('u1', '潘雨柔', '1@suiyuecare.com', '5j04284fu06', 'employee', '一般組員', 'B1301', '潘', true, 'E5'),
  ('u2', '江守舜', '2@suiyuecare.com', '5j04284fu06', 'section_chief', '課長', 'B1301', '江', true, 'E5'),
  ('u3_legacy', '陳怡霖', '3@suiyuecare.com', '5j04284fu06', 'dept_manager', '部門主管', 'B1300', '陳', true, 'E5'),
  ('u4', '李佳泰', '4@suiyuecare.com', '5j04284fu06', 'ceo', '執行長', 'A1000', '李', true, 'E1'),
  ('u5_legacy', '劉巧涵', '5@suiyuecare.com', '5j04284fu06', 'admin_director', '行政部門主任', 'A1100', '劉', true, 'E1'),
  ('u6_legacy', '歲悅會計', '6@suiyuecare.com', '5j04284fu06', 'accountant', '會計', 'A1101', '會', true, 'E1')
on conflict (id) do update set
  name = excluded.name,
  email = excluded.email,
  demo_password = excluded.demo_password,
  role = excluded.role,
  role_label = excluded.role_label,
  department_code = excluded.department_code,
  init = excluded.init,
  active = true,
  entity_id = excluded.entity_id;

update public.finance_users
set active = true
where lower(email) in (
  '1@suiyuecare.com',
  '2@suiyuecare.com',
  '3@suiyuecare.com',
  '4@suiyuecare.com',
  '5@suiyuecare.com',
  '6@suiyuecare.com'
);
