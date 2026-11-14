// Arrózame · Página pública de reservas
import { datos, modoDemo, hoyISO, sumarDias, bs, fechaLarga, escapar } from "./datos.js";

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];

const estado = {
  paso: 1, cfg: null, productos: [], cantidades: {}, fecha: null, hora: null,
  mes: hoyISO().slice(0, 7), disp: {}, horasTomadas: [], enviando: false,
};

// ---------------------------------------------------------------- cálculos
function calculo() {
  const c = estado.cfg || { pedido_minimo: 6, showcooking_incluido_desde: 20, costo_showcooking: 500 };
  const lineas = estado.productos.filter((p) => estado.cantidades[p.id] > 0)
    .map((p) => ({ p, n: estado.cantidades[p.id], sub: estado.cantidades[p.id] * p.precio_bs }));
  const raciones = lineas.reduce((a, l) => a + l.n, 0);
  const subtotal = lineas.reduce((a, l) => a + l.sub, 0);
  const showIncluido = raciones >= c.showcooking_incluido_desde;
  const quiereShow = !!$("#form-datos [name=showcooking]")?.checked;
  const costoShow = !showIncluido && quiereShow ? Number(c.costo_showcooking) : 0;
  return { lineas, raciones, subtotal, showIncluido, quiereShow: showIncluido || quiereShow, costoShow, total: subtotal + costoShow, minimo: c.pedido_minimo };
}

// ---------------------------------------------------------------- carta
function pintarCarta() {
  // [categoría, título, bajada, foto del capítulo (solo diseño)]
  const grupos = [
    ["tradicional", "Arrocería tradicional española", "La tradición y técnica española", ["paella-marisco-700.webp", "Paella de marisco con mejillones y gambas"]],
    ["autor", "Arrocería boliviana de autor", "Con sabores bolivianos", ["paella-costilla-900.webp", "Paella de costilla de res con romero en la paellera"]],
    ["extra", "Extras", "", null],
  ];
  $("#carta").innerHTML = grupos.map(([cat, titulo, sub, foto]) => {
    const ps = estado.productos.filter((p) => p.categoria === cat);
    if (!ps.length) return "";
    const cab = foto
      ? `<div class="capitulo"><img src="img/${foto[0]}" alt="${foto[1]}" loading="lazy"><div class="cap-txt"><h2>${titulo}</h2>${sub ? `<span>${sub}</span>` : ""}</div></div>`
      : `<div class="grupo-titulo"><h2>${titulo}</h2>${sub ? `<span>${sub}</span>` : ""}</div>`;
    return cab + ps.map((p) => `
      <div class="plato ${estado.cantidades[p.id] ? "elegido" : ""}" data-id="${p.id}">
        <div class="plato-txt">
          <h3>${escapar(p.nombre)}</h3>
          <div class="ing">${escapar(p.ingredientes || "")}</div>
          ${p.descripcion ? `<div class="desc">${escapar(p.descripcion)}</div>` : ""}
        </div>
        <div class="der">
          <div class="precio">${bs(p.precio_bs)} <span>por ración</span></div>
          <button type="button" class="agregar" data-mas aria-label="Agregar ${escapar(p.nombre)}">Agregar</button>
          <div class="contador">
            <button type="button" data-menos aria-label="Quitar ración">−</button>
            <input type="number" min="0" inputmode="numeric" value="${estado.cantidades[p.id] || 0}" aria-label="Raciones de ${escapar(p.nombre)}">
            <button type="button" data-mas aria-label="Sumar ración">+</button>
          </div>
          <div class="rapidos" aria-label="Cantidades rápidas">${[...new Set([minimoPorPaella(), 10, 20].filter((n) => n >= minimoPorPaella()))].map((n) => `<button type="button" data-fijar="${n}" aria-label="${n} raciones">${n}</button>`).join("")}</div>
        </div>
      </div>`).join("");
  }).join("");
}

