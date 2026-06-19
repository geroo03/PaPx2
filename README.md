# Puerta a Puerta

Plataforma de delivery para Santiago del Estero. Conecta clientes, comercios, cadetes y embajadores.

## Funcionalidades

- **Sistema de Embajadores:** Patrocinios con comisiones dinámicas (5% primeros 6 meses, 2% después)
- **Tracking Realtime:** Seguimiento de cadetes con Leaflet + Supabase Realtime
- **Pagos:** Integración MercadoPago con webhook HMAC + billetera digital embajadores
- **Asignación Inteligente:** Matching de cadetes por geolocalización (Haversine, radio 10km)
- **Seguridad:** JWT en todos los endpoints, códigos de entrega CSPRNG (4 dígitos), timingSafeEqual
- **Anti-colisión:** Solo un cadete puede tomar cada pedido (`.is('cadete_id', null)`)

## Stack

- **Backend:** Node.js 20+ / Express 5 / ES Modules
- **Base de datos:** Supabase (PostgreSQL + Auth + Realtime + Storage)
- **Pagos:** MercadoPago SDK v3
- **Frontend:** HTML/CSS/JS vanilla + Supabase CDN + Leaflet (mapa)

## Estructura

```
backend/
  src/
    controllers/   authController, pedidoController, cadeteController,
                   mpController, embajadorController
    lib/           supabaseClient, roleUtils, comisionUtils
    middlewares/   authMiddleware (JWT)
    routes/        auth, pedidos, cadete, mp, embajadores
    server.js      Punto de entrada
  .env.example     Variables de entorno (sin secretos)
  package.json

frontend/
  cliente/         App del cliente (pedidos, tracking, mapa Leaflet)
  comercio/        Panel del comercio (productos, pedidos entrantes)
  cadete/          Panel del cadete (ofertas, GPS, entregas, onboarding)
  embajador/       Dashboard embajador (billetera, comisiones, comercios)
  admin/           Panel administrativo
  assets/css/      Estilos por rol
  assets/js/       Lógica por rol + auth-service + config
  login.html       Login general (todos los roles)
  env.js.template  Template para credenciales del cliente

supabase/
  schema-definitivo-v2.sql   Schema completo (tablas, embajador, RPCs, triggers, RLS)
```

## Endpoints

| Método | Ruta | Auth | Descripción |
|--------|------|------|-------------|
| POST | `/api/auth/set-role` | JWT | Asignar rol post-registro |
| POST | `/api/pedidos/difundir` | JWT | Broadcast ofertas a cadetes cercanos |
| POST | `/api/pedidos/aceptar` | JWT | Cadete acepta viaje (anti-colisión) |
| POST | `/api/pedidos/cambiar-estado` | JWT | Confirmar retiro/entrega con código 4 dígitos |
| POST | `/api/pedidos/valorar` | JWT | Calificar comercio o cadete |
| GET | `/api/pedidos/:id` | JWT | Detalle pedido + perfil cadete |
| POST | `/api/mp/crear-preferencia` | JWT | Crear pago MercadoPago |
| POST | `/api/mp/webhook` | HMAC | Notificación de pago |
| POST | `/api/cadete/actualizar-ubicacion` | JWT | GPS del cadete cada 10s |
| GET | `/api/embajadores/dashboard` | JWT | Billetera + comisiones + comercios |
| POST | `/api/embajadores/comercios` | JWT | Registrar comercio como embajador |
| POST | `/api/embajadores/solicitar-retiro` | JWT | Solicitar retiro de comisiones |
| PATCH | `/api/embajadores/retiro/:id/pagar` | JWT | Admin confirma pago de retiro |
| PATCH | `/api/embajadores/retiro/:id/rechazar` | JWT | Admin rechaza retiro |
| GET | `/health` | No | Health check |

## Setup local

```bash
# Backend
cd backend
cp .env.example .env    # Completar con credenciales reales
npm install
npm start               # http://localhost:3000

# Frontend
# Copiar env.js.template a env.js y completar las keys
# Servir frontend/ con cualquier server estático en puerto 8000
```

## Deploy

- **Backend:** Railway (desde GitHub, root: `backend/`, start: `npm start`)
- **Frontend:** Vercel (desde GitHub, root: `frontend/`, output: `.`)
- **DB:** Supabase (correr `supabase/schema-definitivo-v2.sql` en SQL Editor)
