-- =====================================================================
-- Arrózame · Cobro del anticipo con QR
--   · Configuración: imagen del QR, porcentaje del anticipo y mensaje
--   · Reservas: cuándo se envió el QR y cuándo se pagó el anticipo
--   · Storage: bucket público "pagos" (lectura pública, escritura solo admin)
-- No modifica datos existentes: solo agrega columnas con valores por defecto.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Configuración
-- ---------------------------------------------------------------------
alter table configuracion
  add column if not exists qr_url              text,
  add column if not exists anticipo_porcentaje int  not null default 50
    check (anticipo_porcentaje between 1 and 100),
  add column if not exists mensaje_anticipo    text not null default
    E'¡Hola {nombre}! Para asegurar tu reserva *{codigo}* del {fecha} te enviamos el QR para el anticipo del {porcentaje}% ({monto}):\n{enlace}\n\nCuando pagues, mandanos el comprobante por acá. ¡Gracias!';

-- ---------------------------------------------------------------------
-- Reservas: registro del anticipo
-- ---------------------------------------------------------------------
alter table reservas
  add column if not exists qr_enviado_at      timestamptz,
  add column if not exists anticipo_pagado_at timestamptz;

-- ---------------------------------------------------------------------
-- Config pública: suma lo que necesita la página del QR (qr.html)
-- (mismo contenido que antes + qr_url y anticipo_porcentaje)
-- ---------------------------------------------------------------------
create or replace function config_publica() returns json
language sql stable security definer set search_path = public as $$
  select json_build_object(
    'nombre_negocio', nombre_negocio, 'whatsapp', whatsapp, 'email', email, 'instagram', instagram,
    'pedido_minimo', pedido_minimo, 'showcooking_incluido_desde', showcooking_incluido_desde,
    'costo_showcooking', costo_showcooking, 'anticipacion_min_horas', anticipacion_min_horas,
    'horarios', horarios, 'eventos_max_por_dia', eventos_max_por_dia,
    'raciones_max_por_dia', raciones_max_por_dia,
    'qr_url', qr_url, 'anticipo_porcentaje', anticipo_porcentaje)
  from configuracion where id = 1;
$$;
grant execute on function config_publica() to anon, authenticated;

-- ---------------------------------------------------------------------
-- Storage: imagen del QR de cobro
-- ---------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('pagos', 'pagos', true, 2097152, array['image/png','image/jpeg','image/webp'])
on conflict (id) do nothing;

-- Lectura: el bucket es público, así que la imagen se ve por su URL pública
-- sin política SELECT (y así nadie puede listar los archivos del bucket).
-- Escritura: solo el admin del panel.
drop policy if exists "pagos: admin sube" on storage.objects;
create policy "pagos: admin sube" on storage.objects
  for insert to authenticated with check (bucket_id = 'pagos' and public.es_admin());

drop policy if exists "pagos: admin actualiza" on storage.objects;
create policy "pagos: admin actualiza" on storage.objects
  for update to authenticated using (bucket_id = 'pagos' and public.es_admin());

drop policy if exists "pagos: admin borra" on storage.objects;
create policy "pagos: admin borra" on storage.objects
  for delete to authenticated using (bucket_id = 'pagos' and public.es_admin());
