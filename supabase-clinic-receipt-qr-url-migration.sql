-- Adds a configurable URL for the QR code printed on thermal receipts.
-- Paste a Google Review link here through Backend after running this migration.

alter table public.clinics
  add column if not exists receipt_qr_url text;