$("#carta").addEventListener("click", (e) => {
  const fila = e.target.closest(".plato"); if (!fila) return;
  const id = fila.dataset.id; let n = estado.cantidades[id] || 0;
  // Cada paella va de 0 (no elegida) al mínimo de raciones o más; nunca entre medio.
  const min = minimoPorPaella();
  if (e.target.matches("[data-mas]")) n = n === 0 ? min : n + 1;
  else if (e.target.matches("[data-menos]")) n = n <= min ? 0 : n - 1;
  else if (e.target.dataset.fijar) n = Number(e.target.dataset.fijar);
  else return;
  fijarCantidad(fila, id, n);
});
$("#carta").addEventListener("input", (e) => {
  const fila = e.target.closest(".plato"); if (!fila || e.target.tagName !== "INPUT") return;
  fijarCantidad(fila, fila.dataset.id, Math.max(0, parseInt(e.target.value) || 0), false);
});
// al terminar de escribir, una cantidad por debajo del mínimo sube al mínimo
$("#carta").addEventListener("change", (e) => {
  const fila = e.target.closest(".plato"); if (!fila || e.target.tagName !== "INPUT") return;
  const n = Math.max(0, parseInt(e.target.value) || 0);
  fijarCantidad(fila, fila.dataset.id, n > 0 && n < minimoPorPaella() ? minimoPorPaella() : n);
});
const minimoPorPaella = () => Math.max(1, Number(estado.cfg?.pedido_minimo) || 1);
function fijarCantidad(fila, id, n, reescribir = true) {
  estado.cantidades[id] = Math.min(n, 500);
  if (reescribir) $("input", fila).value = estado.cantidades[id];
  fila.classList.toggle("elegido", estado.cantidades[id] > 0);
  const menos = $("[data-menos]", fila);
  if (menos) menos.setAttribute("aria-label", estado.cantidades[id] <= minimoPorPaella() ? "Quitar esta paella" : "Quitar ración");
  actualizar();
}

