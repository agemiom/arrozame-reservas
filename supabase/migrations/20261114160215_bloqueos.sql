-- =====================================================================
-- Arrózame · Bloqueo de fechas por rango con motivo
--   · bloqueos: desde / hasta / motivo (vacaciones, equipo, privado, otro) / nota
--   · configuracion.dias_bloqueados se recalcula solo desde esta tabla
--     (disponibilidad y crear_reserva siguen igual)
--   · los días que ya estaban bloqueados pasan a la tabla como bloqueos de 1 día
-- No modifica reservas.
-- =====================================================================

create table if not exists bloqueos (
  id         uuid primary key default gen_random_uuid(),
  desde      date not null,
  hasta      date not null,
  motivo     text not null default 'otro' check (motivo in ('vacaciones','equipo','privado','otro')),
  nota       text,
  created_at timestamptz not null default now(),
  check (hasta >= desde),
  check (hasta - desde <= 366)
);
alter table bloqueos enable row level security;
drop policy if exists bloqueos_admin on bloqueos;
create policy bloqueos_admin on bloqueos for all using ((select es_admin())) with check ((select es_admin()));

-- recalcula la lista de días bloqueados que usan la página pública y crear_reserva
create or replace function sincronizar_dias_bloqueados() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  update configuracion set dias_bloqueados = coalesce((
    select array_agg(f order by f) from (
      select distinct d::date as f
      from bloqueos b cross join lateral generate_series(b.desde::timestamp, b.hasta::timestamp, interval '1 day') d
    ) s), '{}')
  where id = 1;
  return null;
end $$;
revoke execute on function sincronizar_dias_bloqueados() from public, anon, authenticated;

drop trigger if exists bloqueos_sync on bloqueos;
create trigger bloqueos_sync after insert or update or delete on bloqueos
  for each statement execute function sincronizar_dias_bloqueados();

-- pasar los días ya bloqueados a la tabla (una sola vez)
insert into bloqueos (desde, hasta, motivo)
select d, d, 'otro' from configuracion, unnest(dias_bloqueados) as d
where id = 1 and not exists (select 1 from bloqueos);
