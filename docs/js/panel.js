// Arrózame · Panel de administración
import { datos, modoDemo, hoyISO, sumarDias, bs, fechaLarga, escapar, toast } from "./datos.js";

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];

const ESTADOS = ["pendiente", "confirmada", "pagada", "realizada", "cancelada"];
const ETQ = { pendiente: "Pendiente", confirmada: "Confirmada", pagada: "Pagada", realizada: "Realizada", cancelada: "Cancelada" };
const COLOR_EV = { pendiente: "#FBEBC7", confirmada: "#E3E6D8", pagada: "#DCEBD8", realizada: "#ECEAE6", cancelada: "#F6DDD7" };
const ORIGEN = { web: "Web", whatsapp: "WhatsApp", instagram: "Instagram", manual: "Manual", otro: "Otro" };

const st = {
  vista: "agenda", reservas: [], productos: [], cfg: null, personal: [], bloqueos: [],
  agenda: { modo: "proximas", estado: "", q: "" },
  mesCal: hoyISO().slice(0, 7),
  periodo: 6, metrica: "raciones",
};

const chip = (e) => `<span class="est est-${e}">${ETQ[e] || e}</span>`;
const hhmm = (h) => String(h || "").slice(0, 5);
const telWa = (t) => String(t || "").replace(/\D/g, "").replace(/^(?!591)(\d{8})$/, "591$1");
const saldo = (r) => Math.max(0, Number(r.total) - Number(r.anticipo || 0));
const activas = (rs) => rs.filter((r) => r.estado !== "cancelada");
// ---- cobro del anticipo con QR
const pctAnticipo = () => Number(st.cfg?.anticipo_porcentaje) || 50;
const montoAnticipo = (r) => Math.round((Number(r.total) * pctAnticipo()) / 100);
const fechaHora = (iso) => new Date(iso).toLocaleString("es-BO", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
const urlPaginaQR = (r) => {
  const u = new URL("qr.html", location.href);
  u.searchParams.set("c", r.codigo); u.searchParams.set("m", montoAnticipo(r));
  return u.href;
};
const MENSAJE_ANTICIPO_BASE = "¡Hola {nombre}! Para asegurar tu reserva *{codigo}* del {fecha} te enviamos el QR para el anticipo del {porcentaje}% ({monto}):\n{enlace}\n\nCuando pagues, envíanos el comprobante por aquí. ¡Gracias!";
const mensajeAnticipo = (r, nombre1) => (st.cfg?.mensaje_anticipo || MENSAJE_ANTICIPO_BASE)
  .replaceAll("{nombre}", nombre1).replaceAll("{codigo}", r.codigo).replaceAll("{fecha}", fechaLarga(r.fecha))
  .replaceAll("{porcentaje}", pctAnticipo()).replaceAll("{monto}", bs(montoAnticipo(r))).replaceAll("{enlace}", urlPaginaQR(r));
// ---- equipo, orden de compra y gastos
const CATEGORIAS = { ingredientes: "Ingredientes", gas: "Gas", transporte: "Transporte", personal: "Personal", otros: "Otros" };
const COMPRA = { pendiente: "Falta compra", pedida: "Compra pedida", comprada: "Comprado" };
const totalGastos = (r) => (r.gastos || []).reduce((t, g) => t + Number(g.monto || 0), 0);
const personaDe = (id) => st.personal.find((p) => p.id === id);
const equipoDe = (r) => (r.equipo || []).map(personaDe).filter(Boolean);
const ordenCompra = (r) => {
  const items = (r.reserva_items || []).map((i) => `• ${i.raciones} raciones · ${i.nombre}`).join("\n");
  const lugar = [r.direccion, r.zona].filter(Boolean).join(", ");
  const equipo = equipoDe(r).map((p) => p.nombre).join(", ");
  return [
    r.evento_grande ? "*Orden de compra · Arrózame · EVENTO GRANDE*" : "*Orden de compra · Arrózame*",
    `Reserva ${r.codigo} · ${fechaLarga(r.fecha)} · ${hhmm(r.hora)}`,
    [r.tipo_evento, r.invitados ? `${r.invitados} invitados` : ""].filter(Boolean).join(" · "),
    lugar ? `Lugar: ${lugar}` : "",
    lugar ? `Mapa: https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(lugar + ", Santa Cruz, Bolivia")}` : "",
    "",
    "Paellas:", items,
    `Total: ${r.raciones_total} raciones`,
    `Showcooking: ${r.showcooking ? "Sí" : "No"}`,
    equipo ? `Equipo: ${equipo}` : "",
    r.notas_cliente ? `Notas del cliente: ${r.notas_cliente}` : "",
    "",
    "Cuando tengas la compra, envíame la foto del ticket. ¡Gracias!",
  ].filter((l, i, a) => l !== "" || (a[i - 1] !== "" && i > 0)).join("\n");
};
const etiquetaCompra = (r) => {
  if (!["confirmada", "pagada"].includes(r.estado) || r.fecha < hoyISO()) return "";
  const e = r.compra_estado || "pendiente";
  const color = { pendiente: "terracota", pedida: "amarillo", comprada: "oliva" }[e];
  return `<span class="etiqueta registro ${color}">${COMPRA[e]}</span>`;
};
const etiquetaAnticipo = (r) => {
  if (!["pendiente", "confirmada"].includes(r.estado)) return "";
  if (Number(r.anticipo) > 0) return `<span class="etiqueta registro oliva">Anticipo pagado</span>`;
  if (r.qr_enviado_at) return `<span class="etiqueta registro amarillo">QR enviado</span>`;
  return "";
};

// ================================================================ arranque / sesión
async function iniciar() {
  if (modoDemo) {
    $("#banda-demo").classList.remove("oculto");
    $("#login-demo").classList.remove("oculto");
    $("#reset-demo").onclick = (e) => { e.preventDefault(); datos.reiniciarDemo(); location.reload(); };
  }
  const u = await datos.usuario().catch(() => null);
  u ? entrar(u) : $("#login").classList.remove("oculto");
}

$("#form-login").addEventListener("submit", async (e) => {
  e.preventDefault();
  const f = e.target; $("#login-error").classList.add("oculto");
  try { entrar(await datos.login(f.email.value, f.password.value)); }
  catch (err) { $("#login-error").textContent = err.message; $("#login-error").classList.remove("oculto"); }
});
const salir = async () => { await datos.logout(); location.reload(); };
$("#salir").onclick = salir;
$("#salir-movil").onclick = salir;

async function entrar(u) {
  $("#login").classList.add("oculto"); $("#app").classList.remove("oculto");
  $("#usuario").textContent = u.email;
  $("#usuario-movil").textContent = u.email;
  await recargar();
  const v = location.hash.slice(1);
  ir(["agenda", "calendario", "estadisticas", "clientes", "carta", "ajustes"].includes(v) ? v : "agenda");
}

async function recargar() {
  [st.reservas, st.productos, st.cfg, st.personal, st.bloqueos] = await Promise.all([
    datos.reservas(), datos.productos({ todos: true }), datos.configCompleta(), datos.personal().catch(() => []), datos.bloqueos().catch(() => []),
  ]);
}

$("#menu").onclick = (e) => { const b = e.target.closest("button"); if (b) ir(b.dataset.vista); };
window.addEventListener("hashchange", () => { const v = location.hash.slice(1); if (v && v !== st.vista && VISTAS[v]) ir(v); });
function ir(v) {
  st.vista = v;
  if (location.hash.slice(1) !== v) history.replaceState(null, "", "#" + v);
  $$("#menu button").forEach((b) => b.classList.toggle("activo", b.dataset.vista === v));
  VISTAS[v]();
  window.scrollTo(0, 0);
}
const pintar = () => VISTAS[st.vista]();

// ================================================================ AGENDA
function vistaAgenda() {
  const hoy = hoyISO(), en7 = sumarDias(hoy, 7);
  const futuras = activas(st.reservas).filter((r) => r.fecha >= hoy);
  const semana = futuras.filter((r) => r.fecha <= en7);
  const pendientes = st.reservas.filter((r) => r.estado === "pendiente" && r.fecha >= hoy);
  const porCobrar = futuras.reduce((a, r) => a + saldo(r), 0);

  const a = st.agenda;
  let lista = st.reservas.filter((r) =>
    (a.modo === "todas" || (a.modo === "proximas" ? r.fecha >= hoy : r.fecha < hoy)) &&
    (!a.estado || r.estado === a.estado) &&
    (!a.q || `${r.clientes?.nombre} ${r.clientes?.telefono} ${r.codigo} ${r.zona} ${r.tipo_evento}`.toLowerCase().includes(a.q.toLowerCase())));
  if (a.modo === "pasadas") lista = lista.reverse();

  const grupos = {};
  lista.forEach((r) => (grupos[r.fecha] ??= []).push(r));

  $("#vista").innerHTML = `
    <div class="cab"><h1>Agenda</h1>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <a class="btn sec chico" href="index.html" target="_blank">Ver página de reservas ↗</a>
        <button class="btn chico" id="nueva">+ Nueva reserva</button></div></div>
    <div class="kpis">
      <div class="kpi"><div class="lbl">Próximos 7 días</div><div class="val">${semana.length}</div><div class="sub">eventos · ${semana.reduce((s, r) => s + r.raciones_total, 0)} raciones</div></div>
      <div class="kpi"><div class="lbl">Por confirmar</div><div class="val" style="color:${pendientes.length ? "var(--terracota)" : "inherit"}">${pendientes.length}</div><div class="sub">reservas pendientes</div></div>
      <div class="kpi"><div class="lbl">Por cobrar</div><div class="val">${bs(porCobrar)}</div><div class="sub">saldo de eventos futuros</div></div>
      <div class="kpi"><div class="lbl">Agendado a futuro</div><div class="val">${bs(futuras.reduce((s, r) => s + Number(r.total), 0))}</div><div class="sub">${futuras.length} eventos</div></div>
    </div>
    <div class="filtros">
      <div class="seg" id="seg-modo">${[["proximas", "Próximas"], ["pasadas", "Pasadas"], ["todas", "Todas"]].map(([k, t]) => `<button data-k="${k}" class="${a.modo === k ? "activo" : ""}">${t}</button>`).join("")}</div>
      <select id="f-estado" style="width:auto;padding:8px 12px"><option value="">Todos los estados</option>${ESTADOS.map((e) => `<option value="${e}" ${a.estado === e ? "selected" : ""}>${ETQ[e]}</option>`).join("")}</select>
      <input type="search" id="f-q" placeholder="Buscar cliente, código, zona…" value="${escapar(a.q)}">
    </div>
    <div id="lista">${Object.keys(grupos).length ? Object.entries(grupos).map(([f, rs]) => `
      <div class="dia-grupo"><h3>${f === hoy ? "Hoy · " : f === sumarDias(hoy, 1) ? "Mañana · " : ""}${fechaLarga(f)}</h3>
        ${rs.map(filaReserva).join("")}</div>`).join("") : `<div class="tarjeta muted">No hay reservas para este filtro.</div>`}</div>`;

  $("#nueva").onclick = nuevaReserva;
  $("#seg-modo").onclick = (e) => { const b = e.target.closest("button"); if (b) { a.modo = b.dataset.k; pintar(); } };
  $("#f-estado").onchange = (e) => { a.estado = e.target.value; pintar(); };
  $("#f-q").oninput = (e) => { a.q = e.target.value; const pos = e.target.selectionStart; pintar(); const i = $("#f-q"); i.focus(); i.setSelectionRange(pos, pos); };
  $("#lista").onclick = (e) => { const f = e.target.closest("[data-id]"); if (f) abrirReserva(f.dataset.id); };
}
function filaReserva(r) {
  const platos = (r.reserva_items || []).map((i) => `${i.raciones} ${i.nombre.replace(/^Paella (de )?/, "")}`).join(" · ");
  return `<div class="res e-${r.estado}" data-id="${r.id}">
    <div class="h">${hhmm(r.hora)}</div>
    <div><div class="t">${escapar(r.clientes?.nombre || "—")} <span class="small muted">· ${escapar(r.tipo_evento || "")}</span>${r.evento_grande ? ` <span class="etiqueta grande">Evento grande</span>` : ""}</div>
      <div class="d">${r.raciones_total} rac · ${escapar(platos)}${r.showcooking ? ` <span class="etiqueta show">Showcooking</span>` : ""}</div>
      <div class="d">${escapar([r.zona, r.direccion].filter(Boolean).join(" · "))}</div></div>
    <div class="m">${chip(r.estado)}${etiquetaAnticipo(r)}${etiquetaCompra(r)}<b>${bs(r.total)}</b>${saldo(r) && r.estado !== "cancelada" ? `<span class="small muted">saldo ${bs(saldo(r))}</span>` : ""}</div>
  </div>`;
}

// ================================================================ CALENDARIO
function vistaCalendario() {
  const [y, m] = st.mesCal.split("-").map(Number);
  const primero = new Date(y, m - 1, 1);
  const offset = (primero.getDay() + 6) % 7;
  const inicio = sumarDias(`${st.mesCal}-01`, -offset);
  const hoy = hoyISO();
  const porDia = {};
  st.reservas.forEach((r) => (porDia[r.fecha] ??= []).push(r));
  const bloq = new Set(st.cfg.dias_bloqueados || []);
  const hoyISO_ = hoyISO();
  const proximos = st.bloqueos.filter((b) => b.hasta >= hoyISO_).sort((a, b) => a.desde.localeCompare(b.desde));
  let celdas = ["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"].map((d) => `<div class="dow">${d}</div>`).join("");
  for (let i = 0; i < 42; i++) {
    const f = sumarDias(inicio, i);
    if (i >= 35 && f.slice(0, 7) !== st.mesCal) break;
    const evs = (porDia[f] || []).sort((a, b) => a.hora.localeCompare(b.hora));
    celdas += `<div class="cel ${f.slice(0, 7) !== st.mesCal ? "fuera" : ""} ${f === hoy ? "hoy" : ""} ${bloq.has(f) ? "bloq" : ""}">
      <button type="button" class="n" data-bloq="${f}" title="${bloq.has(f) ? "Ver o quitar el bloqueo" : "Bloquear desde este día"}" aria-label="${Number(f.slice(8))}: ${bloq.has(f) ? "bloqueado" : "bloquear"}">${Number(f.slice(8))}</button>
      ${bloq.has(f) ? `<span class="motivo">${MOTIVOS[bloqueoDe(f)?.motivo] || "Bloqueado"}</span>` : ""}
      ${evs.map((r) => `<button class="ev" data-id="${r.id}" style="background:${COLOR_EV[r.estado]}">${hhmm(r.hora)} ${escapar((r.clientes?.nombre || "").split(" ")[0])} · ${r.raciones_total}</button>`).join("")}
    </div>`;
  }
  const delMes = activas(st.reservas).filter((r) => r.fecha.startsWith(st.mesCal));
  $("#vista").innerHTML = `
    <div class="cab"><h1>${(([a, ...r]) => a.toUpperCase() + r.join(""))(primero.toLocaleDateString("es-BO", { month: "long", year: "numeric" }))}</h1>
      <div style="display:flex;gap:8px"><button class="btn sec chico" data-m="-1">‹</button><button class="btn sec chico" data-m="0">Hoy</button><button class="btn sec chico" data-m="1">›</button><button class="btn sec chico" id="bloquear">Bloquear fechas</button><button class="btn chico" id="nueva">+ Nueva</button></div></div>
    <p class="muted small" style="margin-top:-8px">${delMes.length} eventos · ${delMes.reduce((s, r) => s + r.raciones_total, 0)} raciones · ${bs(delMes.reduce((s, r) => s + Number(r.total), 0))} · Toca el número de un día para bloquearlo o ver su bloqueo.</p>
    <div class="pcal">${celdas}</div>
    <div class="filtros small" style="margin-top:12px">${ESTADOS.map((e) => `<span class="est est-${e}">${ETQ[e]}</span>`).join("")}<span class="leyenda-bloq">Bloqueado</span></div>
    <div class="tarjeta bloqueos-tarjeta">
      <h2>Fechas bloqueadas</h2>
      <p class="bajada">Esos días no se pueden reservar desde la web. Desde el panel sí puedes cargar una reserva si haces una excepción.</p>
      ${proximos.length ? `<div class="bloqueos-lista">${proximos.map((b) => `<div class="bloqueo">
          <div><b>${rangoTexto(b)}</b><span class="small muted">${MOTIVOS[b.motivo] || b.motivo}${b.nota ? " · " + escapar(b.nota) : ""}</span></div>
          <button type="button" class="btn sec chico" data-desbloquear="${b.id}">Desbloquear</button></div>`).join("")}</div>`
        : `<p class="small muted" style="margin:0">No hay fechas bloqueadas próximas.</p>`}
    </div>`;
  $("#nueva").onclick = nuevaReserva;
  $("#bloquear").onclick = () => formBloqueo(hoyISO_ > `${st.mesCal}-01` ? hoyISO_ : `${st.mesCal}-01`);
  $(".bloqueos-tarjeta").onclick = (e) => { const b = e.target.closest("[data-desbloquear]"); if (b) desbloquear(st.bloqueos.find((x) => x.id === b.dataset.desbloquear)); };
  $$("[data-m]").forEach((b) => b.onclick = () => {
    const d = Number(b.dataset.m);
    if (!d) st.mesCal = hoyISO().slice(0, 7);
    else { const n = new Date(y, m - 1 + d, 1); st.mesCal = `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, "0")}`; }
    pintar();
  });
  $(".pcal").onclick = async (e) => {
    const ev = e.target.closest(".ev"); if (ev) return abrirReserva(ev.dataset.id);
    const n = e.target.closest("[data-bloq]"); if (!n) return;
    const f = n.dataset.bloq; const b = bloqueoDe(f);
    b ? verBloqueo(b) : formBloqueo(f);
  };
}

// ---------------------------------------------------------------- bloqueos de fechas
const MOTIVOS = { vacaciones: "Vacaciones", equipo: "Falta de equipo", privado: "Evento privado", otro: "Otro" };
const bloqueoDe = (f) => st.bloqueos.find((b) => b.desde <= f && f <= b.hasta);
const fechaCorta = (f) => new Date(f + "T12:00").toLocaleDateString("es-BO", { day: "numeric", month: "long" });
const rangoTexto = (b) => b.desde === b.hasta ? fechaCorta(b.desde) : `Del ${fechaCorta(b.desde)} al ${fechaCorta(b.hasta)}`;
async function refrescarBloqueos() { [st.bloqueos, st.cfg] = await Promise.all([datos.bloqueos(), datos.configCompleta()]); }
function formBloqueo(desde) {
  const c = cajon(`
    <h2>Bloquear fechas</h2>
    <p class="muted small" style="margin-top:0">Esos días no se podrán reservar desde la web.</p>
    <form id="fb">
      <div class="bloque">
        <div class="fila"><label class="campo"><span>Desde</span><input type="date" name="desde" value="${desde}" required></label>
          <label class="campo"><span>Hasta</span><input type="date" name="hasta" value="${desde}" required></label></div>
        <label class="campo"><span>Motivo</span><select name="motivo">${Object.entries(MOTIVOS).map(([k, t]) => `<option value="${k}">${t}</option>`).join("")}</select></label>
        <label class="campo" style="margin:0"><span>Nota (opcional, solo la ves tú)</span><input type="text" name="nota" placeholder="Ej. viaje a España, Kike de vacaciones"></label>
      </div>
      <div class="aviso info oculto" id="aviso-bloq"></div>
      <button class="btn" style="width:100%">Bloquear</button>
    </form>`);
  const f = $("#fb", c);
  const revisar = () => {
    if (f.hasta.value < f.desde.value) f.hasta.value = f.desde.value;
    const rs = activas(st.reservas).filter((r) => r.fecha >= f.desde.value && r.fecha <= f.hasta.value);
    const a = $("#aviso-bloq", c);
    a.classList.toggle("oculto", !rs.length);
    a.innerHTML = rs.length ? `Ojo: hay <b>${rs.length} ${rs.length === 1 ? "reserva" : "reservas"}</b> en esas fechas (${rs.map((r) => escapar((r.clientes?.nombre || "").split(" ")[0]) + " " + r.fecha.slice(8) + "/" + r.fecha.slice(5, 7)).join(", ")}). Bloquear no las cancela.` : "";
  };
  f.oninput = revisar; revisar();
  f.onsubmit = async (e) => {
    e.preventDefault(); const b = $("button.btn", f); b.disabled = true; b.textContent = "Bloqueando…";
    try {
      await datos.crearBloqueo({ desde: f.desde.value, hasta: f.hasta.value, motivo: f.motivo.value, nota: f.nota.value.trim() || null });
      await refrescarBloqueos(); cerrarCajon(); toast("Fechas bloqueadas"); pintar();
    } catch (err) { toast("No se pudo bloquear: " + err.message); b.disabled = false; b.textContent = "Bloquear"; }
  };
}
function verBloqueo(b) {
  const c = cajon(`
    <h2>Fecha bloqueada</h2>
    <div class="bloque">
      <div class="linea"><span>Fechas</span><b>${rangoTexto(b)}</b></div>
      <div class="linea"><span>Motivo</span><span>${MOTIVOS[b.motivo] || b.motivo}</span></div>
      ${b.nota ? `<div class="linea"><span>Nota</span><span>${escapar(b.nota)}</span></div>` : ""}
    </div>
    <button type="button" class="btn" style="width:100%" id="desbloquear-uno">Desbloquear</button>`);
  $("#desbloquear-uno", c).onclick = () => desbloquear(b);
}
async function desbloquear(b) {
  if (!b || !confirm(`¿Desbloquear ${rangoTexto(b).toLowerCase()}? Esos días vuelven a estar disponibles en la web.`)) return;
  try { await datos.borrarBloqueo(b.id); await refrescarBloqueos(); cerrarCajon(); toast("Fechas desbloqueadas"); pintar(); }
  catch (err) { toast("No se pudo desbloquear: " + err.message); }
}

// ================================================================ ESTADÍSTICAS
function vistaEstadisticas() {
  const hoy = hoyISO();
  const desde = st.periodo ? sumarDias(hoy, -Math.round(st.periodo * 30.4)) : "0000";
  const rs = activas(st.reservas).filter((r) => r.fecha >= desde && r.fecha <= sumarDias(hoy, 365));
  const ingresos = rs.reduce((s, r) => s + Number(r.total), 0);
  const raciones = rs.reduce((s, r) => s + r.raciones_total, 0);
  const conShow = rs.filter((r) => r.showcooking).length;
  const canceladas = st.reservas.filter((r) => r.estado === "cancelada" && r.fecha >= desde).length;
  // gastos y margen (solo eventos con gastos cargados, para no inflar el margen)
  const conGasto = rs.filter((r) => totalGastos(r) > 0);
  const gastoTotal = conGasto.reduce((t, r) => t + totalGastos(r), 0);
  const cobradoConGasto = conGasto.reduce((t, r) => t + Number(r.total), 0);
  const margen = cobradoConGasto - gastoTotal;
  const porCat = {}; conGasto.forEach((r) => (r.gastos || []).forEach((g) => { porCat[g.categoria] = (porCat[g.categoria] || 0) + Number(g.monto); }));
  const ultimos = [...conGasto].sort((a, b) => b.fecha.localeCompare(a.fecha)).slice(0, 12);

  // Paellas
  const pa = {};
  rs.forEach((r) => (r.reserva_items || []).forEach((i) => {
    const x = (pa[i.nombre] ??= { nombre: i.nombre, raciones: 0, ingresos: 0, reservas: 0 });
    x.raciones += i.raciones; x.ingresos += Number(i.subtotal ?? i.raciones * i.precio_unit); x.reservas++;
  }));
  const paellas = Object.values(pa).sort((a, b) => b[st.metrica] - a[st.metrica]);

  // Meses (últimos N meses + próximos agendados)
  const meses = {};
  rs.forEach((r) => { const k = r.fecha.slice(0, 7); const x = (meses[k] ??= { k, ingresos: 0, reservas: 0, raciones: 0 }); x.ingresos += Number(r.total); x.reservas++; x.raciones += r.raciones_total; });
  const mesesArr = Object.values(meses).sort((a, b) => a.k.localeCompare(b.k)).slice(-12);

  // Día de la semana
  const dias = ["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"].map((d) => ({ d, n: 0, rac: 0 }));
  rs.forEach((r) => { const i = (new Date(r.fecha + "T12:00").getDay() + 6) % 7; dias[i].n++; dias[i].rac += r.raciones_total; });

  const contar = (campo, mapa = (x) => x) => {
    const o = {}; rs.forEach((r) => { const k = mapa(r[campo]) || "Sin dato"; o[k] = (o[k] || 0) + 1; });
    return Object.entries(o).map(([nombre, n]) => ({ nombre, n })).sort((a, b) => b.n - a.n);
  };
  const horas = {}; rs.forEach((r) => { const h = hhmm(r.hora); horas[h] = (horas[h] || 0) + 1; });

  const fmt = st.metrica === "ingresos" ? bs : (n) => n.toLocaleString("es-BO");
  const unidad = { raciones: "raciones", ingresos: "", reservas: "reservas" }[st.metrica];

  $("#vista").innerHTML = `
    <div class="cab"><h1>Ventas</h1>
      <div class="seg" id="seg-per">${[[3, "3 meses"], [6, "6 meses"], [12, "12 meses"], [0, "Todo"]].map(([k, t]) => `<button data-k="${k}" class="${st.periodo === k ? "activo" : ""}">${t}</button>`).join("")}</div></div>
    <p class="muted small" style="margin-top:-8px">Incluye eventos realizados y agendados del período (sin cancelados), por fecha del evento.</p>
    <div class="kpis">
      <div class="kpi"><div class="lbl">Ingresos</div><div class="val">${bs(ingresos)}</div><div class="sub">${rs.length} eventos</div></div>
      <div class="kpi"><div class="lbl">Raciones</div><div class="val">${raciones.toLocaleString("es-BO")}</div><div class="sub">${rs.length ? Math.round(raciones / rs.length) : 0} por evento</div></div>
      <div class="kpi"><div class="lbl">Ticket promedio</div><div class="val">${bs(rs.length ? ingresos / rs.length : 0)}</div><div class="sub">por reserva</div></div>
      <div class="kpi"><div class="lbl">Gastos</div><div class="val">${bs(gastoTotal)}</div><div class="sub">en ${conGasto.length} eventos con gastos cargados</div></div>
      <div class="kpi"><div class="lbl">Margen</div><div class="val" style="color:var(--oliva-osc)">${bs(margen)}</div><div class="sub">${cobradoConGasto ? Math.round((margen / cobradoConGasto) * 100) : 0}% sobre esos eventos</div></div>
      <div class="kpi"><div class="lbl">Con showcooking</div><div class="val">${rs.length ? Math.round((conShow / rs.length) * 100) : 0}%</div><div class="sub">${canceladas} cancelaciones</div></div>
    </div>
    <div class="grid2">
      <div class="tarjeta" style="grid-column:1/-1">
        <div class="cab" style="margin-bottom:6px"><div><h2>Las paellas que más salen</h2><p class="bajada" style="margin:0">Ranking por ${st.metrica}</p></div>
          <div class="seg" id="seg-met">${[["raciones", "Raciones"], ["ingresos", "Ingresos"], ["reservas", "Pedidos"]].map(([k, t]) => `<button data-k="${k}" class="${st.metrica === k ? "activo" : ""}">${t}</button>`).join("")}</div></div>
        ${barras(paellas.map((p) => ({ nombre: p.nombre, v: p[st.metrica], tip: `<b>${escapar(p.nombre)}</b><br>${p.raciones} raciones · ${bs(p.ingresos)}<br>en ${p.reservas} pedidos` })), fmt, true)}
        <details style="margin-top:14px"><summary class="small" style="cursor:pointer">Ver como tabla</summary>
          <div class="scroll-x"><table class="tabla" style="margin-top:8px"><thead><tr><th>Paella</th><th class="num">Raciones</th><th class="num">Pedidos</th><th class="num">Ingresos</th><th class="num">% ingresos</th></tr></thead>
          <tbody>${paellas.map((p) => `<tr><td>${escapar(p.nombre)}</td><td class="num">${p.raciones}</td><td class="num">${p.reservas}</td><td class="num">${bs(p.ingresos)}</td><td class="num">${ingresos ? Math.round((p.ingresos / Object.values(pa).reduce((s, x) => s + x.ingresos, 0)) * 100) : 0}%</td></tr>`).join("")}</tbody></table></div></details>
      </div>
      <div class="tarjeta"><h2>Gastos por categoría</h2><p class="bajada">Eventos con gastos cargados</p>
        ${barras(Object.entries(porCat).sort((a, b) => b[1] - a[1]).map(([k, v]) => ({ nombre: CATEGORIAS[k] || k, v })), bs)}</div>
      <div class="tarjeta"><h2>Margen por evento</h2><p class="bajada">Últimos eventos con gastos cargados</p>
        ${ultimos.length ? `<div class="scroll-x"><table class="tabla"><thead><tr><th>Fecha</th><th>Cliente</th><th class="num">Cobrado</th><th class="num">Gastado</th><th class="num">Margen</th></tr></thead>
        <tbody>${ultimos.map((r) => { const g = totalGastos(r), m = Number(r.total) - g; return `<tr data-id="${r.id}" class="fila-click"><td>${r.fecha.slice(8)}/${r.fecha.slice(5, 7)}</td><td>${escapar(r.clientes?.nombre || "—")}</td><td class="num">${bs(r.total)}</td><td class="num">${bs(g)}</td><td class="num"><b>${bs(m)}</b> <span class="small muted">${Number(r.total) ? Math.round((m / Number(r.total)) * 100) : 0}%</span></td></tr>`; }).join("")}</tbody></table></div>`
        : `<p class="muted small">Todavía no hay gastos cargados. Se cargan desde cada reserva.</p>`}</div>
      <div class="tarjeta"><h2>Ingresos por mes</h2><p class="bajada">Por fecha del evento</p>
        ${columnas(mesesArr.map((x) => ({ et: new Date(x.k + "-15").toLocaleDateString("es-BO", { month: "short" }), v: x.ingresos, lbl: x.ingresos >= 1000 ? Math.round(x.ingresos / 1000) + "k" : x.ingresos, tip: `<b>${new Date(x.k + "-15").toLocaleDateString("es-BO", { month: "long", year: "numeric" })}</b><br>${bs(x.ingresos)} · ${x.reservas} eventos · ${x.raciones} raciones` })))}</div>
      <div class="tarjeta"><h2>Días con más demanda</h2><p class="bajada">Cantidad de eventos por día de la semana</p>
        ${columnas(dias.map((x) => ({ et: x.d, v: x.n, lbl: x.n, tip: `<b>${x.d}</b><br>${x.n} eventos · ${x.rac} raciones` })))}</div>
      <div class="tarjeta"><h2>Tipo de evento</h2><p class="bajada">Eventos por ocasión</p>${barras(contar("tipo_evento").map((x) => ({ nombre: x.nombre, v: x.n })), (n) => n)}</div>
      <div class="tarjeta"><h2>¿Por dónde llegan?</h2><p class="bajada">Origen de la reserva</p>${barras(contar("origen", (o) => ORIGEN[o] || o).map((x) => ({ nombre: x.nombre, v: x.n })), (n) => n)}</div>
      <div class="tarjeta"><h2>Zonas</h2><p class="bajada">Dónde son los eventos</p>${barras(contar("zona").slice(0, 8).map((x) => ({ nombre: x.nombre, v: x.n })), (n) => n)}</div>
      <div class="tarjeta"><h2>Horarios</h2><p class="bajada">Hora de servicio más pedida</p>${barras(Object.entries(horas).sort((a, b) => b[1] - a[1]).map(([h, n]) => ({ nombre: h, v: n })), (n) => n)}</div>
    </div>`;
  $("#seg-per").onclick = (e) => { const b = e.target.closest("button"); if (b) { st.periodo = Number(b.dataset.k); pintar(); } };
  $("#seg-met").onclick = (e) => { const b = e.target.closest("button"); if (b) { st.metrica = b.dataset.k; pintar(); } };
  $$(".fila-click").forEach((tr) => (tr.onclick = () => abrirReserva(tr.dataset.id)));
  activarTips();
}
function barras(items, fmt, numerado = false) {
  if (!items.length) return `<p class="muted small">Sin datos en este período.</p>`;
  const max = Math.max(...items.map((i) => i.v), 1);
  return `<div class="barras">${items.map((i, k) => `
    <div class="barra" ${i.tip ? `data-tip="${escapar(i.tip)}"` : ""}>
      <span class="nom">${numerado ? `<span class="pos">${k + 1}</span>` : ""}${escapar(i.nombre)}</span>
      <div class="pista"><div class="rel" style="width:${(i.v / max) * 100}%"></div></div>
      <span class="num">${fmt(i.v)}</span></div>`).join("")}</div>`;
}
function columnas(items) {
  if (!items.length) return `<p class="muted small">Sin datos en este período.</p>`;
  const max = Math.max(...items.map((i) => i.v), 1);
  return `<div class="columnas">${items.map((i) => `<div class="col" data-tip="${escapar(i.tip || "")}"><span class="v">${i.lbl}</span><div class="c" style="height:${(i.v / max) * 85}%"></div></div>`).join("")}</div>
    <div class="ejes">${items.map((i) => `<span>${i.et}</span>`).join("")}</div>`;
}
function activarTips() {
  const tip = $("#tip");
  $$("[data-tip]").forEach((el) => {
    if (!el.dataset.tip) return;
    el.onmousemove = (e) => { tip.innerHTML = el.dataset.tip; tip.classList.add("ver"); tip.style.left = Math.min(e.clientX + 14, innerWidth - 270) + "px"; tip.style.top = e.clientY + 14 + "px"; };
    el.onmouseleave = () => tip.classList.remove("ver");
  });
}

// ================================================================ CLIENTES
function vistaClientes(q = "") {
  const m = {};
  st.reservas.forEach((r) => {
    const c = r.clientes || {}; if (!c.id) return;
    const x = (m[c.id] ??= { ...c, reservas: 0, raciones: 0, gastado: 0, ultima: "", proxima: "" });
    if (r.estado === "cancelada") return;
    x.reservas++; x.raciones += r.raciones_total; x.gastado += Number(r.total);
    if (r.fecha <= hoyISO() && r.fecha > x.ultima) x.ultima = r.fecha;
    if (r.fecha > hoyISO() && (!x.proxima || r.fecha < x.proxima)) x.proxima = r.fecha;
  });
  const lista = Object.values(m).filter((c) => !q || `${c.nombre} ${c.telefono}`.toLowerCase().includes(q.toLowerCase())).sort((a, b) => b.gastado - a.gastado);
  const recurrentes = Object.values(m).filter((c) => c.reservas > 1).length;
  $("#vista").innerHTML = `
    <div class="cab"><h1>Clientes</h1><input type="search" id="q" placeholder="Buscar…" value="${escapar(q)}" style="max-width:240px;padding:8px 12px;border-radius:999px;border:1.5px solid var(--linea)"></div>
    <p class="muted small" style="margin-top:-8px">${Object.keys(m).length} clientes · ${recurrentes} volvieron a pedir</p>
    <div class="tarjeta scroll-x"><table class="tabla"><thead><tr><th>Cliente</th><th>WhatsApp</th><th class="num">Eventos</th><th class="num">Raciones</th><th class="num">Total</th><th>Último</th><th>Próximo</th></tr></thead>
    <tbody>${lista.map((c) => `<tr><td><b>${escapar(c.nombre)}</b>${c.reservas > 1 ? ' <span class="tag">recurrente</span>' : ""}</td>
      <td><a href="https://wa.me/${telWa(c.telefono)}" target="_blank">${escapar(c.telefono)}</a></td>
      <td class="num">${c.reservas}</td><td class="num">${c.raciones}</td><td class="num">${bs(c.gastado)}</td>
      <td>${c.ultima ? c.ultima.split("-").reverse().join("/") : "—"}</td><td>${c.proxima ? c.proxima.split("-").reverse().join("/") : "—"}</td></tr>`).join("")}</tbody></table></div>`;
  $("#q").oninput = (e) => { const v = e.target.value; vistaClientes(v); const i = $("#q"); i.focus(); i.setSelectionRange(v.length, v.length); };
}

// ================================================================ CARTA
function vistaCarta() {
  $("#vista").innerHTML = `
    <div class="cab"><h1>Carta</h1><button class="btn chico" id="nuevo-plato">+ Agregar paella</button></div>
    <p class="muted small" style="margin-top:-8px">Los cambios de precio aplican a reservas nuevas. Las reservas ya hechas conservan su precio. Desactiva una paella para ocultarla de la página pública.</p>
    <div class="tarjeta scroll-x"><table class="tabla"><thead><tr><th>Paella</th><th>Categoría</th><th class="num">Precio/ración</th><th>Visible</th><th></th></tr></thead>
    <tbody>${st.productos.map((p) => `<tr data-id="${p.id}">
      <td><b>${escapar(p.nombre)}</b><div class="small muted">${escapar(p.ingredientes || "")}</div></td>
      <td>${p.categoria === "autor" ? "Boliviana de autor" : p.categoria === "extra" ? "Extra" : "Tradicional"}</td>
      <td class="num"><input type="number" data-precio value="${p.precio_bs}" min="0" style="width:90px;text-align:right;padding:6px 8px"></td>
      <td><input type="checkbox" data-activo ${p.activo ? "checked" : ""} style="width:18px;height:18px;accent-color:var(--terracota)"></td>
      <td><button class="btn sec chico" data-editar>Editar</button></td></tr>`).join("")}</tbody></table></div>`;
  $("#nuevo-plato").onclick = () => editarPlato({ nombre: "", ingredientes: "", descripcion: "", categoria: "autor", precio_bs: 105, activo: true, orden: st.productos.length + 1 });
  $("tbody").onchange = async (e) => {
    const tr = e.target.closest("tr"); const p = st.productos.find((x) => x.id === tr.dataset.id);
    const patch = e.target.matches("[data-precio]") ? { precio_bs: Number(e.target.value) } : { activo: e.target.checked };
    await datos.guardarProducto({ id: p.id, ...patch }); Object.assign(p, patch); toast("Carta actualizada");
  };
  $("tbody").onclick = (e) => { if (e.target.matches("[data-editar]")) editarPlato(st.productos.find((x) => x.id === e.target.closest("tr").dataset.id)); };
}
function editarPlato(p) {
  const c = cajon(`<h2>${p.id ? "Editar paella" : "Nueva paella"}</h2>
    <form id="fp" class="bloque">
      <label class="campo"><span>Nombre</span><input type="text" name="nombre" value="${escapar(p.nombre)}" required></label>
      <label class="campo"><span>Ingredientes</span><input type="text" name="ingredientes" value="${escapar(p.ingredientes || "")}"></label>
      <label class="campo"><span>Descripción</span><textarea name="descripcion">${escapar(p.descripcion || "")}</textarea></label>
      <div class="fila"><label class="campo"><span>Categoría</span><select name="categoria">
          <option value="tradicional" ${p.categoria === "tradicional" ? "selected" : ""}>Tradicional española</option>
          <option value="autor" ${p.categoria === "autor" ? "selected" : ""}>Boliviana de autor</option>
          <option value="extra" ${p.categoria === "extra" ? "selected" : ""}>Extra</option></select></label>
        <label class="campo"><span>Precio por ración (Bs)</span><input type="number" name="precio_bs" value="${p.precio_bs}" min="0"></label></div>
      <label class="campo"><span>Orden en la carta</span><input type="number" name="orden" value="${p.orden}"></label>
      <button class="btn">Guardar</button></form>`);
  $("#fp", c).onsubmit = async (e) => {
    e.preventDefault(); const f = e.target;
    await datos.guardarProducto({ ...(p.id ? { id: p.id } : {}), nombre: f.nombre.value.trim(), ingredientes: f.ingredientes.value, descripcion: f.descripcion.value,
      categoria: f.categoria.value, precio_bs: Number(f.precio_bs.value), orden: Number(f.orden.value), activo: p.activo ?? true });
    st.productos = await datos.productos({ todos: true }); cerrarCajon(); toast("Guardado"); pintar();
  };
}

// ================================================================ AJUSTES
async function vistaAjustes() {
  const c = st.cfg;
  const url = await datos.urlCalendario();
  const publica = new URL("index.html", location.href).href;
  $("#vista").innerHTML = `
    <div class="cab"><h1>Ajustes</h1></div>
    <div class="grid2">
      <div class="tarjeta">
        <h2>Calendario en el iPhone</h2>
        <p class="bajada">Las reservas aparecen solas en el Calendario del iPhone, con aviso 24 h y 3 h antes.</p>
        ${modoDemo ? `<div class="aviso info">En modo demo no hay enlace real. Cuando conectes Supabase, aquí aparecerá tu enlace privado.</div>` : ""}
        <code class="url" id="url-cal">${escapar(url)}</code>
        <button class="btn sec chico" id="copiar-cal">Copiar enlace</button>
        <ol class="pasos-ios small" style="margin-top:14px;padding-left:18px">
          <li>En el iPhone abre <b>Ajustes → Calendario → Cuentas → Añadir cuenta → Otra</b>.</li>
          <li>Toca <b>Añadir calendario suscrito</b> y pega el enlace.</li>
          <li>Toca <b>Siguiente</b> y luego <b>Guardar</b>. Listo: aparece el calendario “Arrózame · Reservas”.</li>
          <li>Opcional: en <b>Ajustes → Calendario → Cuentas → Buscar</b>, elige “Cada 15 minutos”.</li>
        </ol>
        <p class="small muted">El enlace es privado: quien lo tenga ve las reservas. Si se filtra, genera uno nuevo.</p>
        ${modoDemo ? "" : `<button class="btn sec chico" id="regen">Generar enlace nuevo</button>`}
      </div>
      <div class="tarjeta">
        <h2>Página pública de reservas</h2>
        <p class="bajada">Compártela en Instagram, en la bio y como respuesta rápida de WhatsApp Business.</p>
        <code class="url">${escapar(publica)}</code>
        <button class="btn sec chico" id="copiar-pub">Copiar enlace</button>
      </div>
      <div class="tarjeta" id="t-equipo" style="grid-column:1/-1">
        <h2>Equipo</h2>
        <p class="bajada">Las personas que van a las paellas. En cada reserva eliges quiénes van y les envías la orden de compra por WhatsApp.</p>
        <div class="equipo-lista">${st.personal.length ? st.personal.map((p) => `<div class="persona ${p.activo ? "" : "inactiva"}">
            <div><b>${escapar(p.nombre)}</b><span class="small muted">${p.telefono ? escapar(p.telefono) : "Sin WhatsApp"}${p.activo ? "" : " · inactivo"}</span></div>
            <button type="button" class="btn sec chico" data-toggle-persona="${p.id}">${p.activo ? "Desactivar" : "Activar"}</button></div>`).join("")
          : `<p class="small muted">Todavía no hay nadie cargado.</p>`}</div>
        <form id="fpersona" class="fila-persona">
          <input type="text" name="nombre" placeholder="Nombre" aria-label="Nombre" required>
          <input type="tel" name="telefono" placeholder="WhatsApp (ej. 70000000)" aria-label="WhatsApp" inputmode="tel">
          <button class="btn chico">Agregar</button>
        </form>
      </div>
      <form class="tarjeta cobro" id="fqr" style="grid-column:1/-1">
        <h2>Cobro del anticipo</h2>
        <p class="bajada">Sube el QR de tu banco. Desde cada reserva lo envías por WhatsApp con el monto calculado y queda registrado cuándo se envió.</p>
        <div class="cobro-grid">
          <div class="qr-caja">
            ${c.qr_url ? `<img src="${escapar(c.qr_url)}" alt="QR de cobro actual" id="qr-vista">` : `<div class="qr-vacio" id="qr-vista">Sin QR todavía</div>`}
            <label class="btn sec chico qr-subir"><input type="file" name="qr" accept="image/png,image/jpeg,image/webp">${c.qr_url ? "Cambiar QR" : "Subir QR"}</label>
          </div>
          <div>
            <label class="campo"><span>Porcentaje del anticipo (%)</span><input type="number" name="anticipo_porcentaje" value="${pctAnticipo()}" min="1" max="100"></label>
            <label class="campo"><span>Mensaje de WhatsApp</span><textarea name="mensaje_anticipo" rows="5">${escapar(c.mensaje_anticipo || MENSAJE_ANTICIPO_BASE)}</textarea></label>
            <p class="small muted" style="margin-top:-8px">Se reemplazan solos: <code>{nombre}</code> <code>{codigo}</code> <code>{fecha}</code> <code>{porcentaje}</code> <code>{monto}</code> <code>{enlace}</code> (el enlace abre la página con tu QR).</p>
            <button class="btn">Guardar cobro</button>
          </div>
        </div>
      </form>
      <form class="tarjeta" id="fcfg" style="grid-column:1/-1">
        <h2>Reglas de reserva</h2><p class="bajada">Se aplican al instante en la página pública.</p>
        <div class="fila">
          <label class="campo"><span>Pedido mínimo (raciones)</span><input type="number" name="pedido_minimo" value="${c.pedido_minimo}" min="1"></label>
          <label class="campo"><span>Showcooking incluido desde (raciones)</span><input type="number" name="showcooking_incluido_desde" value="${c.showcooking_incluido_desde}"></label>
        </div>
        <div class="fila">
          <label class="campo"><span>Costo de showcooking (Bs)</span><input type="number" name="costo_showcooking" value="${c.costo_showcooking}"></label>
          <label class="campo"><span>Anticipación mínima (horas)</span><input type="number" name="anticipacion_min_horas" value="${c.anticipacion_min_horas}"></label>
        </div>
        <div class="fila">
          <label class="campo"><span>Máximo de eventos por día</span><input type="number" name="eventos_max_por_dia" value="${c.eventos_max_por_dia}" min="1"></label>
          <label class="campo"><span>Máximo de raciones por día</span><input type="number" name="raciones_max_por_dia" value="${c.raciones_max_por_dia}" min="1"></label>
        </div>
        <div class="fila">
          <label class="campo"><span>Horarios ofrecidos (separados por coma)</span><input type="text" name="horarios" value="${(c.horarios || []).join(", ")}"></label>
          <label class="campo"><span>Duración del evento en calendario (min)</span><input type="number" name="duracion_evento_min" value="${c.duracion_evento_min}"></label>
        </div>
        <div class="fila">
          <label class="campo"><span>WhatsApp (con 591)</span><input type="text" name="whatsapp" value="${escapar(c.whatsapp)}"></label>
          <label class="campo"><span>Instagram</span><input type="text" name="instagram" value="${escapar(c.instagram)}"></label>
        </div>
        <button class="btn">Guardar ajustes</button>
      </form>
    </div>`;
  const copiar = async (t) => { try { await navigator.clipboard.writeText(t); toast("Copiado"); } catch { toast("Selecciona el enlace y cópialo"); } };
  $("#copiar-cal").onclick = () => copiar(url);
  $("#copiar-pub").onclick = () => copiar(publica);
  $("#regen")?.addEventListener("click", async () => {
    const t = [...crypto.getRandomValues(new Uint8Array(18))].map((b) => b.toString(16).padStart(2, "0")).join("");
    st.cfg = await datos.guardarConfig({ calendario_token: t });
    toast("Enlace nuevo generado: actualizalo en el iPhone"); vistaAjustes();
  });
  $("#fpersona").onsubmit = async (e) => {
    e.preventDefault(); const f = e.target;
    try {
      await datos.guardarPersona({ nombre: f.nombre.value.trim(), telefono: f.telefono.value.replace(/[^0-9+]/g, "") || null, activo: true });
      st.personal = await datos.personal(); toast("Agregado al equipo"); vistaAjustes();
    } catch (err) { toast("No se pudo guardar: " + err.message); }
  };
  $("#t-equipo").addEventListener("click", async (e) => {
    const b = e.target.closest("[data-toggle-persona]"); if (!b) return;
    const p = st.personal.find((x) => x.id === b.dataset.togglePersona);
    try { await datos.guardarPersona({ id: p.id, activo: !p.activo }); st.personal = await datos.personal(); vistaAjustes(); }
    catch (err) { toast("No se pudo guardar: " + err.message); }
  });
  let qrNuevo = null;
  $("#fqr").qr.onchange = (e) => {
    const a = e.target.files[0]; if (!a) return;
    if (a.size > 2 * 1024 * 1024) { toast("La imagen pesa más de 2 MB"); e.target.value = ""; return; }
    qrNuevo = a;
    const v = $("#qr-vista"); const img = document.createElement("img");
    img.id = "qr-vista"; img.alt = "Vista previa del QR"; img.src = URL.createObjectURL(a); v.replaceWith(img);
    toast("Vista previa lista: toca Guardar cobro");
  };
  $("#fqr").onsubmit = async (e) => {
    e.preventDefault(); const f = e.target; const b = $("button.btn", f);
    b.disabled = true; b.textContent = "Guardando…";
    try {
      const patch = {
        anticipo_porcentaje: Math.min(100, Math.max(1, Number(f.anticipo_porcentaje.value) || 50)),
        mensaje_anticipo: f.mensaje_anticipo.value.trim() || MENSAJE_ANTICIPO_BASE,
      };
      if (qrNuevo) patch.qr_url = await datos.subirQR(qrNuevo);
      st.cfg = await datos.guardarConfig(patch);
      qrNuevo = null; toast("Cobro guardado"); vistaAjustes();
    } catch (err) { toast("No se pudo guardar: " + err.message); b.disabled = false; b.textContent = "Guardar cobro"; }
  };
  $("#fcfg").onsubmit = async (e) => {
    e.preventDefault(); const f = e.target; const n = (k) => Number(f[k].value);
    st.cfg = await datos.guardarConfig({
      pedido_minimo: n("pedido_minimo"), showcooking_incluido_desde: n("showcooking_incluido_desde"), costo_showcooking: n("costo_showcooking"),
      anticipacion_min_horas: n("anticipacion_min_horas"), eventos_max_por_dia: n("eventos_max_por_dia"), raciones_max_por_dia: n("raciones_max_por_dia"),
      duracion_evento_min: n("duracion_evento_min"), whatsapp: f.whatsapp.value.replace(/\D/g, ""), instagram: f.instagram.value.replace("@", "").trim(),
      horarios: f.horarios.value.split(",").map((h) => h.trim()).filter((h) => /^\d{1,2}:\d{2}$/.test(h)).map((h) => h.padStart(5, "0")),
    });
    toast("Ajustes guardados");
  };
}

// ================================================================ CAJÓN (detalle / formularios)
function cajon(html) {
  const yaAbierto = !!$("#velo"); // si se reemplaza un cajón abierto, no se repite la animación de entrada
  const scrollPrevio = $("#velo .cajon")?.scrollTop || 0;      // ni se pierde la posición
  cerrarCajon();
  const v = document.createElement("div"); v.className = yaAbierto ? "velo sin-anim" : "velo"; v.id = "velo";
  v.innerHTML = `<div class="cajon"><button class="cerrar" aria-label="Cerrar">×</button>${html}</div>`;
  v.onclick = (e) => { if (e.target === v || e.target.matches(".cerrar")) cerrarCajon(); };
  document.body.appendChild(v); document.body.style.overflow = "hidden";
  if (yaAbierto) $(".cajon", v).scrollTop = scrollPrevio;
  return v;
}
function cerrarCajon() { $("#velo")?.remove(); document.body.style.overflow = ""; }
document.addEventListener("keydown", (e) => e.key === "Escape" && cerrarCajon());

function abrirReserva(id) {
  const r = st.reservas.find((x) => x.id === id); if (!r) return;
  const cli = r.clientes || {};
  const nombre1 = (cli.nombre || "").split(" ")[0];
  const items = (r.reserva_items || []).map((i) => `• ${i.raciones} × ${i.nombre}`).join("\n");
  const plantillas = {
    "Confirmar": `¡Hola ${nombre1}! 🥘 Te escribimos de Arrózame para confirmar tu reserva *${r.codigo}* del ${fechaLarga(r.fecha)} a las ${hhmm(r.hora)}.\n\n${items}\nTotal: ${bs(r.total)}\n\nPara asegurar la fecha te pedimos un anticipo del 50% (${bs(r.total / 2)}). ¿Te pasamos el QR?`,
    "Recordatorio": `¡Hola ${nombre1}! Te recordamos que ${r.fecha === sumarDias(hoyISO(), 1) ? "mañana" : "el " + fechaLarga(r.fecha)} a las ${hhmm(r.hora)} llevamos la Paella Experience 🥘 a ${r.direccion || "tu evento"}. ¿Todo en orden con el lugar?`,
    "Gracias": `¡Gracias ${nombre1} por elegir Arrózame! 🧡 Nos encantaría saber qué tal estuvo. Si te gustó, etiquétanos en Instagram @${st.cfg.instagram}.`,
  };
  const c = cajon(`
    <div class="small muted">Reserva</div>
    <h2 style="font-size:24px;margin-bottom:4px">${escapar(r.codigo)} ${chip(r.estado)}${r.evento_grande ? ` <span class="etiqueta grande">Evento grande</span>` : ""}</h2>
    <p class="muted" style="margin-top:0">${ORIGEN[r.origen] || r.origen} · creada ${new Date(r.created_at).toLocaleDateString("es-BO")}</p>

    <div class="bloque"><h4>Estado</h4><div class="estados">${ESTADOS.map((e) => `<button data-estado="${e}" class="${r.estado === e ? "activo" : ""}">${ETQ[e]}</button>`).join("")}</div></div>

    <div class="bloque anticipo"><h4>Anticipo</h4>
      <div class="linea"><span>Anticipo del ${pctAnticipo()}%</span><b>${bs(montoAnticipo(r))}</b></div>
      <div class="linea"><span>QR enviado</span><span id="qr-enviado">${r.qr_enviado_at ? fechaHora(r.qr_enviado_at) : "Todavía no"}</span></div>
      <div class="linea"><span>Anticipo pagado</span><span>${Number(r.anticipo) > 0 ? `${bs(r.anticipo)}${r.anticipo_pagado_at ? " · " + fechaHora(r.anticipo_pagado_at) : ""}` : "Pendiente"}</span></div>
      ${st.cfg?.qr_url
        ? `<a class="btn wa chico" id="enviar-qr" target="_blank" rel="noopener" href="https://wa.me/${telWa(cli.telefono)}?text=${encodeURIComponent(mensajeAnticipo(r, nombre1))}">WhatsApp · Enviar QR del anticipo</a>
           <a class="small enlace-qr" href="${escapar(urlPaginaQR(r))}" target="_blank" rel="noopener">Ver lo que recibe el cliente ↗</a>`
        : `<div class="aviso info" style="margin-bottom:0">Todavía no hay QR de cobro. <a href="#ajustes" id="ir-ajustes-qr">Súbelo en Ajustes</a> para poder enviarlo desde aquí.</div>`}
    </div>

    <div class="bloque"><h4>Cliente</h4>
      <div class="cli-datos">
        <div><div style="font-weight:700;font-size:16px">${escapar(cli.nombre)}</div>
          <div class="small"><a href="https://wa.me/${telWa(cli.telefono)}" target="_blank">${escapar(cli.telefono)}</a>${cli.email ? " · " + escapar(cli.email) : ""}</div></div>
        <button type="button" class="mini" id="editar-cli">Editar datos</button>
      </div>
      <form id="fcli" class="form-cli oculto">
        <div class="fila"><label class="campo"><span>Nombre</span><input type="text" name="nombre" value="${escapar(cli.nombre || "")}" required></label>
          <label class="campo"><span>WhatsApp</span><input type="tel" name="telefono" value="${escapar(cli.telefono || "")}" inputmode="tel" required></label></div>
        <label class="campo"><span>Email (opcional)</span><input type="email" name="email" value="${escapar(cli.email || "")}"></label>
        <p class="small muted" style="margin:-6px 0 10px">El cambio vale para todas las reservas de este cliente.</p>
        <div class="acciones-cli"><button class="btn chico">Guardar</button><button type="button" class="btn sec chico" id="cancelar-cli">Cancelar</button></div>
      </form>
      <div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:10px">${Object.entries(plantillas).map(([k, t]) => `<a class="btn wa chico" target="_blank" href="https://wa.me/${telWa(cli.telefono)}?text=${encodeURIComponent(t)}">WhatsApp · ${k}</a>`).join("")}</div>
    </div>

    <div class="bloque compra" id="bloque-compra"><h4>Equipo y compra</h4>
      ${st.personal.some((p) => p.activo)
        ? `<p class="small muted" style="margin:0 0 8px">¿Quiénes van a este evento?</p>
           <div class="equipo-chips">${st.personal.filter((p) => p.activo || (r.equipo || []).includes(p.id)).map((p) => `<label class="chip-check"><input type="checkbox" value="${p.id}" ${(r.equipo || []).includes(p.id) ? "checked" : ""}><span>${escapar(p.nombre)}</span></label>`).join("")}</div>`
        : `<div class="aviso info">Todavía no cargaste tu equipo. <a href="#ajustes" id="ir-ajustes-equipo">Agrégalo en Ajustes</a>.</div>`}
      <div class="estados compra-estado">${Object.entries(COMPRA).map(([k, t]) => `<button type="button" data-compra="${k}" class="${(r.compra_estado || "pendiente") === k ? "activo" : ""}">${t}</button>`).join("")}</div>
      <div class="linea"><span>Orden enviada</span><span>${r.orden_compra_enviada_at ? fechaHora(r.orden_compra_enviada_at) : "Todavía no"}</span></div>
      <div class="envios">${equipoDe(r).filter((p) => p.telefono).map((p) => `<a class="btn wa chico" data-enviar-orden target="_blank" rel="noopener" href="https://wa.me/${telWa(p.telefono)}?text=${encodeURIComponent(ordenCompra(r))}">WhatsApp · ${escapar(p.nombre.split(" ")[0])}</a>`).join("")
        || `<p class="small muted" style="margin:0">Elige quiénes van para enviarles la orden por WhatsApp.</p>`}</div>
      <button type="button" class="btn sec chico" id="copiar-orden">Copiar orden (para pegar en un grupo)</button>
    </div>

    <div class="bloque gastos"><h4>Gastos del evento</h4>
      ${(r.gastos || []).length
        ? `<div class="lista-gastos">${r.gastos.map((g) => `<div class="gasto">
            <span class="etiqueta registro gris">${CATEGORIAS[g.categoria] || g.categoria}</span>
            <span class="det">${escapar(g.descripcion || "")}</span>
            <b>${bs(g.monto)}</b>
            ${g.ticket_path ? `<button type="button" class="mini" data-ver-ticket="${escapar(g.ticket_path)}">Ticket</button>` : ""}
            <button type="button" class="mini borrar" data-borrar-gasto="${g.id}" aria-label="Borrar gasto de ${bs(g.monto)}">×</button></div>`).join("")}</div>`
        : `<p class="small muted" style="margin:0 0 8px">Todavía no hay gastos cargados.</p>`}
      <div class="resultado franja">
        <div class="linea"><span>Cobrado</span><span>${bs(r.total)}</span></div>
        <div class="linea"><span>Gastado</span><span>${bs(totalGastos(r))}</span></div>
        <div class="linea margen"><span>Margen</span><b>${bs(Number(r.total) - totalGastos(r))}${Number(r.total) && totalGastos(r) ? ` · ${Math.round(((Number(r.total) - totalGastos(r)) / Number(r.total)) * 100)}%` : ""}</b></div>
      </div>
      <form id="fg" class="form-gasto">
        <div class="fila"><label class="campo"><span>Categoría</span><select name="categoria">${Object.entries(CATEGORIAS).map(([k, t]) => `<option value="${k}">${t}</option>`).join("")}</select></label>
          <label class="campo"><span>Monto (Bs)</span><input type="number" name="monto" min="0" step="0.5" inputmode="decimal" required></label></div>
        <label class="campo"><span>Detalle (opcional)</span><input type="text" name="descripcion" placeholder="Ej. mercado Abasto, garrafa, flete"></label>
        <label class="btn sec chico ticket-subir"><input type="file" name="ticket" accept="image/*,application/pdf"><span id="ticket-nombre">Adjuntar foto del ticket</span></label>
        <button class="btn chico">Agregar gasto</button>
      </form>
    </div>

    <form id="fr">
    <div class="bloque"><h4>Evento</h4>
      <div class="fila"><label class="campo"><span>Fecha</span><input type="date" name="fecha" value="${r.fecha}"></label>
        <label class="campo"><span>Hora</span><input type="time" name="hora" value="${hhmm(r.hora)}"></label></div>
      <div class="fila"><label class="campo"><span>Tipo</span><input type="text" name="tipo_evento" value="${escapar(r.tipo_evento || "")}"></label>
        <label class="campo"><span>Invitados</span><input type="number" name="invitados" value="${r.invitados || ""}"></label></div>
      <label class="campo"><span>Dirección</span><input type="text" name="direccion" value="${escapar(r.direccion || "")}"></label>
      <label class="campo" style="margin:0"><span>Zona</span><input type="text" name="zona" value="${escapar(r.zona || "")}"></label>
      ${r.direccion ? `<a class="small" target="_blank" href="https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(r.direccion + ", " + (r.zona || "") + ", Santa Cruz, Bolivia")}">Abrir en Google Maps ↗</a>` : ""}
    </div>

    <div class="bloque"><h4>Pedido</h4>
      ${(r.reserva_items || []).map((i) => `<div class="linea"><span>${i.raciones} × ${escapar(i.nombre)} <span class="small muted">(${bs(i.precio_unit)})</span></span><span>${bs(i.subtotal ?? i.raciones * i.precio_unit)}</span></div>`).join("")}
      <div class="linea"><span>Showcooking</span><span>${r.showcooking ? (Number(r.costo_showcooking) ? bs(r.costo_showcooking) : "Incluido") : "No"}</span></div>
      <div class="fila" style="margin-top:10px"><label class="campo"><span>Descuento (Bs)</span><input type="number" name="descuento" value="${Number(r.descuento || 0)}" min="0"></label>
        <label class="campo"><span>Anticipo recibido (Bs)</span><input type="number" name="anticipo" value="${Number(r.anticipo || 0)}" min="0"></label></div>
      <div class="linea" style="font-family:var(--f-titulo);font-weight:800;font-size:18px"><span>Total</span><span id="tot">${bs(r.total)}</span></div>
      <div class="linea"><span>Saldo por cobrar</span><span id="sal">${bs(saldo(r))}</span></div>
    </div>

    <div class="bloque"><h4>Notas</h4>
      ${r.notas_cliente ? `<p class="small" style="margin-top:0"><b>Del cliente:</b> ${escapar(r.notas_cliente)}</p>` : ""}
      <label class="campo" style="margin:0"><span>Notas internas (solo tú las ves)</span><textarea name="notas_internas">${escapar(r.notas_internas || "")}</textarea></label>
    </div>
    <button class="btn" style="width:100%">Guardar cambios</button>
    </form>`);

  const f = $("#fr", c);
  const recalcular = () => {
    const total = Number(r.subtotal) + Number(r.costo_showcooking || 0) - Number(f.descuento.value || 0);
    $("#tot", c).textContent = bs(total); $("#sal", c).textContent = bs(Math.max(0, total - Number(f.anticipo.value || 0)));
    return total;
  };
  f.oninput = recalcular;
  // editar nombre / WhatsApp / email del cliente
  const fcli = $("#fcli", c);
  $("#editar-cli", c).onclick = () => { fcli.classList.remove("oculto"); $("#editar-cli", c).classList.add("oculto"); fcli.telefono.focus(); };
  $("#cancelar-cli", c).onclick = () => { fcli.classList.add("oculto"); $("#editar-cli", c).classList.remove("oculto"); };
  fcli.onsubmit = async (e) => {
    e.preventDefault();
    const tel = fcli.telefono.value.replace(/[^0-9+]/g, "");
    if (tel.replace(/\D/g, "").length < 7) return toast("El WhatsApp debe tener al menos 7 dígitos");
    const patch = { nombre: fcli.nombre.value.trim(), telefono: tel, email: fcli.email.value.trim() || null };
    if (!patch.nombre) return toast("El nombre no puede quedar vacío");
    try {
      await datos.actualizarCliente(cli.id, patch);
      st.reservas.forEach((x) => { if (x.clientes?.id === cli.id) x.clientes = { ...x.clientes, ...patch }; });
      toast("Datos del cliente actualizados"); pintar(); abrirReserva(r.id);
    } catch (err) {
      toast(/duplicate|unique|telefono/i.test(err.message) ? "Ese número ya está registrado para otro cliente" : "No se pudo guardar: " + err.message);
    }
  };
  $("#enviar-qr", c)?.addEventListener("click", async () => {
    // se abre WhatsApp (enlace normal) y en paralelo queda registrado el envío
    try { await guardarReserva(r, { qr_enviado_at: new Date().toISOString() }); $("#qr-enviado", c).textContent = fechaHora(new Date().toISOString()); } catch {}
  });
  $("#ir-ajustes-qr", c)?.addEventListener("click", (e) => { e.preventDefault(); cerrarCajon(); ir("ajustes"); });
  $("#ir-ajustes-equipo", c)?.addEventListener("click", (e) => { e.preventDefault(); cerrarCajon(); ir("ajustes"); });
  // equipo del evento
  $$(".equipo-chips input", c).forEach((i) => i.addEventListener("change", async () => {
    await guardarReserva(r, { equipo: $$(".equipo-chips input:checked", c).map((x) => x.value) }); abrirReserva(r.id);
  }));
  // estado de la compra
  $(".compra-estado", c).onclick = async (e) => {
    const b = e.target.closest("[data-compra]"); if (!b) return;
    await guardarReserva(r, { compra_estado: b.dataset.compra }); toast(COMPRA[b.dataset.compra]); abrirReserva(r.id);
  };
  // envío de la orden: queda registrado
  const registrarOrden = async () => {
    const patch = { orden_compra_enviada_at: new Date().toISOString() };
    if ((r.compra_estado || "pendiente") === "pendiente") patch.compra_estado = "pedida";
    await guardarReserva(r, patch); abrirReserva(r.id);
  };
  $$("[data-enviar-orden]", c).forEach((a) => a.addEventListener("click", () => { registrarOrden().catch(() => {}); }));
  $("#copiar-orden", c).onclick = async () => {
    try { await navigator.clipboard.writeText(ordenCompra(r)); toast("Orden copiada: pégala en el grupo"); await registrarOrden(); }
    catch { toast("No se pudo copiar"); }
  };
  // gastos
  const fg = $("#fg", c);
  fg.ticket.onchange = () => { $("#ticket-nombre", c).textContent = fg.ticket.files[0] ? "Ticket: " + fg.ticket.files[0].name : "Adjuntar foto del ticket"; };
  fg.onsubmit = async (e) => {
    e.preventDefault(); const b = $("button.btn:not(.sec)", fg); b.disabled = true; b.textContent = "Guardando…";
    try {
      const archivo = fg.ticket.files[0];
      if (archivo && archivo.size > 5 * 1024 * 1024) throw new Error("el ticket pesa más de 5 MB");
      const ticket_path = archivo ? await datos.subirTicket(archivo, r.id) : null;
      const g = await datos.agregarGasto({ reserva_id: r.id, categoria: fg.categoria.value, monto: Number(fg.monto.value), descripcion: fg.descripcion.value.trim() || null, ticket_path });
      const rr = st.reservas.find((x) => x.id === r.id); rr.gastos = [...(rr.gastos || []), g];
      if (g.categoria === "ingredientes" && (r.compra_estado || "pendiente") !== "comprada") await guardarReserva(rr, { compra_estado: "comprada" });
      else pintar();
      toast("Gasto agregado"); abrirReserva(r.id);
    } catch (err) { toast("No se pudo guardar: " + err.message); b.disabled = false; b.textContent = "Agregar gasto"; }
  };
  $(".gastos", c).addEventListener("click", async (e) => {
    const ver = e.target.closest("[data-ver-ticket]");
    if (ver) {
      const w = window.open("", "_blank");
      try {
        const url = await datos.urlTicket(ver.dataset.verTicket);
        if (url.startsWith("data:")) { w.document.title = "Ticket"; w.document.body.style.margin = "0"; const img = w.document.createElement("img"); img.src = url; img.style.maxWidth = "100%"; w.document.body.appendChild(img); }
        else w.location.href = url;
      } catch (err) { w?.close(); toast("No se pudo abrir el ticket"); }
      return;
    }
    const borrar = e.target.closest("[data-borrar-gasto]");
    if (borrar) {
      const g = (r.gastos || []).find((x) => x.id === borrar.dataset.borrarGasto); if (!g) return;
      if (!confirm(`¿Borrar el gasto de ${bs(g.monto)} (${CATEGORIAS[g.categoria]})?`)) return;
      try {
        await datos.borrarGasto(g);
        const rr = st.reservas.find((x) => x.id === r.id); rr.gastos = (rr.gastos || []).filter((x) => x.id !== g.id);
        pintar(); toast("Gasto borrado"); abrirReserva(r.id);
      } catch (err) { toast("No se pudo borrar: " + err.message); }
    }
  });
  $(".estados", c).onclick = async (e) => {
    const b = e.target.closest("[data-estado]"); if (!b) return;
    await guardarReserva(r, { estado: b.dataset.estado }); toast("Estado: " + ETQ[b.dataset.estado]); abrirReserva(r.id);
    const nueva = st.reservas.find((x) => x.id === r.id);
    if (b.dataset.estado === "confirmada" && (nueva?.compra_estado || "pendiente") === "pendiente") {
      const bloque = $("#bloque-compra"); bloque?.classList.add("resaltar"); bloque?.scrollIntoView({ behavior: "smooth", block: "start" });
      toast("Confirmada · ahora envía la orden de compra al equipo");
    }
  };
  f.onsubmit = async (e) => {
    e.preventDefault();
    await guardarReserva(r, {
      fecha: f.fecha.value, hora: f.hora.value, tipo_evento: f.tipo_evento.value, invitados: parseInt(f.invitados.value) || null,
      direccion: f.direccion.value, zona: f.zona.value, descuento: Number(f.descuento.value || 0), anticipo: Number(f.anticipo.value || 0),
      total: recalcular(), notas_internas: f.notas_internas.value,
      // registro: cuándo se cargó el pago del anticipo
      anticipo_pagado_at: Number(f.anticipo.value || 0) > 0 ? (r.anticipo_pagado_at || new Date().toISOString()) : null,
    });
    cerrarCajon(); toast("Reserva actualizada");
  };
}
async function guardarReserva(r, patch) {
  try {
    const nueva = await datos.actualizarReserva(r.id, patch);
    st.reservas[st.reservas.findIndex((x) => x.id === r.id)] = nueva;
    pintar();
  } catch (err) { toast("No se pudo guardar: " + err.message); throw err; }
}

// ---------------------------------------------------------------- nueva reserva manual
function nuevaReserva() {
  const activos = st.productos.filter((p) => p.activo);
  const opciones = activos.map((p) => `<option value="${p.id}">${escapar(p.nombre)} · ${bs(p.precio_bs)}</option>`).join("");
  const filaItem = () => `<div class="item-fila"><select name="prod">${opciones}</select><input type="number" name="rac" value="6" min="1" aria-label="Raciones"><button type="button" data-quitar aria-label="Quitar">×</button></div>`;
  const c = cajon(`
    <h2>Nueva reserva</h2>
    <p class="muted small" style="margin-top:0">Para pedidos que entran por WhatsApp, Instagram o en persona. Queda todo en el mismo registro.</p>
    <form id="fn">
      <div class="bloque"><h4>Cliente</h4>
        <div class="fila"><label class="campo"><span>Nombre *</span><input type="text" name="nombre" required></label>
          <label class="campo"><span>WhatsApp *</span><input type="tel" name="telefono" required></label></div>
        <label class="campo" style="margin:0"><span>¿Por dónde llegó?</span><select name="origen"><option value="whatsapp">WhatsApp</option><option value="instagram">Instagram</option><option value="manual">En persona / teléfono</option><option value="otro">Otro</option></select></label>
      </div>
      <div class="bloque"><h4>Evento</h4>
        <div class="fila"><label class="campo"><span>Fecha *</span><input type="date" name="fecha" required min="${hoyISO()}"></label>
          <label class="campo"><span>Hora *</span><input type="time" name="hora" required value="13:00"></label></div>
        <div class="fila"><label class="campo"><span>Tipo</span><input type="text" name="tipo_evento" placeholder="Cumpleaños, corporativo…"></label>
          <label class="campo"><span>Invitados</span><input type="number" name="invitados"></label></div>
        <div class="fila"><label class="campo"><span>Dirección</span><input type="text" name="direccion"></label>
          <label class="campo"><span>Zona</span><input type="text" name="zona"></label></div>
      </div>
      <div class="bloque"><h4>Paellas</h4><div id="items">${filaItem()}</div>
        <button type="button" class="btn sec chico" id="mas-item">+ Otra paella</button>
        <label style="display:flex;gap:8px;align-items:center;margin-top:12px"><input type="checkbox" name="showcooking" style="width:18px;height:18px;accent-color:var(--terracota)"> Con showcooking</label>
        <div class="linea" style="font-weight:800;font-family:var(--f-titulo);margin-top:8px"><span>Total estimado</span><span id="est">—</span></div>
      </div>
      <label class="campo"><span>Notas</span><textarea name="notas"></textarea></label>
      <div class="aviso error oculto" id="err-n"></div>
      <button class="btn" style="width:100%">Crear reserva</button>
    </form>`);
  const f = $("#fn", c);
  const leerItems = () => $$(".item-fila", c).map((d) => ({ producto_id: $("select", d).value, raciones: parseInt($("input", d).value) || 0 })).filter((i) => i.raciones > 0);
  const estimar = () => {
    const its = leerItems(); const rac = its.reduce((a, i) => a + i.raciones, 0);
    const sub = its.reduce((a, i) => a + i.raciones * (st.productos.find((p) => p.id === i.producto_id)?.precio_bs || 0), 0);
    const show = f.showcooking.checked && rac < st.cfg.showcooking_incluido_desde ? Number(st.cfg.costo_showcooking) : 0;
    $("#est", c).textContent = `${rac} rac · ${bs(sub + show)}`;
  };
  $("#mas-item", c).onclick = () => { $("#items", c).insertAdjacentHTML("beforeend", filaItem()); estimar(); };
  $("#items", c).onclick = (e) => { if (e.target.matches("[data-quitar]") && $$(".item-fila", c).length > 1) { e.target.parentElement.remove(); estimar(); } };
  f.oninput = estimar; estimar();
  f.onsubmit = async (e) => {
    e.preventDefault(); $("#err-n", c).classList.add("oculto");
    try {
      const r = await datos.crearReserva({
        nombre: f.nombre.value, telefono: f.telefono.value, fecha: f.fecha.value, hora: f.hora.value, tipo_evento: f.tipo_evento.value,
        invitados: parseInt(f.invitados.value) || null, direccion: f.direccion.value, zona: f.zona.value, showcooking: f.showcooking.checked,
        notas: f.notas.value, items: leerItems(), origen: f.origen.value,
      });
      await recargar(); cerrarCajon(); toast(`Reserva ${r.codigo} creada`); pintar();
    } catch (err) { $("#err-n", c).textContent = err.message; $("#err-n", c).classList.remove("oculto"); }
  };
}

const VISTAS = { agenda: vistaAgenda, calendario: vistaCalendario, estadisticas: vistaEstadisticas, clientes: () => vistaClientes(), carta: vistaCarta, ajustes: vistaAjustes };
iniciar();