// ---------------------------------------------------------------- calendario
async function pintarCalendario() {
  const [y, m] = estado.mes.split("-").map(Number);
  const primero = `${estado.mes}-01`;
  const diasMes = new Date(y, m, 0).getDate();
  const ultimo = `${estado.mes}-${String(diasMes).padStart(2, "0")}`;
  const hoy = hoyISO();
  const minimo = new Date(Date.now() + estado.cfg.anticipacion_min_horas * 36e5);
  const minISO = new Date(minimo.getTime() - minimo.getTimezoneOffset() * 6e4).toISOString().slice(0, 10);

  if (!estado.disp[estado.mes]) {
    const lista = await datos.disponibilidad(primero, ultimo);
    estado.disp[estado.mes] = Object.fromEntries(lista.map((d) => [d.fecha, d]));
  }
  const disp = estado.disp[estado.mes];
  const offset = (new Date(y, m - 1, 1).getDay() + 6) % 7; // lunes primero
  const nombreMes = (([a, ...r]) => a.toUpperCase() + r.join(""))(new Date(y, m - 1, 1).toLocaleDateString("es-BO", { month: "long", year: "numeric" }).replace(" De ", " de "));
  const puedeAtras = estado.mes > hoy.slice(0, 7);

  let celdas = ["Lu", "Ma", "Mi", "Ju", "Vi", "Sá", "Do"].map((d) => `<div class="dow">${d}</div>`).join("");
  celdas += "<div></div>".repeat(offset);
  for (let d = 1; d <= diasMes; d++) {
    const f = `${estado.mes}-${String(d).padStart(2, "0")}`;
    const info = disp[f] || {};
    const pasado = f < minISO;
    const lleno = info.lleno || info.bloqueado;
    const libres = Math.max(0, (estado.cfg.eventos_max_por_dia || 2) - (info.eventos || 0));
    // el pedido no entra ese día: un evento grande necesita el día libre; uno normal, que alcancen las raciones
    const grande = excedeCapacidad();
    const sinCupo = !pasado && !lleno && (grande ? (info.eventos || 0) > 0 : (info.raciones || 0) + calculo().raciones > maxRacionesDia());
    const nota = pasado ? "" : lleno ? "agenda llena" : sinCupo ? "sin cupo" : libres === 1 ? "1 cupo libre" : "";
    const titulo = pasado ? "" : lleno ? "Agenda llena" : sinCupo ? (grande ? "Un evento grande necesita el día libre" : "No entra tu pedido ese día") : libres === 1 ? "Queda 1 cupo libre" : "Disponible";
    celdas += `<button type="button" class="dia ${f === estado.fecha ? "sel" : ""} ${lleno || sinCupo ? "lleno" : ""} ${libres === 1 && !lleno && !sinCupo ? "ultimo" : ""}" data-fecha="${f}" ${pasado || lleno || sinCupo ? "disabled" : ""} ${titulo ? `title="${titulo}" aria-label="${d}, ${titulo}"` : ""}>${d}${nota ? `<small>${nota}</small>` : ""}</button>`;
  }
  $("#cal").innerHTML = `
    <div class="cal-cab">
      <button type="button" data-mes="-1" ${puedeAtras ? "" : "disabled style='opacity:.3'"} aria-label="Mes anterior">‹</button>
      <h2>${nombreMes}</h2>
      <button type="button" data-mes="1" aria-label="Mes siguiente">›</button>
    </div>
    <div class="cal-grid">${celdas}</div>
    <p class="cal-leyenda"><span class="punto"></span>1 cupo libre <span class="gris"></span>Agenda llena</p>
    <p class="small muted cal-nota">Reservas web con al menos ${estado.cfg.anticipacion_min_horas} h de anticipación. ¿Es para antes? <a class="enlace" href="${waConPedido("Quiero reservar con menos de " + estado.cfg.anticipacion_min_horas + " h de anticipación:")}" target="_blank" rel="noopener">Escríbenos por WhatsApp</a></p>`;
}
$("#cal").addEventListener("click", async (e) => {
  const b = e.target.closest("button"); if (!b || b.disabled) return;
  if (b.dataset.mes) {
    const [y, m] = estado.mes.split("-").map(Number);
    const d = new Date(y, m - 1 + Number(b.dataset.mes), 1);
    estado.mes = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    return pintarCalendario();
  }
  if (b.dataset.fecha) {
    estado.fecha = b.dataset.fecha; estado.hora = null;
    await pintarCalendario();
    estado.horasTomadas = await datos.horasOcupadas(estado.fecha);
    pintarHoras(); actualizar();
  }
});
function pintarHoras() {
  $("#bloque-horas").classList.remove("oculto");
  const minimo = Date.now() + estado.cfg.anticipacion_min_horas * 36e5;
  $("#horas").innerHTML = estado.cfg.horarios.map((h) => {
    const tomado = estado.horasTomadas.includes(h) || new Date(`${estado.fecha}T${h}`).getTime() < minimo;
    return `<button type="button" class="hora ${h === estado.hora ? "sel" : ""}" data-hora="${h}" ${tomado ? "disabled" : ""}>${h}</button>`;
  }).join("");
}
$("#horas").addEventListener("click", (e) => {
  const b = e.target.closest("[data-hora]"); if (!b || b.disabled) return;
  estado.hora = b.dataset.hora; pintarHoras(); actualizar();
});

