// =====================================================================
// Arrózame · Capa de datos
// Una sola interfaz para dos modos:
//   · Supabase (producción) cuando config.js tiene URL y clave
//   · Demo (localStorage) cuando no, para probar sin backend
// =====================================================================
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "./config.js";

export const modoDemo = !(SUPABASE_URL && SUPABASE_ANON_KEY);

// ---------- utilidades de fecha (zona Bolivia, sin líos de UTC) ----------
export const hoyISO = () => {
  const d = new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 6e4).toISOString().slice(0, 10);
};
export const sumarDias = (iso, n) => {
  const [y, m, d] = iso.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return t.toISOString().slice(0, 10);
};
export const bs = (n) => "Bs " + Number(n || 0).toLocaleString("es-BO", { maximumFractionDigits: 0 });
export const fechaLarga = (iso) => {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("es-BO", { weekday: "long", day: "numeric", month: "long" });
};

// =====================================================================
// Supabase
// =====================================================================
let sb = null;
async function cliente() {
  if (!sb) {
    const { createClient } = await import("https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm");
    sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  }
  return sb;
}
const ok = ({ data, error }) => {
  if (error) throw new Error(limpiarError(error.message));
  return data;
};
const limpiarError = (m = "") => m.replace(/^.*?ERROR:\s*/, "").replace(/\s*\(SQLSTATE.*$/, "");

const SELECT_RESERVA =
  "*, clientes(id, nombre, telefono, email), reserva_items(id, nombre, raciones, precio_unit, subtotal, producto_id), gastos(*)";

const remoto = {
  async config() { return ok(await (await cliente()).rpc("config_publica")); },
  async productos({ todos = false } = {}) {
    let q = (await cliente()).from("productos").select("*").order("orden");
    if (!todos) q = q.eq("activo", true);
    return ok(await q);
  },
  async disponibilidad(desde, hasta) { return ok(await (await cliente()).rpc("disponibilidad", { desde, hasta })); },
  async horasOcupadas(dia) { return ok(await (await cliente()).rpc("horas_ocupadas", { dia })); },
  async crearReserva(p) {
    return ok(await (await cliente()).rpc("crear_reserva", {
      p_nombre: p.nombre, p_telefono: p.telefono, p_email: p.email || null,
      p_fecha: p.fecha, p_hora: p.hora, p_tipo_evento: p.tipo_evento || null,
      p_direccion: p.direccion || null, p_zona: p.zona || null, p_invitados: p.invitados || null,
      p_showcooking: !!p.showcooking, p_notas: p.notas || null,
      p_items: p.items, p_origen: p.origen || "web",
    }));
  },
  // ---- admin ----
  async login(email, password) {
    const c = await cliente();
    ok(await c.auth.signInWithPassword({ email, password }));
    const esAdmin = ok(await c.rpc("es_admin"));
    if (!esAdmin) { await c.auth.signOut(); throw new Error("Este usuario no tiene acceso al panel."); }
    return this.usuario();
  },
  async logout() { await (await cliente()).auth.signOut(); },
  async usuario() {
    const c = await cliente();
    const { data } = await c.auth.getSession();
    if (!data.session) return null;
    const esAdmin = ok(await c.rpc("es_admin"));
    return esAdmin ? { email: data.session.user.email } : null;
  },
  async reservas({ desde, hasta } = {}) {
    let q = (await cliente()).from("reservas").select(SELECT_RESERVA).order("fecha").order("hora");
    if (desde) q = q.gte("fecha", desde);
    if (hasta) q = q.lte("fecha", hasta);
    return ok(await q);
  },
  async actualizarReserva(id, patch) {
    return ok(await (await cliente()).from("reservas").update(patch).eq("id", id).select(SELECT_RESERVA).single());
  },
  async guardarProducto(p) {
    const c = await cliente();
    const { id, ...resto } = p;
    return ok(id ? await c.from("productos").update(resto).eq("id", id).select().single()
                 : await c.from("productos").insert(resto).select().single());
  },
  async configCompleta() { return ok(await (await cliente()).from("configuracion").select("*").eq("id", 1).single()); },
  async guardarConfig(patch) {
    return ok(await (await cliente()).from("configuracion").update({ ...patch, updated_at: new Date().toISOString() }).eq("id", 1).select().single());
  },
  async urlCalendario() {
    const cfg = await this.configCompleta();
    return `${SUPABASE_URL.replace(/\/$/, "")}/functions/v1/calendario?token=${cfg.calendario_token}`;
  },
  async actualizarCliente(id, patch) {
    return ok(await (await cliente()).from("clientes").update(patch).eq("id", id).select().single());
  },
  // ---- equipo ----
  async personal() { return ok(await (await cliente()).from("personal").select("*").order("created_at")); },
  async guardarPersona(p) {
    const c = await cliente(); const { id, ...resto } = p;
    return ok(id ? await c.from("personal").update(resto).eq("id", id).select().single()
                 : await c.from("personal").insert(resto).select().single());
  },
  // ---- bloqueos de fechas (la base recalcula dias_bloqueados sola) ----
  async bloqueos() { return ok(await (await cliente()).from("bloqueos").select("*").order("desde")); },
  async crearBloqueo(b) { return ok(await (await cliente()).from("bloqueos").insert(b).select().single()); },
  async borrarBloqueo(id) { return ok(await (await cliente()).from("bloqueos").delete().eq("id", id)); },
  // ---- gastos ----
  async agregarGasto(g) { return ok(await (await cliente()).from("gastos").insert(g).select().single()); },
  async borrarGasto(g) {
    const c = await cliente();
    if (g.ticket_path) await c.storage.from("tickets").remove([g.ticket_path]);
    return ok(await c.from("gastos").delete().eq("id", g.id));
  },
  // ticket en bucket PRIVADO: se guarda la ruta y se ve con un enlace firmado temporal
  async subirTicket(archivo, reservaId) {
    const c = await cliente();
    const ext = (archivo.name.split(".").pop() || "jpg").toLowerCase().replace(/[^a-z0-9]/g, "");
    const ruta = `${reservaId}/${Date.now()}.${ext}`;
    ok(await c.storage.from("tickets").upload(ruta, archivo, { contentType: archivo.type, upsert: false }));
    return ruta;
  },
  async urlTicket(ruta) { return ok(await (await cliente()).storage.from("tickets").createSignedUrl(ruta, 600)).signedUrl; },
  // Sube la imagen del QR de cobro al bucket público "pagos" y devuelve su URL pública
  async subirQR(archivo) {
    const c = await cliente();
    const ext = (archivo.type.split("/")[1] || "png").replace("jpeg", "jpg");
    const ruta = `qr-anticipo-${Date.now()}.${ext}`;
    ok(await c.storage.from("pagos").upload(ruta, archivo, { contentType: archivo.type, upsert: false, cacheControl: "3600" }));
    return c.storage.from("pagos").getPublicUrl(ruta).data.publicUrl;
  },
};

// =====================================================================
// Demo (localStorage)
// =====================================================================
const CLAVE = "arrozame_demo_v1";
const CARTA = [
  ["Paella Valenciana", "Pollo, pato, verduras y romero", "El sabor auténtico con ingredientes locales.", "tradicional", 105],
  ["Paella de Marisco", "Gambas, calamar, mejillones y paiche", "La clásica de frutos marinos, todo pelado listo para disfrutar.", "tradicional", 140],
  ["Fideuá de Marisco", "Gambas, calamar, mejillones y paiche", "Variante de la Paella de Marisco a base de fideo.", "tradicional", 140],
  ["Arroz Negro", "Gambas, calamar, mejillones, paiche y tinta de calamar", "Paella de marisco con el sabor que aporta la tinta.", "tradicional", 145],
  ["Arroz al Horno", "Costilla de cerdo, chorizo, morcilla, garbanzo, papa y tomate", "Típico de la localidad de Xàtiva.", "tradicional", 105],
  ["Arroz Meloso de Marisco", "Gambas, calamar, mejillones y paiche", "Todos los sabores de la Paella de Marisco en un arroz cremoso.", "tradicional", 140],
  ["Paella de Chancho a la Cruz", "Costillar de cerdo ahumado a la leña, pimentón rojo y tomates asados", "Variante del clásico arroz con costillejas y pimientos.", "autor", 105],
  ["Paella de Campo", "Pollo, cerdo, res y chorizo con hortalizas", "Una variante de la Valenciana llena de sabor.", "autor", 105],
  ["Paella de Paiche Acevichado", "Calamar, paiche, cebolla roja, ají, limón y cilantro", "Paella de mar con crema de leche de tigre y medallón de paiche.", "autor", 105],
  ["Paella Mar y Tierra (Mixta)", "Langostinos, calamar, mejillones, verduras de temporada, cerdo y pollo", "Paella tipo valenciana de mar y tierra.", "autor", 140],
  ["Paella de Costilla de Res Glaseada", "Costilla de res, cebollita confitada al tomillo y berenjena escabechada", "Sabores pronunciados con un toque ácido.", "autor", 115],
];
const CONFIG_INICIAL = {
  nombre_negocio: "Arrózame · Paella Experience", whatsapp: "59171293297", email: "arrozamescz@gmail.com",
  instagram: "arrozamescz", pedido_minimo: 6, showcooking_incluido_desde: 20, costo_showcooking: 500,
  eventos_max_por_dia: 2, raciones_max_por_dia: 120, anticipacion_min_horas: 48, duracion_evento_min: 180,
  horarios: ["11:00", "12:00", "13:00", "18:00", "19:00", "20:00", "21:00"], dias_bloqueados: [],
  calendario_token: "demo",
  qr_url: null, anticipo_porcentaje: 50,
  mensaje_anticipo: "¡Hola {nombre}! Para asegurar tu reserva *{codigo}* del {fecha} te enviamos el QR para el anticipo del {porcentaje}% ({monto}):\n{enlace}\n\nCuando pagues, envíanos el comprobante por aquí. ¡Gracias!",
};
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : String(Math.random()).slice(2));
const codigo = () => Math.random().toString(16).slice(2, 8).toUpperCase();

