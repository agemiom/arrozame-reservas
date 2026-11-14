-- =====================================================================
-- Arrózame · Sistema de reservas
-- Migración inicial: tablas, seguridad (RLS), funciones y vistas
-- =====================================================================

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------
-- Configuración general (una sola fila)
-- ---------------------------------------------------------------------
create table if not exists configuracion (
  id                         int primary key default 1 check (id = 1),
  nombre_negocio             text    not null default 'Arrózame · Paella Experience',
  whatsapp                   text    not null default '59171293297',
  email                      text    not null default 'arrozamescz@gmail.com',
  instagram                  text    not null default 'arrozamescz',
  pedido_minimo              int     not null default 6,
  showcooking_incluido_desde int     not null default 20,
  costo_showcooking          numeric(10,2) not null default 500,
  eventos_max_por_dia        int     not null default 2,
  raciones_max_por_dia       int     not null default 120,
  anticipacion_min_horas     int     not null default 48,
  duracion_evento_min        int     not null default 180,
  horarios                   text[]  not null default array['11:00','12:00','13:00','18:00','19:00','20:00','21:00'],
  dias_bloqueados            date[]  not null default '{}',
  -- Token secreto para el calendario del iPhone (no se expone al público)
  calendario_token           text    not null default encode(extensions.gen_random_bytes(18), 'hex'),
  updated_at                 timestamptz not null default now()
);
insert into configuracion (id) values (1) on conflict do nothing;