// ---------------------------------------------------------------- capacidad y WhatsApp
const maxRacionesDia = () => Number(estado.cfg?.raciones_max_por_dia) || Infinity;
// evento grande: supera las raciones de un día normal; se reserva igual, ocupa el día completo y se confirma por WhatsApp
const excedeCapacidad = () => calculo().raciones > maxRacionesDia();
function waConPedido(motivo) {
  const c = calculo();
  const lineas = c.lineas.map((l) => `• ${l.n} × ${l.p.nombre}`).join("\n");
  const cuando = estado.fecha ? `\nFecha: ${fechaLarga(estado.fecha)}${estado.hora ? " · " + estado.hora : ""}` : "";
  const texto = `¡Hola Arrózame! ${motivo}${lineas ? "\n\n" + lineas + `\nTotal: ${c.raciones} raciones` : ""}${cuando}`;
  return `https://wa.me/${estado.cfg?.whatsapp || "59171293297"}?text=${encodeURIComponent(texto)}`;
}

// ---------------------------------------------------------------- resumen y navegación
function puedeSeguir() {
  const c = calculo();
  if (estado.paso === 1) return c.raciones >= c.minimo;
  if (estado.paso === 2) return !!(estado.fecha && estado.hora);
  if (estado.paso === 3) { const f = $("#form-datos"); return f.nombre.value.trim() && f.telefono.value.replace(/\D/g, "").length >= 7; }
  return false;
}

function actualizar() {
  const c = calculo();
  const falta = Math.max(0, c.minimo - c.raciones);
  $("#resumen").innerHTML = `
    <h2>Tu pedido</h2>
    ${c.lineas.length ? c.lineas.map((l) => `<div class="res-linea"><span>${l.n} × ${escapar(l.p.nombre)}</span><span>${bs(l.sub)}</span></div>`).join("")
      : `<p class="small muted">Todavía no elegiste paellas.</p>`}
    <div class="barra-min"><div style="width:${Math.min(100, (c.raciones / c.minimo) * 100)}%"></div></div>
    <div class="small ${falta ? "muted" : ""}" style="${falta ? "" : "color:var(--ok);font-weight:600"}">
      ${falta ? `Faltan ${falta} raciones para el mínimo` : `<span class="etiqueta oliva">${c.raciones} raciones</span>`}</div>
    ${c.raciones ? `<div class="res-linea" style="margin-top:6px"><span>Showcooking</span><span>${c.showIncluido ? `<span class="etiqueta oliva">Incluido</span>` : c.quiereShow ? bs(c.costoShow) : "—"}</span></div>` : ""}
    ${!c.showIncluido && c.raciones ? `<div class="small muted">Showcooking incluido desde ${estado.cfg.showcooking_incluido_desde} raciones</div>` : ""}
    ${estado.fecha ? `<div class="res-linea" style="margin-top:10px"><span>${fechaLarga(estado.fecha)}</span><span>${estado.hora || ""}</span></div>` : ""}
    <div class="res-total"><span>Total</span><span>${bs(c.total)}</span></div>
    <p class="small muted" style="margin:8px 0 0">Precio por ración personal. Te confirmamos por WhatsApp.</p>`;

  $("#bm-total").textContent = bs(c.total);
  $("#bm-detalle").textContent = falta ? `${c.raciones} raciones · faltan ${falta}` : `${c.raciones} raciones${estado.fecha ? " · " + estado.fecha.slice(8) + "/" + estado.fecha.slice(5, 7) : ""}`;

  const txtShow = $("#txt-show"), chk = $("#form-datos [name=showcooking]");
  if (c.showIncluido) { chk.checked = true; chk.disabled = true; txtShow.textContent = "¡Incluido en tu pedido por superar las " + estado.cfg.showcooking_incluido_desde + " raciones!"; }
  else { chk.disabled = false; txtShow.textContent = `Cocinamos la paella frente a tus invitados (+${bs(estado.cfg.costo_showcooking)}).`; }

  const aviso = $("#aviso-grande");
  if (estado.paso === 1 && excedeCapacidad()) {
    aviso.innerHTML = `<b>Es un evento grande: ${c.raciones} raciones.</b> Puedes reservarlo igual por aquí. Un evento así ocupa el día completo, así que verás solo los días libres, y te lo confirmaremos por WhatsApp. <a class="enlace" href="${waConPedido("Quiero consultar por un evento grande:")}" target="_blank" rel="noopener">¿Prefieres hablarlo antes? Escríbenos</a>`;
    aviso.classList.remove("oculto");
  } else aviso.classList.add("oculto");
  const sigTxt = estado.paso === 3 ? (estado.enviando ? "Enviando…" : excedeCapacidad() ? "Enviar solicitud" : "Confirmar reserva") : "Continuar →";
  for (const b of [$("#btn-seguir"), $("#bm-seguir")]) { b.disabled = !puedeSeguir() || estado.enviando; b.textContent = sigTxt; }
  $("#btn-atras").style.visibility = estado.paso > 1 ? "visible" : "hidden";
  $("#bm-atras").style.display = estado.paso > 1 ? "" : "none"; // en el celular no ocupa lugar en el paso 1
  $$("#pasos button").forEach((b) => {
    const n = Number(b.dataset.paso);
    b.classList.toggle("activo", n === estado.paso);
    b.disabled = n > estado.paso && !(n === estado.paso + 1 && puedeSeguir());
  });
}