function sembrar() {
  // Datos de ejemplo verosímiles para ver el panel con vida
  let semilla = 7;
  const rnd = () => ((semilla = (semilla * 16807) % 2147483647) / 2147483647);
  const elegir = (a) => a[Math.floor(rnd() * a.length)];
  const productos = CARTA.map(([nombre, ingredientes, descripcion, categoria, precio_bs], i) => ({
    id: uid(), nombre, ingredientes, descripcion, categoria, precio_bs, activo: true, orden: i + 1,
  }));
  const peso = [9, 7, 3, 4, 3, 3, 6, 5, 3, 5, 3]; // popularidad relativa de ejemplo
  const elegirProducto = () => {
    let t = rnd() * peso.reduce((a, b) => a + b, 0);
    for (let i = 0; i < peso.length; i++) { t -= peso[i]; if (t <= 0) return productos[i]; }
    return productos[0];
  };
  const nombres = ["Mariana Suárez", "Carlos Rivero", "Daniela Justiniano", "Jorge Antelo", "Valeria Paz", "Rodrigo Saucedo",
    "Lucía Vaca", "Andrés Gutiérrez", "Paola Roca", "Martín Ribera", "Camila Áñez", "Sergio Melgar", "Natalia Peña", "Diego Banzer",
    "Empresa Sofía Ltda.", "Colegio Alemán", "Ana Céspedes", "Hotel Los Tajibos"];
  const clientes = nombres.map((nombre, i) => ({
    id: uid(), nombre, telefono: "5917" + String(1000000 + i * 37771).slice(0, 7), email: "", created_at: new Date().toISOString(),
  }));
  const tipos = ["Cumpleaños", "Almuerzo familiar", "Evento corporativo", "Boda", "Reunión de amigos", "Aniversario", "Graduación"];
  const zonas = ["Equipetrol", "Urubó", "Las Palmas", "Norte", "Centro", "Sirari", "Colinas del Urubó"];
  const reservas = [];
  const hoy = hoyISO();
  for (let k = 0; k < 64; k++) {
    const fecha = sumarDias(hoy, Math.floor(rnd() * 190) - 150);
    const dow = new Date(fecha + "T12:00").getDay();
    if (dow >= 1 && dow <= 3 && rnd() < 0.6) continue; // más fines de semana
    const cli = rnd() < 0.35 ? clientes[Math.floor(rnd() * 5)] : elegir(clientes);
    const nItems = rnd() < 0.55 ? 1 : rnd() < 0.8 ? 2 : 3;
    const items = [];
    for (let j = 0; j < nItems; j++) {
      const p = elegirProducto();
      if (items.some((x) => x.producto_id === p.id)) continue;
      const rac = [6, 8, 10, 12, 15, 20, 25, 30][Math.floor(rnd() * 8)];
      items.push({ id: uid(), producto_id: p.id, nombre: p.nombre, raciones: rac, precio_unit: p.precio_bs, subtotal: rac * p.precio_bs });
    }
    const rac = items.reduce((a, i) => a + i.raciones, 0);
    const subtotal = items.reduce((a, i) => a + i.subtotal, 0);
    const show = rac >= 20 || rnd() < 0.25;
    const costoShow = show && rac < 20 ? 500 : 0;
    const pasado = fecha < hoy;
    const estado = pasado ? (rnd() < 0.08 ? "cancelada" : "realizada") : elegir(["pendiente", "confirmada", "confirmada", "pagada"]);
    const total = subtotal + costoShow;
    reservas.push({
      id: uid(), codigo: codigo(), cliente_id: cli.id, fecha, hora: elegir(["12:00", "13:00", "19:00", "20:00"]) + ":00",
      duracion_min: 180, tipo_evento: elegir(tipos), direccion: "Calle " + (k + 3) + " #" + (100 + k), zona: elegir(zonas),
      invitados: rac, raciones_total: rac, showcooking: show, costo_showcooking: costoShow, subtotal, descuento: 0, total,
      anticipo: estado === "pagada" || estado === "realizada" ? total : estado === "confirmada" ? Math.round(total / 2) : 0,
      estado, origen: elegir(["web", "web", "whatsapp", "instagram", "manual"]), notas_cliente: "", notas_internas: "",
      created_at: new Date(new Date(fecha).getTime() - 12 * 864e5).toISOString(), updated_at: new Date().toISOString(), items,
    });
  }
  const personal = ["Kike Martí", "Luis Rojas", "Ana Vargas", "Pedro Suárez"].map((nombre, i) => ({
    id: uid(), nombre, telefono: "5917" + String(2200000 + i * 51113).slice(0, 7), activo: true, created_at: new Date().toISOString(),
  }));
  // gastos de ejemplo en eventos ya realizados (ingredientes ~32%, gas, transporte y personal)
  for (const r of reservas) {
    r.gastos = [];
    r.equipo = []; r.compra_estado = r.estado === "pendiente" ? "pendiente" : "comprada"; r.orden_compra_enviada_at = null;
    if (r.estado === "realizada" && rnd() < 0.85) {
      const t = Number(r.total);
      const g = (categoria, k) => r.gastos.push({ id: uid(), reserva_id: r.id, categoria, monto: Math.round(t * k), fecha: r.fecha, descripcion: "", ticket_path: null, created_at: r.created_at });
      g("ingredientes", 0.26 + rnd() * 0.12); g("gas", 0.02 + rnd() * 0.02); g("transporte", 0.02 + rnd() * 0.03); g("personal", 0.08 + rnd() * 0.06);
      r.equipo = personal.slice(0, 2 + Math.floor(rnd() * 3)).map((p) => p.id);
    }
  }
  return { config: { ...CONFIG_INICIAL }, productos, clientes, reservas, personal, sesion: null };
}

