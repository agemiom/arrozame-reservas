# Arrózame · Sistema de reservas

Sistema de reservas de **Arrózame · Paella Experience** (Santa Cruz de la Sierra), desarrollado por Hippo.

Hace cuatro cosas:

1. **Página pública de reservas** (`docs/index.html`). El cliente arma su pedido con la carta, elige fecha y hora con disponibilidad real, deja sus datos y confirma. Al terminar puede enviar el resumen por WhatsApp y agregar el evento a su calendario.
2. **Calendario compartido con el iPhone.** Cada reserva aparece sola en el Calendario del iPhone de Fer, con dirección, pedido, teléfono del cliente y avisos 24 h y 3 h antes.
3. **Panel de administración** (`docs/panel.html`). Incluye agenda, calendario mensual, estados (pendiente → confirmada → pagada → realizada), anticipos y saldos, reservas manuales (WhatsApp, Instagram, en persona), clientes, carta editable y ajustes.
4. **Ventas.** Muestra qué paellas salen más (por raciones, ingresos o pedidos), los ingresos por mes, los días y horarios con más demanda, el tipo de evento, las zonas y el canal por donde llega cada reserva.

Todo queda registrado en una sola base de datos.

---

## Cómo está armado

```
docs/                      ← sitio estático (GitHub Pages)
  index.html               ← página pública de reservas
  panel.html               ← panel de Fer
  js/config.js             ← URL y clave pública de Supabase (lo único a completar)
  js/datos.js              ← capa de datos (Supabase o modo demo)
  js/reservas.js, panel.js
  css/arrozame.css         ← colores y tipografías del manual de marca
  img/                     ← logos extraídos del manual de identidad
supabase/
  migrations/…_init.sql    ← tablas, seguridad, reglas de reserva, carta inicial
  functions/calendario/    ← feed .ics para el iPhone
  config.toml
```

- **Frontend:** HTML, CSS y JavaScript sin build, así que se publica tal cual en GitHub Pages.
- **Backend:** Supabase, con Postgres y Auth, más una Edge Function para el calendario.
- **Seguridad:** RLS activo en todas las tablas. El público solo puede leer la carta activa y crear reservas mediante `crear_reserva()`, que valida el mínimo de raciones, la capacidad del día, el horario libre y la anticipación, y recalcula los precios en el servidor. El panel exige un usuario registrado en `administradores`.

### Modo demo
Si `docs/js/config.js` está vacío, el sitio funciona con datos de ejemplo guardados en el navegador. Sirve para mostrarle el sistema a Fer antes de conectar la base. En el panel se entra con cualquier email y contraseña.

---

## Estado actual
- Supabase: proyecto `arrozame-reservas` (ref `ncwkdnqaurqtduhwweua`, São Paulo, org Hippo Brands) con la base cargada, la carta de junio 2026 y la función `calendario` desplegada.
- `docs/js/config.js` ya apunta a ese proyecto.
- Pendiente: publicar en GitHub Pages y crear el usuario de Fer (paso 4).

## Puesta en marcha desde cero (unos 20 minutos)

### 1. Subir a GitHub
```bash
git remote add origin git@github.com:<usuario>/arrozame-reservas.git
git push -u origin main
```

### 2. Publicar en GitHub Pages
En el repositorio, entrá a **Settings → Pages → Build and deployment**, elegí **Deploy from a branch**, seleccioná la rama `main`, la carpeta `/docs` y guardá.
Queda en `https://<usuario>.github.io/arrozame-reservas/`. Para usar un dominio propio, como `reservas.arrozame.bo`, cargalo en **Custom domain**.

### 3. Crear la base en Supabase
1. Creá un proyecto nuevo en la región **South America (São Paulo)**.
2. En **SQL Editor**, pegá y ejecutá `supabase/migrations/20261113000000_init.sql`. Eso crea las tablas y carga la carta de junio 2026.
   - Con la CLI: `supabase link --project-ref <ref>` y después `supabase db push`.
3. Desplegá la función del calendario:
   ```bash
   supabase functions deploy calendario --no-verify-jwt
   ```
4. En **Project Settings → API**, copiá la *Project URL* y la *anon / publishable key*, pegalas en `docs/js/config.js` y hacé commit.

### 4. Crear el usuario de Fer
1. En **Authentication → Users → Add user**, cargá el email y la contraseña de Fer y marcá *Auto confirm*.
2. En el SQL Editor, dale acceso al panel:
   ```sql
   insert into administradores (user_id, nombre)
   select id, 'Fer' from auth.users where email = 'EMAIL_DE_FER';
   ```
3. En **Authentication → Sign In / Providers**, desactivá *Allow new users to sign up* para que nadie más pueda registrarse.

### 5. Conectar el iPhone
En el panel, entrá a **Ajustes → Calendario en el iPhone**, copiá el enlace privado y seguí los pasos que aparecen ahí:
**Ajustes del iPhone → Calendario → Cuentas → Añadir cuenta → Otra → Añadir calendario suscrito**.
El iPhone actualiza los calendarios suscritos cada 15 minutos o más, según la configuración de *Buscar*. Si el enlace se filtra, generá uno nuevo desde el panel.

---

## Reglas de negocio (editables en Ajustes)
| Regla | Valor inicial |
|---|---|
| Pedido mínimo | 6 raciones |
| Showcooking incluido | desde 20 raciones |
| Showcooking con menos raciones | Bs 500 |
| Anticipación mínima para reservas web | 48 h |
| Máximo por día | 2 eventos / 120 raciones |
| Horarios ofrecidos | 11:00, 12:00, 13:00, 18:00, 19:00, 20:00, 21:00 |

Para bloquear un día (vacaciones, evento privado), tocá su número en el calendario del panel.

## Próximos pasos posibles
- Cobro del anticipo con QR (Simple/BNB) y cambio automático a *pagada*.
- Confirmaciones y recordatorios automáticos con la API de WhatsApp Business.
- Variante con dos sentidos usando Google Calendar, para que lo que Fer bloquee en el iPhone cierre horarios en la web.