async function irA(n) {
  estado.paso = n;
  $$("[data-vista]").forEach((v) => v.classList.toggle("oculto", Number(v.dataset.vista) !== n));
  if (n === 2) await pintarCalendario();
  actualizar();
  $("#flujo").scrollIntoView({ behavior: "smooth", block: "start" });
}

async function seguir() {
  if (!puedeSeguir()) return;
  if (estado.paso < 3) return irA(estado.paso + 1);
  await enviar();
}
const atras = () => estado.paso > 1 && irA(estado.paso - 1);
$("#btn-seguir").onclick = seguir; $("#bm-seguir").onclick = seguir;
$("#btn-atras").onclick = atras; $("#bm-atras").onclick = atras;
$("#pasos").onclick = (e) => { const b = e.target.closest("button"); if (b && !b.disabled) { const n = Number(b.dataset.paso); n < estado.paso ? irA(n) : n === estado.paso + 1 && seguir(); } };
$("#form-datos").addEventListener("input", actualizar);

// ---------------------------------------------------------------- ubicación (Google Maps, sin API key)
const consultaMapa = () => {
  const f = $("#form-datos");
  return [f.direccion.value.trim(), f.zona.value.trim(), "Santa Cruz de la Sierra, Bolivia"].filter(Boolean).join(", ");
};
function pintarMapa() {
  const f = $("#form-datos"); const q = consultaMapa();
  $("#link-maps").href = "https://www.google.com/maps/search/?api=1&query=" + encodeURIComponent(q);
  if (f.direccion.value.trim().length < 4) return $("#mapa").classList.add("oculto");
  const src = "https://maps.google.com/maps?q=" + encodeURIComponent(q) + "&z=16&output=embed";
  if ($("#mapa-iframe").getAttribute("src") !== src) $("#mapa-iframe").src = src;
  $("#mapa").classList.remove("oculto");
}
let tMapa;
for (const n of ["direccion", "zona"]) $(`#form-datos [name=${n}]`).addEventListener("input", () => { clearTimeout(tMapa); tMapa = setTimeout(pintarMapa, 700); });
$("#btn-mi-ubicacion").onclick = () => {
  const msg = $("#ubicacion-msg"); const b = $("#btn-mi-ubicacion");
  const avisar = (t) => { msg.textContent = t; msg.classList.remove("oculto"); };
  if (!navigator.geolocation) return avisar("Tu navegador no permite compartir la ubicación. Escribe la dirección o búscala en Google Maps.");
  b.disabled = true; b.textContent = "Buscando…";
  navigator.geolocation.getCurrentPosition((pos) => {
    const { latitude: la, longitude: lo } = pos.coords;
    const f = $("#form-datos");
    f.direccion.value = `${la.toFixed(6)}, ${lo.toFixed(6)}`;
    f.direccion.dispatchEvent(new Event("input", { bubbles: true }));
    pintarMapa();
    avisar("Listo: usamos tu ubicación actual. Revisa el mapa y añade referencias (condominio, casa) en la zona o en las notas.");
    b.disabled = false; b.textContent = "Usar mi ubicación";
  }, () => {
    avisar("No pudimos obtener tu ubicación. Escribe la dirección o búscala en Google Maps.");
    b.disabled = false; b.textContent = "Usar mi ubicación";
  }, { enableHighAccuracy: true, timeout: 12000 });
};
$("#form-datos").addEventListener("submit", (e) => { e.preventDefault(); seguir(); });

