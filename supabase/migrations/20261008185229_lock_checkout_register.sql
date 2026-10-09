alter function public.complete_pos_checkout(uuid,jsonb) rename to complete_pos_checkout_before_register_lock;
create function public.complete_pos_checkout(p_request_id uuid,p_payload jsonb) returns jsonb language plpgsql security invoker set search_path='' as $$
declare v_rec uuid:=(p_payload->'receipt'->>'receptionist_id')::uuid;v_reg uuid:=(p_payload->>'registerSessionId')::uuid;v_saved public.pos_checkout_requests%rowtype;
begin
 perform pg_advisory_xact_lock(hashtextextended('register-ledger:'||v_rec::text,0));
 -- Replays remain recoverable after a completed register closes.
 select * into v_saved from public.pos_checkout_requests where id=p_request_id;
 if not found then
  if v_reg is null then raise exception 'Saved register required' using errcode='22023';end if;
  perform 1 from public.cash_register_sessions where id=v_reg and receptionist_id=v_rec and closed_at is null for share;
  if not found then raise exception 'Register is no longer open' using errcode='42501';end if;
 end if;
 return public.complete_pos_checkout_before_register_lock(p_request_id,p_payload);
end;$$;
revoke all on function public.complete_pos_checkout(uuid,jsonb),public.complete_pos_checkout_before_register_lock(uuid,jsonb) from public,anon,authenticated;
grant execute on function public.complete_pos_checkout(uuid,jsonb),public.complete_pos_checkout_before_register_lock(uuid,jsonb) to service_role;
