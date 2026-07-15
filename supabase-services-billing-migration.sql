-- Migration: Add billing unit configuration to services table
-- Run this once in the Supabase SQL editor on your live database.

alter table public.services
  add column if not exists requires_quantity boolean not null default false,
  add column if not exists billing_unit text not null default 'Session';
