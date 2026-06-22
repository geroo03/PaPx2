/**
 * server.js — Punto de entrada del backend de Puerta a Puerta
 *
 * Responsabilidades:
 *   · Inicializar Express con los middlewares globales (CORS, JSON)
 *   · Montar los routers de cada recurso bajo /api/*
 *   · Exponer el endpoint de diagnóstico /health
 *   · Levantar el servidor HTTP en el puerto configurado
 */

import 'dotenv/config';   // Carga .env antes de cualquier otro módulo
import express from 'express';
import cors    from 'cors';

import pedidoRoutes   from './routes/pedidoRoutes.js';
import authRoutes     from './routes/authRoutes.js';
import mpRoutes       from './routes/mpRoutes.js';
import cadeteRoutes   from './routes/cadeteRoutes.js';
import embajadorRoutes from './routes/embajadorRoutes.js';

// ─── Configuración ────────────────────────────────────────────────────────────

const PORT = Number(process.env.PORT) || 3000;

// FRONTEND_URL acepta varios orígenes separados por coma:
//   FRONTEND_URL=http://localhost:5173,https://puertaapuerta.vercel.app
const allowedOrigins = (process.env.FRONTEND_URL ?? 'http://localhost:5173')
  .split(',')
  .map(o => o.trim())
  .filter(Boolean);

// ─── App ──────────────────────────────────────────────────────────────────────

const app = express();

// CORS — solo acepta peticiones de los orígenes configurados
app.use(cors({
  origin:         allowedOrigins,
  credentials:    true,
  methods:        ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));

// Parseo de JSON nativo de Express (no necesita body-parser por separado)
app.use(express.json());

// ─── Rutas ────────────────────────────────────────────────────────────────────

// Autenticación: /api/auth/set-role
app.use('/api/auth', authRoutes);

// Pedidos: /api/pedidos/aceptar, /api/pedidos/:id, /api/pedidos/valorar, etc.
app.use('/api/pedidos', pedidoRoutes);

// MercadoPago: /api/mp/crear-preferencia, /api/mp/webhook
app.use('/api/mp', mpRoutes);

// Cadete GPS: /api/cadete/actualizar-ubicacion
app.use('/api/cadete', cadeteRoutes);

// Embajador: dashboard, agregar-comercio, solicitar-retiro, confirmar-pago
app.use('/api/embajadores', embajadorRoutes);

// ─── Endpoint de diagnóstico ──────────────────────────────────────────────────
// Útil para health-checks de Railway / Render / EC2 y para depuración rápida.
// No requiere autenticación — no expone datos sensibles.
app.get('/health', (_req, res) => {
  res.json({
    ok:        true,
    cors:      allowedOrigins,
    service:   'puertaapuerta-backend',
    env:       process.env.NODE_ENV ?? 'development',
    timestamp: new Date().toISOString(),
  });
});

// ─── Manejo de rutas no encontradas ──────────────────────────────────────────
app.use((_req, res) => {
  res.status(404).json({ error: 'Endpoint no encontrado.' });
});

// ─── Manejo global de errores (Express 5 propaga async errors automáticamente)
// eslint-disable-next-line no-unused-vars
app.use((err, _req, res, _next) => {
  console.error('[server] Error no manejado:', err?.message ?? err);
  res.status(500).json({ error: 'Error interno del servidor.' });
});

// ─── Arranque ────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`[PaP] Backend corriendo en http://localhost:${PORT}`);
  console.log(`[PaP] Orígenes CORS permitidos: ${allowedOrigins.join(', ')}`);
});

export default app;
