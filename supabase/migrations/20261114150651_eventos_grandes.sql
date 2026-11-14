-- =====================================================================
-- Arrózame · Eventos grandes por la web
--   Un pedido de más raciones que el máximo diario (raciones_max_por_dia)
--   ya no se rechaza: se acepta como "evento grande" si ese día no tiene
--   otros eventos (ocupa el día completo), queda pendiente y se confirma
--   por WhatsApp. Además, mensajes de error claros en vez de "completo".
--   Textos en castellano neutro (tuteo) en los errores y en el mensaje
--   del anticipo.
-- No modifica reservas existentes.
-- =====================================================================

alter table reservas add column if not exists evento_grande boolean not null default false;

-- Mensaje del anticipo en tuteo: nuevo valor por defecto y, si nadie lo
-- editó todavía (sigue el texto original), se actualiza también el guardado.
alter table configuracion alter column mensaje_anticipo set default
  E'¡Hola {nombre}! Para asegurar tu reserva *{codigo}* del {fecha} te enviamos el QR para el anticipo del {porcentaje}% ({monto}):\n{enlace}\n\nCuando pagues, envíanos el comprobante por aquí. ¡Gracias!';
update configuracion
   set mensaje_anticipo = E'¡Hola {nombre}! Para asegurar tu reserva *{codigo}* del {fecha} te enviamos el QR para el anticipo del {porcentaje}% ({monto}):\n{enlace}\n\nCuando pagues, envíanos el comprobante por aquí. ¡Gracias!'
 where id = 1
   and mensaje_anticipo = E'¡Hola {nombre}! Para asegurar tu reserva *{codigo}* del {fecha} te enviamos el QR para el anticipo del {porcentaje}% ({monto}):\n{enlace}\n\nCuando pagues, mandanos el comprobante por acá. ¡Gracias!';

create or replace function public.crear_reserva(p_nombre text, p_telefono text, p_email text, p_fecha date, p_hora text, p_tipo_evento text, p_direccion text, p_zona text, p_invitados integer, p_showcooking boolean, p_notas text, p_items jsonb, p_origen text default 'web'::text)
 returns json
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  c configuracion%rowtype;
  v_cliente uuid;
  v_reserva reservas%rowtype;
  v_raciones int := 0;
  v_subtotal numeric := 0;
  v_show_cost numeric := 0;
  v_eventos int; v_rac_dia int;
  v_grande boolean := false;
  it jsonb; p productos%rowtype; n int;
  v_tel text := regexp_replace(coalesce(p_telefono,''), '[^0-9+]', '', 'g');
begin
  select * into c from configuracion where id = 1;

  if coalesce(p_origen,'web') <> 'web' and not es_admin() then
    p_origen := 'web';
  end if;
  p_origen := coalesce(p_origen,'web');

  if coalesce(trim(p_nombre),'') = '' or length(v_tel) < 7 then
    raise exception 'Nombre y teléfono son obligatorios';
  end if;
  if length(p_nombre) > 120 or length(coalesce(p_notas,'')) > 2000 or length(coalesce(p_direccion,'')) > 300 then
    raise exception 'Algún dato es demasiado largo';
  end if;
  if p_items is null or jsonb_array_length(p_items) = 0 or jsonb_array_length(p_items) > 20 then
    raise exception 'Elige al menos una paella';
  end if;
  if p_fecha > current_date + 400 then
    raise exception 'Solo se puede reservar hasta un año adelante';
  end if;
  if (p_fecha + p_hora::time) < (now() at time zone 'America/La_Paz') + make_interval(hours => c.anticipacion_min_horas)
     and p_origen = 'web' then
    raise exception 'Las reservas web necesitan al menos % horas de anticipación', c.anticipacion_min_horas;
  end if;
  if p_fecha = any(c.dias_bloqueados) and p_origen = 'web' then
    raise exception 'Ese día no está disponible';
  end if;
  if p_origen = 'web' and not (p_hora = any(c.horarios)) then
    raise exception 'Ese horario no está disponible';
  end if;

  for it in select * from jsonb_array_elements(p_items) loop
    n := (it->>'raciones')::int;
    if n is null or n <= 0 then continue; end if;
    if n > 500 then raise exception 'Cantidad de raciones no válida'; end if;
    select * into p from productos where id = (it->>'producto_id')::uuid and activo;
    if not found then raise exception 'Una de las paellas ya no está disponible'; end if;
    v_raciones := v_raciones + n;
    v_subtotal := v_subtotal + n * p.precio_bs;
  end loop;

  if v_raciones < c.pedido_minimo then
    raise exception 'El pedido mínimo es de % raciones', c.pedido_minimo;
  end if;

  perform pg_advisory_xact_lock(hashtext(p_fecha::text));
  select count(*), coalesce(sum(raciones_total),0) into v_eventos, v_rac_dia
    from reservas where fecha = p_fecha and estado <> 'cancelada';

  if v_eventos >= c.eventos_max_por_dia then
    raise exception 'Ese día ya tiene la agenda llena. Prueba otra fecha o escríbenos por WhatsApp';
  end if;
  if v_raciones > c.raciones_max_por_dia then
    -- evento grande: ocupa el día completo
    if v_eventos > 0 then
      raise exception 'Para un evento grande reservamos el día completo y ese día ya tenemos otro evento. Prueba otra fecha o escríbenos por WhatsApp';
    end if;
    v_grande := true;
  elsif v_rac_dia + v_raciones > c.raciones_max_por_dia then
    raise exception 'Ese día ya no nos alcanza para las raciones de tu pedido. Prueba otra fecha o escríbenos por WhatsApp';
  end if;
  if exists (select 1 from reservas where fecha = p_fecha and hora = p_hora::time and estado <> 'cancelada') then
    raise exception 'Ese horario ya está tomado';
  end if;

  if v_raciones >= c.showcooking_incluido_desde then
    p_showcooking := true; v_show_cost := 0;
  elsif coalesce(p_showcooking,false) then
    v_show_cost := c.costo_showcooking;
  end if;

  insert into clientes (nombre, telefono, email) values (trim(p_nombre), v_tel, nullif(trim(p_email),''))
  on conflict (telefono) do update set nombre = excluded.nombre,
     email = coalesce(excluded.email, clientes.email)
  returning id into v_cliente;

  insert into reservas (cliente_id, fecha, hora, duracion_min, tipo_evento, direccion, zona, invitados,
                        raciones_total, showcooking, costo_showcooking, subtotal, total, notas_cliente, origen, evento_grande)
  values (v_cliente, p_fecha, p_hora::time, c.duracion_evento_min, p_tipo_evento, p_direccion, p_zona, p_invitados,
          v_raciones, coalesce(p_showcooking,false), v_show_cost, v_subtotal, v_subtotal + v_show_cost,
          p_notas, p_origen, v_grande)
  returning * into v_reserva;

  insert into reserva_items (reserva_id, producto_id, nombre, raciones, precio_unit)
  select v_reserva.id, pr.id, pr.nombre, (x->>'raciones')::int, pr.precio_bs
  from jsonb_array_elements(p_items) x join productos pr on pr.id = (x->>'producto_id')::uuid
  where (x->>'raciones')::int > 0;

  return json_build_object('codigo', v_reserva.codigo, 'total', v_reserva.total,
                           'raciones', v_raciones, 'showcooking', v_reserva.showcooking,
                           'costo_showcooking', v_show_cost, 'fecha', v_reserva.fecha,
                           'hora', to_char(v_reserva.hora,'HH24:MI'), 'evento_grande', v_grande);
end $function$;
