// Arrózame · Feed de calendario (.ics) para suscribirse desde el iPhone
// URL: https://<proyecto>.supabase.co/functions/v1/calendario?token=<calendario_token>
// Desplegar con verify_jwt = false (el acceso lo protege el token secreto).
import { createClient } from "jsr:@supabase/supabase-js@2";

const TZ = "America/La_Paz";

const esc = (s: unknown) =>
  String(s ?? "").replace(/\\/g, "\\\\").replace(/\n/g, "\\n").replace(/,/g, "\\,").replace(/;/g, "\\;");

// Las líneas de un .ics no deben pasar de 75 octetos
const fold = (line: string) => {
  const out: string[] = [];
  let rest = line;
  while (new TextEncoder().encode(rest).length > 74) {
    let cut = 74;
    while (new TextEncoder().encode(rest.slice(0, cut)).length > 74) cut--;
    out.push(rest.slice(0, cut));
    rest = " " + rest.slice(cut);
  }
  out.push(rest);
  return out.join("\r\n");
};

const local = (fecha: string, hora: string, sumarMin = 0) => {
  const [y, m, d] = fecha.split("-").map(Number);
  const [hh, mm] = hora.split(":").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d, hh, mm + sumarMin));
  const p = (n: number) => String(n).padStart(2, "0");
  return `${t.getUTCFullYear()}${p(t.getUTCMonth() + 1)}${p(t.getUTCDate())}T${p(t.getUTCHours())}${p(t.getUTCMinutes())}00`;
};

const stamp = (iso: string) => new Date(iso).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");

const ESTADO: Record<string, string> = {
  pendiente: "⏳ Pendiente", confirmada: "✅ Confirmada", pagada: "💰 Pagada", realizada: "✔️ Realizada",
};

Deno.serve(async (req) => {
  const url = new URL(req.url);
  const token = url.searchParams.get("token") ?? "";

  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
    auth: { persistSession: false },
  });

  const { data: cfg } = await db.from("configuracion").select("calendario_token, nombre_negocio").eq("id", 1).single();
  if (!cfg || token.length < 16 || token !== cfg.calendario_token) {
    return new Response("No autorizado", { status: 401 });
  }

  const desde = new Date(Date.now() - 90 * 864e5).toISOString().slice(0, 10);
  const { data: reservas, error } = await db
    .from("reservas")
    .select("id, codigo, fecha, hora, duracion_min, tipo_evento, direccion, zona, invitados, raciones_total, showcooking, total, anticipo, estado, notas_cliente, notas_internas, updated_at, clientes(nombre, telefono), reserva_items(nombre, raciones)")
    .gte("fecha", desde)
    .neq("estado", "cancelada")
    .order("fecha");
  if (error) return new Response(error.message, { status: 500 });

  const lines = [
    "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Arrozame//Reservas//ES", "CALSCALE:GREGORIAN", "METHOD:PUBLISH",
    "X-WR-CALNAME:Arrózame · Reservas", `X-WR-TIMEZONE:${TZ}`, "REFRESH-INTERVAL;VALUE=DURATION:PT15M",
    "X-PUBLISHED-TTL:PT15M",
    "BEGIN:VTIMEZONE", `TZID:${TZ}`, "BEGIN:STANDARD", "DTSTART:19700101T000000",
    "TZOFFSETFROM:-0400", "TZOFFSETTO:-0400", "TZNAME:BOT", "END:STANDARD", "END:VTIMEZONE",
  ];

  for (const r of reservas ?? []) {
    const cli = (r as any).clientes ?? {};
    const items = ((r as any).reserva_items ?? []).map((i: any) => `• ${i.raciones} × ${i.nombre}`).join("\n");
    const hora = String(r.hora).slice(0, 5);
    const desc = [
      `Reserva ${r.codigo} · ${ESTADO[r.estado] ?? r.estado}`,
      `Cliente: ${cli.nombre ?? ""} · ${cli.telefono ?? ""}`,
      r.tipo_evento ? `Evento: ${r.tipo_evento}` : "",
      r.invitados ? `Invitados: ${r.invitados}` : "",
      `Raciones: ${r.raciones_total}${r.showcooking ? " · Con showcooking" : ""}`,
      items,
      `Total: Bs ${Number(r.total).toLocaleString("es-BO")}${Number(r.anticipo) ? ` · Anticipo: Bs ${r.anticipo}` : ""}`,
      r.notas_cliente ? `Nota del cliente: ${r.notas_cliente}` : "",
      r.notas_internas ? `Interno: ${r.notas_internas}` : "",
      cli.telefono ? `WhatsApp: https://wa.me/${String(cli.telefono).replace(/[^0-9]/g, "")}` : "",
    ].filter(Boolean).join("\n");

    lines.push(
      "BEGIN:VEVENT",
      `UID:${r.id}@arrozame`,
      `DTSTAMP:${stamp(r.updated_at)}`,
      `LAST-MODIFIED:${stamp(r.updated_at)}`,
      `DTSTART;TZID=${TZ}:${local(r.fecha, hora)}`,
      `DTEND;TZID=${TZ}:${local(r.fecha, hora, r.duracion_min ?? 180)}`,
      fold(`SUMMARY:${esc(`🥘 ${r.raciones_total} rac · ${cli.nombre ?? "Reserva"}${r.estado === "pendiente" ? " (pendiente)" : ""}`)}`),
      fold(`LOCATION:${esc([r.direccion, r.zona].filter(Boolean).join(", "))}`),
      fold(`DESCRIPTION:${esc(desc)}`),
      `STATUS:${r.estado === "pendiente" ? "TENTATIVE" : "CONFIRMED"}`,
      "BEGIN:VALARM", "ACTION:DISPLAY", "DESCRIPTION:Evento Arrózame mañana", "TRIGGER:-PT24H", "END:VALARM",
      "BEGIN:VALARM", "ACTION:DISPLAY", "DESCRIPTION:Evento Arrózame en 3 horas", "TRIGGER:-PT3H", "END:VALARM",
      "END:VEVENT",
    );
  }
  lines.push("END:VCALENDAR");

  return new Response(lines.join("\r\n") + "\r\n", {
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": 'inline; filename="arrozame.ics"',
      "Cache-Control": "no-cache",
    },
  });
});
