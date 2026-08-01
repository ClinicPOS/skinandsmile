-- Allow completed POS holds to be removed after checkout.

alter table public.pos_holds enable row level security;

drop policy if exists pos_holds_delete on public.pos_holds;

create policy pos_holds_delete
  on public.pos_holds
  for delete
  using (true);
