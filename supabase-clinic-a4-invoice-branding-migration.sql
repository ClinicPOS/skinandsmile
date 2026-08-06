-- Adds A4-invoice-only branding fields and a dedicated storage bucket for A4 logo uploads.
-- Run this in the Supabase SQL editor before using the dedicated A4 invoice design page.

alter table public.clinics
  add column if not exists a4_invoice_logo_url text,
  add column if not exists a4_invoice_logo_width_mm double precision,
  add column if not exists a4_invoice_logo_height_mm double precision,
  add column if not exists a4_invoice_logo_alignment text,
  add column if not exists a4_invoice_logo_offset_x_mm double precision,
  add column if not exists a4_invoice_logo_offset_y_mm double precision,
  add column if not exists a4_invoice_primary_color text,
  add column if not exists a4_invoice_secondary_color text,
  add column if not exists a4_invoice_accent_color text,
  add column if not exists a4_invoice_text_color text,
  add column if not exists a4_invoice_divider_color text,
  add column if not exists a4_invoice_slogan text;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'clinics_a4_invoice_logo_alignment_check'
  ) then
    alter table public.clinics
      add constraint clinics_a4_invoice_logo_alignment_check
      check (
        a4_invoice_logo_alignment is null
        or a4_invoice_logo_alignment in ('left', 'center', 'right')
      );
  end if;
end $$;

insert into storage.buckets (id, name, public)
values ('clinic-branding', 'clinic-branding', true)
on conflict (id) do nothing;

do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and policyname = 'clinic_branding_public_read'
  ) then
    create policy clinic_branding_public_read
      on storage.objects
      for select
      to public
      using (bucket_id = 'clinic-branding');
  end if;

  if not exists (
    select 1
    from pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and policyname = 'clinic_branding_public_insert'
  ) then
    create policy clinic_branding_public_insert
      on storage.objects
      for insert
      to public
      with check (bucket_id = 'clinic-branding');
  end if;
end $$;
