-- Purchase requests must keep estimated and actual amounts distinct.
-- Estimated amount drives procurement/payment planning. Actual amount drives final vouchers and statements.

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'expense_requests_purchase_estimated_required'
      and conrelid = 'public.expense_requests'::regclass
  ) then
    alter table public.expense_requests
      add constraint expense_requests_purchase_estimated_required
      check (type <> 'purchase_request' or estimated_amount is not null)
      not valid;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'expense_requests_purchase_actual_required_when_completed'
      and conrelid = 'public.expense_requests'::regclass
  ) then
    alter table public.expense_requests
      add constraint expense_requests_purchase_actual_required_when_completed
      check (type <> 'purchase_request' or status <> 'completed' or coalesce(actual_amount, 0) > 0)
      not valid;
  end if;
end $$;

create or replace function public.enforce_purchase_estimate_actual()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.type = 'purchase_request' then
    if new.estimated_amount is null then
      new.estimated_amount := nullif(new.amount, 0);
    end if;

    if new.status = 'completed' then
      if coalesce(new.actual_amount, 0) <= 0 then
        raise exception 'Purchase request % cannot be completed without actual_amount', new.id;
      end if;
      new.amount := new.actual_amount;
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_enforce_purchase_estimate_actual on public.expense_requests;
create trigger trg_enforce_purchase_estimate_actual
before insert or update on public.expense_requests
for each row
execute function public.enforce_purchase_estimate_actual();