// ---------------------------------------------------------------- envío
async function enviar() {
  const f = $("#form-datos"); const c = calculo();
  estado.enviando = true; $("#error-envio").classList.add("oculto"); actualizar();
  try {
    const r = await datos.crearReserva({
      nombre: f.nombre.value, telefono: f.telefono.value, email: f.email.value,
      fecha: estado.fecha, hora: estado.hora, tipo_evento: f.tipo_evento.value,
      invitados: parseInt(f.invitados.value) || null, direccion: f.direccion.value, zona: f.zona.value,
      showcooking: c.quiereShow, notas: f.notas.value,
      items: c.lineas.map((l) => ({ producto_id: l.p.id, raciones: l.n })),
    });
    mostrarExito(r, c, f);
  } catch (err) {
    $("#error-envio").innerHTML = `${escapar(err.message || "No pudimos registrar la reserva. Inténtalo de nuevo o escríbenos por WhatsApp.")} <a class="btn wa chico" href="${waConPedido("Quise reservar en la web y me salió un error:")}" target="_blank" rel="noopener">Escríbenos por WhatsApp</a>`;
    $("#error-envio").classList.remove("oculto");
    // si el día se llenó mientras tanto, refrescamos disponibilidad
    delete estado.disp[estado.mes];
  } finally { estado.enviando = false; actualizar(); }
}