-- ---------------------------------------------------------------------
-- Carta
-- ---------------------------------------------------------------------
create table if not exists productos (
  id          uuid primary key default gen_random_uuid(),
  nombre      text not null,
  descripcion text,
  ingredientes text,
  categoria   text not null default 'tradicional' check (categoria in ('tradicional','autor','extra')),
  precio_bs   numeric(10,2) not null check (precio_bs >= 0),
  activo      boolean not null default true,
  orden       int not null default 0,
  created_at  timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- Clientes
-- ---------------------------------------------------------------------
create table if not exists clientes (
  id         uuid primary key default gen_random_uuid(),
  nombre     text not null,
  telefono   text not null unique,
  email      text,
  notas      text,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- Reservas
-- ---------------------------------------------------------------------
create table if not exists reservas (
  id                uuid primary key default gen_random_uuid(),
  codigo            text not null unique default upper(substr(encode(extensions.gen_random_bytes(4),'hex'),1,6)),
  cliente_id        uuid not null references clientes(id) on delete restrict,
  fecha             date not null,
  hora              time not null,
  duracion_min      int  not null default 180,
  tipo_evento       text,
  direccion         text,
  zona              text,
  invitados         int,
  raciones_total    int  not null default 0,
  showcooking       boolean not null default false,
  costo_showcooking numeric(10,2) not null default 0,
  subtotal          numeric(10,2) not null default 0,
  descuento         numeric(10,2) not null default 0,
  total             numeric(10,2) not null default 0,
  anticipo          numeric(10,2) not null default 0,
  estado            text not null default 'pendiente'
                    check (estado in ('pendiente','confirmada','pagada','realizada','cancelada')),
  origen            text not null default 'web' check (origen in ('web','whatsapp','instagram','manual','otro')),
  notas_cliente     text,
  notas_internas    text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create index if not exists reservas_fecha_idx  on reservas (fecha);
create index if not exists reservas_estado_idx on reservas (estado);
create index if not exists reservas_cliente_idx on reservas (cliente_id);

create table if not exists reserva_items (
  id          uuid primary key default gen_random_uuid(),
  reserva_id  uuid not null references reservas(id) on delete cascade,
  producto_id uuid references productos(id) on delete set null,
  nombre      text not null,          -- copia del nombre al momento de reservar
  raciones    int  not null check (raciones > 0),
  precio_unit numeric(10,2) not null,
  subtotal    numeric(10,2) generated always as (raciones * precio_unit) stored
);
create index if not exists reserva_items_reserva_idx on reserva_items (reserva_id);
create index if not exists reserva_items_producto_idx on reserva_items (producto_id);

-- ---------------------------------------------------------------------
-- Administradores (usuarios de Supabase Auth que pueden ver el panel)
-- ---------------------------------------------------------------------
create table if not exists administradores (
  user_id uuid primary key references auth.users(id) on delete cascade,
  nombre  text,
  created_at timestamptz not null default now()
);

create or replace function es_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from administradores where user_id = auth.uid());
$$;

-- updated_at automático
create or replace function tocar_updated_at() returns trigger language plpgsql set search_path = public as $$
begin new.updated_at = now(); return new; end $$;
drop trigger if exists reservas_updated on reservas;
create trigger reservas_updated before update on reservas
  for each row execute function tocar_updated_at();

-- ---------------------------------------------------------------------
-- Seguridad (RLS)
--   Público: solo lee la carta activa y la configuración pública.
--   Admin:   todo.
--   Las reservas públicas entran solo por la función crear_reserva().
-- ---------------------------------------------------------------------
alter table configuracion   enable row level security;
alter table productos       enable row level security;
alter table clientes        enable row level security;
alter table reservas        enable row level security;
alter table reserva_items   enable row level security;
alter table administradores enable row level security;

create policy productos_publico on productos for select using (activo or (select es_admin()));
create policy productos_admin_ins on productos for insert with check ((select es_admin()));
create policy productos_admin_upd on productos for update using ((select es_admin())) with check ((select es_admin()));
create policy productos_admin_del on productos for delete using ((select es_admin()));

create policy config_admin on configuracion for all using ((select es_admin())) with check ((select es_admin()));

create policy clientes_admin on clientes for all using ((select es_admin())) with check ((select es_admin()));

create policy reservas_admin on reservas for all using ((select es_admin())) with check ((select es_admin()));

create policy items_admin on reserva_items for all using ((select es_admin())) with check ((select es_admin()));

create policy admins_self on administradores for select using (user_id = (select auth.uid()));

-- Configuración visible al público (sin el token del calendario)
create or replace function config_publica() returns json
language sql stable security definer set search_path = public as $$
  select json_build_object(
    'nombre_negocio', nombre_negocio, 'whatsapp', whatsapp, 'email', email, 'instagram', instagram,
    'pedido_minimo', pedido_minimo, 'showcooking_incluido_desde', showcooking_incluido_desde,
    'costo_showcooking', costo_showcooking, 'anticipacion_min_horas', anticipacion_min_horas,
    'horarios', horarios, 'eventos_max_por_dia', eventos_max_por_dia,
    'raciones_max_por_dia', raciones_max_por_dia)
  from configuracion where id = 1;
$$;

-- ---------------------------------------------------------------------
-- Disponibilidad: días llenos o bloqueados en un rango (sin datos personales)
-- ---------------------------------------------------------------------
create or replace function disponibilidad(desde date, hasta date)
returns table (fecha date, eventos int, raciones int, lleno boolean, bloqueado boolean)
language sql stable security definer set search_path = public as $$
  with c as (select * from configuracion where id = 1),
  dias as (select generate_series(desde, least(hasta, desde + 400), interval '1 day')::date as fecha),
  ocup as (
    select r.fecha, count(*)::int as eventos, coalesce(sum(r.raciones_total),0)::int as raciones
    from reservas r where r.estado <> 'cancelada' and r.fecha between desde and hasta
    group by r.fecha)
  select d.fecha, coalesce(o.eventos,0), coalesce(o.raciones,0),
         coalesce(o.eventos,0) >= c.eventos_max_por_dia or coalesce(o.raciones,0) >= c.raciones_max_por_dia,
         d.fecha = any(c.dias_bloqueados)
  from dias d cross join c left join ocup o on o.fecha = d.fecha
  order by d.fecha;
$$;

-- Horas ya tomadas en un día (para no ofrecer el mismo horario dos veces)
create or replace function horas_ocupadas(dia date) returns text[]
language sql stable security definer set search_path = public as $$
  select coalesce(array_agg(to_char(hora,'HH24:MI')), '{}')
  from reservas where fecha = dia and estado <> 'cancelada';
$$;

-- ---------------------------------------------------------------------
-- crear_reserva: la única puerta de entrada pública.
-- items = [{"producto_id": "...", "raciones": 10}, ...]
-- Valida mínimo, capacidad, anticipación y recalcula precios en el servidor.
-- ---------------------------------------------------------------------
create or replace function crear_reserva(
  p_nombre text, p_telefono text, p_email text,
  p_fecha date, p_hora text,
  p_tipo_evento text, p_direccion text, p_zona text, p_invitados int,
  p_showcooking boolean, p_notas text, p_items jsonb,
  p_origen text default 'web'
) returns json
language plpgsql security definer set search_path = public as $$
declare
  c configuracion%rowtype;
  v_cliente uuid;
  v_reserva reservas%rowtype;
  v_raciones int := 0;
  v_subtotal numeric := 0;
  v_show_cost numeric := 0;
  v_eventos int; v_rac_dia int;
  it jsonb; p productos%rowtype; n int;
  v_tel text := regexp_replace(coalesce(p_telefono,''), '[^0-9+]', '', 'g');
begin
  select * into c from configuracion where id = 1;

  -- solo el panel (admin) puede cargar reservas que no vengan de la web
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
    raise exception 'Elegí al menos una paella';
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

  -- totales calculados con los precios reales de la carta
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

  -- capacidad del día (bloqueo para evitar dobles reservas simultáneas)
  perform pg_advisory_xact_lock(hashtext(p_fecha::text));
  select count(*), coalesce(sum(raciones_total),0) into v_eventos, v_rac_dia
    from reservas where fecha = p_fecha and estado <> 'cancelada';
  if v_eventos >= c.eventos_max_por_dia or v_rac_dia + v_raciones > c.raciones_max_por_dia then
    raise exception 'Ese día ya está completo. Probá otra fecha o escribinos por WhatsApp';
  end if;
  if exists (select 1 from reservas where fecha = p_fecha and hora = p_hora::time and estado <> 'cancelada') then
    raise exception 'Ese horario ya está tomado';
  end if;

  if v_raciones >= c.showcooking_incluido_desde then
    p_showcooking := true; v_show_cost := 0;
  elsif coalesce(p_showcooking,false) then
    v_show_cost := c.costo_showcooking;
  end if;

  -- cliente (se reconoce por teléfono)
  insert into clientes (nombre, telefono, email) values (trim(p_nombre), v_tel, nullif(trim(p_email),''))
  on conflict (telefono) do update set nombre = excluded.nombre,
     email = coalesce(excluded.email, clientes.email)
  returning id into v_cliente;

  insert into reservas (cliente_id, fecha, hora, duracion_min, tipo_evento, direccion, zona, invitados,
                        raciones_total, showcooking, costo_showcooking, subtotal, total, notas_cliente, origen)
  values (v_cliente, p_fecha, p_hora::time, c.duracion_evento_min, p_tipo_evento, p_direccion, p_zona, p_invitados,
          v_raciones, coalesce(p_showcooking,false), v_show_cost, v_subtotal, v_subtotal + v_show_cost,
          p_notas, p_origen)
  returning * into v_reserva;

  insert into reserva_items (reserva_id, producto_id, nombre, raciones, precio_unit)
  select v_reserva.id, pr.id, pr.nombre, (x->>'raciones')::int, pr.precio_bs
  from jsonb_array_elements(p_items) x join productos pr on pr.id = (x->>'producto_id')::uuid
  where (x->>'raciones')::int > 0;

  return json_build_object('codigo', v_reserva.codigo, 'total', v_reserva.total,
                           'raciones', v_raciones, 'showcooking', v_reserva.showcooking,
                           'costo_showcooking', v_show_cost, 'fecha', v_reserva.fecha,
                           'hora', to_char(v_reserva.hora,'HH24:MI'));
end $$;

revoke all on function crear_reserva(text,text,text,date,text,text,text,text,int,boolean,text,jsonb,text) from public;
revoke all on function tocar_updated_at() from public, anon, authenticated;
grant execute on function crear_reserva(text,text,text,date,text,text,text,text,int,boolean,text,jsonb,text) to anon, authenticated;
grant execute on function disponibilidad(date,date) to anon, authenticated;
grant execute on function horas_ocupadas(date) to anon, authenticated;
grant execute on function config_publica() to anon, authenticated;
grant execute on function es_admin() to anon, authenticated;

-- ---------------------------------------------------------------------
-- Vistas de análisis (respetan RLS: solo admin)
-- ---------------------------------------------------------------------
create or replace view v_ventas_producto with (security_invoker = true) as
select i.nombre,
       count(distinct i.reserva_id)::int as reservas,
       sum(i.raciones)::int as raciones,
       sum(i.subtotal)::numeric(12,2) as ingresos
from reserva_items i join reservas r on r.id = i.reserva_id
where r.estado <> 'cancelada'
group by i.nombre order by raciones desc;

create or replace view v_ventas_mes with (security_invoker = true) as
select date_trunc('month', fecha)::date as mes,
       count(*)::int as reservas, sum(raciones_total)::int as raciones,
       sum(total)::numeric(12,2) as ingresos,
       round(avg(total),2) as ticket_promedio
from reservas where estado <> 'cancelada'
group by 1 order by 1;

-- ---------------------------------------------------------------------
-- Carta inicial (Carta de Paellas · Junio 2026)
-- ---------------------------------------------------------------------
insert into productos (nombre, ingredientes, descripcion, categoria, precio_bs, orden)
select * from (values
  ('Paella Valenciana','Pollo, pato, verduras y romero','El sabor auténtico con ingredientes locales.','tradicional',105,1),
  ('Paella de Marisco','Gambas, calamar, mejillones y paiche','La clásica de frutos marinos, todo pelado listo para disfrutar.','tradicional',140,2),
  ('Fideuá de Marisco','Gambas, calamar, mejillones y paiche','Variante de la Paella de Marisco a base de fideo.','tradicional',140,3),
  ('Arroz Negro','Gambas, calamar, mejillones, paiche y tinta de calamar','Paella de marisco con el sabor que aporta la tinta.','tradicional',145,4),
  ('Arroz al Horno','Costilla de cerdo, chorizo, morcilla, garbanzo, papa y tomate','Típico de la localidad de Xàtiva.','tradicional',105,5),
  ('Arroz Meloso de Marisco','Gambas, calamar, mejillones y paiche','Todos los sabores de la Paella de Marisco en un arroz cremoso.','tradicional',140,6),
  ('Paella de Chancho a la Cruz','Costillar de cerdo ahumado a la leña, pimentón rojo y tomates asados','Variante del clásico arroz con costillejas y pimientos.','autor',105,7),
  ('Paella de Campo','Pollo, cerdo, res y chorizo con hortalizas','Una variante de la Valenciana llena de sabor.','autor',105,8),
  ('Paella de Paiche Acevichado','Calamar, paiche, cebolla roja, ají, limón y cilantro','Paella de mar con crema de leche de tigre y medallón de paiche.','autor',105,9),
  ('Paella Mar y Tierra (Mixta)','Langostinos, calamar, mejillones, verduras de temporada, cerdo y pollo','Paella tipo valenciana de mar y tierra.','autor',140,10),
  ('Paella de Costilla de Res Glaseada','Costilla de res, cebollita confitada al tomillo y berenjena escabechada','Sabores pronunciados con un toque ácido.','autor',115,11)
) as v(nombre, ingredientes, descripcion, categoria, precio_bs, orden)
where not exists (select 1 from productos);
