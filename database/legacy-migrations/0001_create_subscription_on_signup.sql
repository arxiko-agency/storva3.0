create or replace function public.handle_new_user_subscription()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  insert into public.subscriptions (owner_id, plan_id, billing_interval, status)
  values (new.id, 'free', 'monthly', 'free')
  on conflict (owner_id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created_subscription on auth.users;
create trigger on_auth_user_created_subscription
  after insert on auth.users
  for each row execute function public.handle_new_user_subscription();

insert into public.subscriptions (owner_id, plan_id, billing_interval, status)
select u.id, 'free', 'monthly', 'free' from auth.users u
where not exists (select 1 from public.subscriptions s where s.owner_id = u.id);