function mostrarExito(r, c, f) {
  const detalle = c.lineas.map((l) => `• ${l.n} × ${l.p.nombre}`).join("\n");
  const grande = !!r.evento_grande;
  const msg = `¡Hola Arrózame! 🥘 ${grande ? "Acabo de enviar una solicitud de evento grande en la web." : "Acabo de reservar en la web."}\n\nCódigo: *${r.codigo}*\n📅 ${fechaLarga(r.fecha)} · ${r.hora}\n${detalle}\n${c.quiereShow ? "Con showcooking\n" : ""}Total: ${bs(r.total)}\n\nA nombre de ${f.nombre.value}`;
  const wa = `https://wa.me/${estado.cfg.whatsapp}?text=${encodeURIComponent(msg)}`;

  // .ics para que el cliente lo agregue a su propio calendario
  const t = (fecha, hora, min = 0) => { const d = new Date(`${fecha}T${hora}`); d.setMinutes(d.getMinutes() + min); const p = (n) => String(n).padStart(2, "0"); return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}T${p(d.getHours())}${p(d.getMinutes())}00`; };
  const ics = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Arrozame//ES", "BEGIN:VEVENT", `UID:${r.codigo}@arrozame`,
    `DTSTART:${t(r.fecha, r.hora)}`, `DTEND:${t(r.fecha, r.hora, 180)}`, `SUMMARY:Paella Experience · Arrózame (${r.codigo})`,
    `DESCRIPTION:${detalle.replace(/\n/g, "\\n")}\\nTotal: ${bs(r.total)}`, `LOCATION:${(f.direccion.value || "").replace(/[,;]/g, " ")}`,
    "END:VEVENT", "END:VCALENDAR"].join("\r\n");
  // iPhone/iPad: un data: URI abre directo "Agregar al Calendario"; en compu se descarga el .ics
  const esIOS = /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  const icsHref = esIOS ? "data:text/calendar;charset=utf-8," + encodeURIComponent(ics)
                        : URL.createObjectURL(new Blob([ics], { type: "text/calendar" }));
  const gcal = "https://calendar.google.com/calendar/render?action=TEMPLATE"
    + "&text=" + encodeURIComponent(`Paella Experience · Arrózame (${r.codigo})`)
    + "&dates=" + t(r.fecha, r.hora) + "/" + t(r.fecha, r.hora, 180)
    + "&ctz=America/La_Paz"
    + "&details=" + encodeURIComponent(`${detalle}\nTotal: ${bs(r.total)}`)
    + "&location=" + encodeURIComponent(f.direccion.value || "");

  $("#pasos").classList.add("oculto");
  $$("[data-vista]").forEach((v) => v.classList.add("oculto"));
  $(".acciones-paso").classList.add("oculto");
  $("#barra-movil").classList.add("oculto");
  $("#exito").classList.remove("oculto");
  $("#exito").innerHTML = `
    <div class="exito-foto"><img src="img/chef-paellera-900.webp" alt="Chef de Arrózame sonriendo junto a la paellera"></div>
    <svg class="check" viewBox="0 0 64 64" aria-hidden="true"><circle cx="32" cy="32" r="30"/><path d="M19 33.5l8.5 8.5L45 24"/></svg>
    <h2>${grande ? "¡Solicitud recibida!" : "¡Reserva recibida!"}</h2>
    <div class="ticket">
      <span class="ticket-lbl">Tu código de reserva</span>
      <div class="codigo">${escapar(r.codigo)}</div>
      <div class="ticket-sep"></div>
      <div class="ticket-fila"><span>${fechaLarga(r.fecha)}</span><b>${r.hora}</b></div>
      <div class="ticket-fila"><span>${r.raciones} raciones</span><b>${bs(r.total)}</b></div>
    </div>
    <p class="exito-nota">${grande
      ? "Por ser un <b>evento grande</b>, reservamos el día para ti y lo revisamos con el equipo. Te escribimos por WhatsApp para confirmar los detalles y el anticipo."
      : "Queda <b>pendiente</b> hasta que te confirmemos por WhatsApp con los datos de pago del anticipo."}</p>
    <div class="botones">
      <a class="btn wa" href="${wa}" target="_blank" rel="noopener">Enviar por WhatsApp</a>
    </div>
    <p class="exito-cal">Agrégalo a tu calendario</p>
    <div class="botones cal-botones">
      <a class="btn sec chico" href="${icsHref}" ${esIOS ? "" : `download="arrozame-${r.codigo}.ics"`}>Apple / iPhone</a>
      <a class="btn sec chico" href="${gcal}" target="_blank" rel="noopener">Google Calendar</a>
    </div>
    <p class="exito-volver"><a href="./">← Volver al inicio / hacer otra reserva</a></p>`;
  window.scrollTo({ top: 0, behavior: "smooth" });
}

// ---------------------------------------------------------------- arranque
(async function iniciar() {
  if (modoDemo) $("#banda-demo").classList.remove("oculto");
  try {
    [estado.cfg, estado.productos] = await Promise.all([datos.config(), datos.productos()]);
  } catch (e) {
    $("#carta").innerHTML = `<div class="aviso error">No pudimos cargar la carta. Escríbenos por WhatsApp al 71293297.</div>`;
    return;
  }
  $("#aviso-minimo").textContent = `Mínimo ${estado.cfg.pedido_minimo} raciones por paella · puedes combinar varias · showcooking incluido desde ${estado.cfg.showcooking_incluido_desde} raciones.`;
  $("#pie-contacto").innerHTML = `Santa Cruz de la Sierra · <a href="https://wa.me/${estado.cfg.whatsapp}">WhatsApp</a> · <a href="https://instagram.com/${estado.cfg.instagram}">@${estado.cfg.instagram}</a> · ${escapar(estado.cfg.email)}`;
  pintarCarta();
  actualizar();
})();
