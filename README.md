# Puerta a Puerta

Plataforma de delivery para Santiago del Estero. Conecta clientes, comercios, cadetes y embajadores.

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
  schema-definitivo-v2.sql          Schema principal (20+ tablas, triggers, RLS)
  migracion-nuevas-funciones.sql    Embajador: patrocinios, comisiones, billetera
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
| GET | `/health` | No | Health check |

## Setup local

```bash
# Backend
cd backend
cp .env.example .env    # Completar con credenciales reales
npm install
npm start               # http://localhost:3000

# Frontend
# Servir frontend/ con cualquier server estático en puerto 8000
# Copiar env.js.template a env.js y completar las keys
```

## Deploy

- **Backend:** Railway (desde GitHub, entry: `backend/`)
- **Frontend:** Vercel (desde GitHub, root: `frontend/`)
- **DB:** Supabase (correr los SQL del directorio `supabase/`)
