-- LOCAL TEST ONLY. Shared across workers; no password, PIN or session token stored here.
create table public.pos_login_attempt_limits(key text primary key check(key ~ '^[0-9a-f]{64}$'),attempts integer not null,until_at timestamptz not null);
alter table public.pos_login_attempt_limits enable row level security;
revoke all on public.pos_login_attempt_limits from public,anon,authenticated;
grant select,insert,update,delete on public.pos_login_attempt_limits to service_role;
create function public.consume_pos_login_attempt(p_key text,p_limit integer,p_window_seconds integer) returns jsonb language plpgsql security invoker set search_path='' as $$
declare v_row public.pos_login_attempt_limits%rowtype;
begin
 if p_limit<1 or p_limit>100 or p_window_seconds<1 or p_window_seconds>3600 then raise exception 'Invalid limit';end if;
 insert into public.pos_login_attempt_limits values(p_key,1,now()+make_interval(secs=>p_window_seconds))
 on conflict(key) do update set attempts=case when pos_login_attempt_limits.until_at<=now() then 1 else least(pos_login_attempt_limits.attempts+1,p_limit+1) end,until_at=case when pos_login_attempt_limits.until_at<=now() then now()+make_interval(secs=>p_window_seconds) else pos_login_attempt_limits.until_at end returning * into v_row;
 return jsonb_build_object('allowed',v_row.attempts<=p_limit,'remaining',greatest(1,ceil(extract(epoch from v_row.until_at-now()))));
end;
$$;
revoke all on function public.consume_pos_login_attempt(text,integer,integer) from public,anon,authenticated;
grant execute on function public.consume_pos_login_attempt(text,integer,integer) to service_role;