function cargar() {
  try {
    const s = localStorage.getItem(CLAVE);
    if (s) return JSON.parse(s);
  } catch {}
  const d = sembrar();
  guardar(d);
  return d;
}
let memoria = null;
function guardar(d) { memoria = d; try { localStorage.setItem(CLAVE, JSON.stringify(d)); } catch {} }
const db = () => (memoria ??= cargar());
const pausa = () => new Promise((r) => setTimeout(r, 120));
const conCliente = (r) => {
  const c = db().clientes.find((x) => x.id === r.cliente_id) || {};
  return { equipo: [], compra_estado: "pendiente", ...r, gastos: [...(r.gastos || [])], clientes: c, reserva_items: r.items };
};

// en demo, igual que el trigger de la base: los rangos se pasan a la lista de días bloqueados
function sincronizarBloqueosDemo(d) {
  const dias = new Set();
  for (const b of d.bloqueos || []) for (let f = b.desde; f <= b.hasta; f = sumarDias(f, 1)) dias.add(f);
  d.config.dias_bloqueados = [...dias].sort();
}

const demo = {
  async config() { await pausa(); const { calendario_token, ...pub } = { ...CONFIG_INICIAL, ...db().config }; return pub; },
  async productos({ todos = false } = {}) { await pausa(); return db().productos.filter((p) => todos || p.activo).sort((a, b) => a.orden - b.orden); },
  async disponibilidad(desde, hasta) {
    const d = db(); const c = d.config; const out = [];
    for (let f = desde; f <= hasta; f = sumarDias(f, 1)) {
      const rs = d.reservas.filter((r) => r.fecha === f && r.estado !== "cancelada");
      const rac = rs.reduce((a, r) => a + r.raciones_total, 0);
      out.push({ fecha: f, eventos: rs.length, raciones: rac, lleno: rs.length >= c.eventos_max_por_dia || rac >= c.raciones_max_por_dia, bloqueado: c.dias_bloqueados.includes(f) });
    }
    return out;
  },
  async horasOcupadas(dia) { return db().reservas.filter((r) => r.fecha === dia && r.estado !== "cancelada").map((r) => r.hora.slice(0, 5)); },
  async crearReserva(p) {
    await pausa();
    const d = db(); const c = d.config;
    const tel = String(p.telefono || "").replace(/[^0-9+]/g, "");
    if (!String(p.nombre || "").trim() || tel.length < 7) throw new Error("Nombre y teléfono son obligatorios");
    const items = [];
    for (const it of p.items || []) {
      if (!(it.raciones > 0)) continue;
      const pr = d.productos.find((x) => x.id === it.producto_id && x.activo);
      if (!pr) throw new Error("Una de las paellas ya no está disponible");
      items.push({ id: uid(), producto_id: pr.id, nombre: pr.nombre, raciones: it.raciones, precio_unit: pr.precio_bs, subtotal: it.raciones * pr.precio_bs });
    }
    if (!items.length) throw new Error("Elige al menos una paella");
    const rac = items.reduce((a, i) => a + i.raciones, 0);
    if (rac < c.pedido_minimo) throw new Error(`El pedido mínimo es de ${c.pedido_minimo} raciones`);
    const cuando = new Date(`${p.fecha}T${p.hora}`);
    if ((p.origen || "web") === "web" && cuando - Date.now() < c.anticipacion_min_horas * 36e5)
      throw new Error(`Las reservas web necesitan al menos ${c.anticipacion_min_horas} horas de anticipación`);
    const [disp] = await this.disponibilidad(p.fecha, p.fecha);
    if (disp.bloqueado) throw new Error("Ese día no está disponible");
    let grande = false;
    if (disp.eventos >= c.eventos_max_por_dia) throw new Error("Ese día ya tiene la agenda llena. Prueba otra fecha o escríbenos por WhatsApp");
    if (rac > c.raciones_max_por_dia) {
      if (disp.eventos > 0) throw new Error("Para un evento grande reservamos el día completo y ese día ya tenemos otro evento. Prueba otra fecha o escríbenos por WhatsApp");
      grande = true;
    } else if (disp.raciones + rac > c.raciones_max_por_dia) throw new Error("Ese día ya no nos alcanza para las raciones de tu pedido. Prueba otra fecha o escríbenos por WhatsApp");
    if ((await this.horasOcupadas(p.fecha)).includes(p.hora)) throw new Error("Ese horario ya está tomado");
    let show = !!p.showcooking, costoShow = 0;
    if (rac >= c.showcooking_incluido_desde) show = true; else if (show) costoShow = c.costo_showcooking;
    let cli = d.clientes.find((x) => x.telefono === tel);
    if (cli) { cli.nombre = p.nombre.trim(); if (p.email) cli.email = p.email; }
    else { cli = { id: uid(), nombre: p.nombre.trim(), telefono: tel, email: p.email || "", created_at: new Date().toISOString() }; d.clientes.push(cli); }
    const subtotal = items.reduce((a, i) => a + i.subtotal, 0);
    const r = {
      id: uid(), codigo: codigo(), cliente_id: cli.id, fecha: p.fecha, hora: p.hora + ":00", duracion_min: c.duracion_evento_min,
      tipo_evento: p.tipo_evento || "", direccion: p.direccion || "", zona: p.zona || "", invitados: p.invitados || null,
      raciones_total: rac, showcooking: show, costo_showcooking: costoShow, subtotal, descuento: 0, total: subtotal + costoShow,
      anticipo: 0, estado: "pendiente", origen: p.origen || "web", notas_cliente: p.notas || "", notas_internas: "", evento_grande: grande,
      created_at: new Date().toISOString(), updated_at: new Date().toISOString(), items,
    };
    d.reservas.push(r); guardar(d);
    return { codigo: r.codigo, total: r.total, raciones: rac, showcooking: show, costo_showcooking: costoShow, fecha: r.fecha, hora: p.hora, evento_grande: grande };
  },
  async login(email) { const d = db(); d.sesion = { email: email || "fer@arrozame.bo" }; guardar(d); return d.sesion; },
  async logout() { const d = db(); d.sesion = null; guardar(d); },
  async usuario() { return db().sesion; },
  async reservas({ desde, hasta } = {}) {
    await pausa();
    return db().reservas.filter((r) => (!desde || r.fecha >= desde) && (!hasta || r.fecha <= hasta))
      .sort((a, b) => (a.fecha + a.hora).localeCompare(b.fecha + b.hora)).map(conCliente);
  },
  async actualizarReserva(id, patch) {
    const d = db(); const r = d.reservas.find((x) => x.id === id);
    Object.assign(r, patch, { updated_at: new Date().toISOString() }); guardar(d); return conCliente(r);
  },
  async guardarProducto(p) {
    const d = db();
    if (p.id) Object.assign(d.productos.find((x) => x.id === p.id), p);
    else d.productos.push({ ...p, id: uid() });
    guardar(d); return p;
  },
  async configCompleta() { return { ...CONFIG_INICIAL, ...db().config }; },
  async guardarConfig(patch) { const d = db(); Object.assign(d.config, patch); guardar(d); return d.config; },
  async urlCalendario() { return "https://TU-PROYECTO.supabase.co/functions/v1/calendario?token=…"; },
  async bloqueos() {
    const d = db();
    if (!d.bloqueos) { d.bloqueos = (d.config.dias_bloqueados || []).map((f) => ({ id: uid(), desde: f, hasta: f, motivo: "otro", nota: null })); guardar(d); }
    return [...d.bloqueos].sort((a, b) => a.desde.localeCompare(b.desde));
  },
  async crearBloqueo(b) {
    await this.bloqueos(); const d = db();
    const n = { id: uid(), nota: null, ...b, created_at: new Date().toISOString() };
    d.bloqueos.push(n); sincronizarBloqueosDemo(d); guardar(d); return n;
  },
  async borrarBloqueo(id) { await this.bloqueos(); const d = db(); d.bloqueos = d.bloqueos.filter((x) => x.id !== id); sincronizarBloqueosDemo(d); guardar(d); },
  async personal() { return [...(db().personal ||= [])]; },
  async guardarPersona(p) {
    const d = db(); d.personal ||= [];
    if (p.id) Object.assign(d.personal.find((x) => x.id === p.id), p);
    else d.personal.push({ activo: true, ...p, id: uid(), created_at: new Date().toISOString() });
    guardar(d); return p;
  },
  async agregarGasto(g) {
    const d = db(); const r = d.reservas.find((x) => x.id === g.reserva_id);
    const nuevo = { id: uid(), fecha: hoyISO(), descripcion: "", ticket_path: null, ...g, created_at: new Date().toISOString() };
    (r.gastos ||= []).push(nuevo); guardar(d); return nuevo;
  },
  async borrarGasto(g) { const d = db(); const r = d.reservas.find((x) => x.id === g.reserva_id); r.gastos = (r.gastos || []).filter((x) => x.id !== g.id); guardar(d); },
  // en demo el ticket se guarda en este navegador (imagen reducida)
  async subirTicket(archivo) {
    if (!archivo.type.startsWith("image/")) throw new Error("En modo demo solo se pueden adjuntar imágenes");
    const img = await createImageBitmap(archivo);
    const k = Math.min(1, 900 / Math.max(img.width, img.height));
    const cv = Object.assign(document.createElement("canvas"), { width: Math.round(img.width * k), height: Math.round(img.height * k) });
    cv.getContext("2d").drawImage(img, 0, 0, cv.width, cv.height);
    return cv.toDataURL("image/jpeg", 0.8);
  },
  async urlTicket(ruta) { return ruta; },
  // En demo el QR se guarda en este navegador, reducido a 600 px
  async subirQR(archivo) {
    const img = await createImageBitmap(archivo);
    const k = Math.min(1, 600 / Math.max(img.width, img.height));
    const cv = Object.assign(document.createElement("canvas"), { width: Math.round(img.width * k), height: Math.round(img.height * k) });
    cv.getContext("2d").drawImage(img, 0, 0, cv.width, cv.height);
    return cv.toDataURL("image/png");
  },
  async actualizarCliente(id, patch) {
    const d = db();
    if (patch.telefono && d.clientes.some((c) => c.id !== id && c.telefono === patch.telefono)) throw new Error("duplicate key value violates unique constraint clientes_telefono_key");
    const c = d.clientes.find((x) => x.id === id); Object.assign(c, patch); guardar(d); return c;
  },
  reiniciarDemo() { try { localStorage.removeItem(CLAVE); } catch {} memoria = null; },
};

export const datos = modoDemo ? demo : remoto;

// ---------- pequeño helper de UI compartido ----------
export function toast(msg) {
  let t = document.getElementById("toast");
  if (!t) { t = document.createElement("div"); t.id = "toast"; document.body.appendChild(t); }
  t.textContent = msg; t.classList.add("ver");
  clearTimeout(t._h); t._h = setTimeout(() => t.classList.remove("ver"), 2600);
}
export const escapar = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
