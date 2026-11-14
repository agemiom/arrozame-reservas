-- =====================================================================
-- Arrózame · Equipo, orden de compra y gastos por evento (etapa 1)
--   · personal: las personas que van a las paellas (nombre + WhatsApp)
--   · reservas: equipo asignado, estado de la compra y cuándo se envió la orden
--   · gastos: gastos reales por evento, por categoría, con foto del ticket
--   · storage: bucket PRIVADO "tickets" (solo admin; base para leerlos con IA)
-- No modifica datos existentes.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Equipo
-- ---------------------------------------------------------------------
create table if not exists personal (
  id         uuid primary key default gen_random_uuid(),
  nombre     text not null,
  telefono   text,
  activo     boolean not null default true,
  created_at timestamptz not null default now()
);
alter table personal enable row level security;
drop policy if exists personal_admin on personal;
create policy personal_admin on personal for all using ((select es_admin())) with check ((select es_admin()));

-- ---------------------------------------------------------------------
-- Reservas: equipo y compra
-- ---------------------------------------------------------------------
alter table reservas
  add column if not exists equipo                  uuid[] not null default '{}',
  add column if not exists compra_estado           text   not null default 'pendiente'
    check (compra_estado in ('pendiente','pedida','comprada')),
  add column if not exists orden_compra_enviada_at timestamptz;

-- ---------------------------------------------------------------------
-- Gastos por evento
-- ---------------------------------------------------------------------
create table if not exists gastos (
  id          uuid primary key default gen_random_uuid(),
  reserva_id  uuid not null references reservas(id) on delete cascade,
  categoria   text not null default 'ingredientes'
              check (categoria in ('ingredientes','gas','transporte','personal','otros')),
  monto       numeric(10,2) not null check (monto >= 0),
  fecha       date not null default current_date,
  descripcion text,
  ticket_path text,            -- ruta en el bucket privado "tickets"
  created_at  timestamptz not null default now()
);
create index if not exists gastos_reserva_idx on gastos (reserva_id);
alter table gastos enable row level security;
drop policy if exists gastos_admin on gastos;
create policy gastos_admin on gastos for all using ((select es_admin())) with check ((select es_admin()));

-- ---------------------------------------------------------------------
-- Storage: tickets de compra (privado: solo el admin sube y ve)
-- ---------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('tickets', 'tickets', false, 5242880, array['image/png','image/jpeg','image/webp','image/heic','application/pdf'])
on conflict (id) do nothing;

drop policy if exists "tickets: admin ve" on storage.objects;
create policy "tickets: admin ve" on storage.objects
  for select to authenticated using (bucket_id = 'tickets' and public.es_admin());
drop policy if exists "tickets: admin sube" on storage.objects;
create policy "tickets: admin sube" on storage.objects
  for insert to authenticated with check (bucket_id = 'tickets' and public.es_admin());
drop policy if exists "tickets: admin borra" on storage.objects;
create policy "tickets: admin borra" on storage.objects
  for delete to authenticated using (bucket_id = 'tickets' and public.es_admin());
