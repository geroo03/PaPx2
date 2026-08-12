/**
 * server.js — Punto de entrada del backend de Puerta a Puerta
 *
 * Responsabilidades:
 *   · Inicializar Express con los middlewares globales (CORS, JSON)
 *   · Montar los routers de cada recurso bajo /api/*
 *   · Exponer el endpoint de diagnóstico /health
 *   · Levantar el servidor HTTP en el puerto configurado
 *   · (opcional, vía WEB_CONCURRENCY) repartir las conexiones HTTP entre
 *     varios workers de Node en la misma instancia, para aprovechar más
 *     de un vCPU — ver la sección "CLUSTERING" más abajo.
 */

import 'dotenv/config';   // Carga .env antes de cualquier otro módulo
import cluster      from 'node:cluster';
import express       from 'express';
import cors          from 'cors';
import compression   from 'compression';
import helmet        from 'helmet';
import rateLimit     from 'express-rate-limit';

import pedidoRoutes   from './routes/pedidoRoutes.js';
import authRoutes     from './routes/authRoutes.js';
import mpRoutes       from './routes/mpRoutes.js';
import cadeteRoutes   from './routes/cadeteRoutes.js';
import embajadorRoutes from './routes/embajadorRoutes.js';
import { iniciarSchedulerMatching } from './jobs/matchingScheduler.js';
import { iniciarSchedulerHorarios } from './jobs/horariosScheduler.js';

// ─── Configuración ────────────────────────────────────────────────────────────

const PORT = Number(process.env.PORT) || 3000;

// WEB_CONCURRENCY: cantidad de workers HTTP (node:cluster) a levantar
// dentro de esta misma instancia/réplica de Railway. Default 1 → el
// comportamiento es IDÉNTICO al de antes de este cambio: un solo proceso
// Node hace todo (HTTP + los 2 schedulers), sin clustering. Es opt-in a
// propósito — no cambia nada en producción hasta que se configure la
// variable en Railway.
//
// A propósito NO se calcula un default a partir de os.cpus(): dentro de un
// contenedor eso puede reportar los núcleos del host físico completo, no
// los que Railway realmente le asignó al servicio — arrancar de más
// workers que vCPU real disponible generaría más overhead (context
// switching) que beneficio. Ver CLAUDE.md para cómo elegir el número.
//
// Node es de un solo hilo por proceso — sin esto, un servicio de Railway
// con muchos vCPU asignados solo usa uno para ejecutar JS, sin importar
// cuánta CPU le des.
const WEB_CONCURRENCY = Math.max(1, Number(process.env.WEB_CONCURRENCY) || 1);

// Linux (donde corre Railway) reparte las conexiones entre workers por
// round-robin por defecto -- Windows no, usa SCHED_NONE (deja que el SO
// decida, que en la práctica puede terminar cargando un solo worker). Se
// fuerza round-robin siempre para que el comportamiento sea el mismo sin
// importar el sistema operativo desde el que se corra/pruebe.
if (cluster.isPrimary) cluster.schedulingPolicy = cluster.SCHED_RR;

// FRONTEND_URL acepta varios orígenes separados por coma:
//   FRONTEND_URL=http://localhost:5173,https://puertaapuerta.vercel.app
// Los orígenes de Capacitor (app nativa Android/iOS) siempre se permiten.
const _CAPACITOR_ORIGINS = ['capacitor://localhost', 'https://localhost', 'http://localhost'];
const allowedOrigins = [
  ..._CAPACITOR_ORIGINS,
  ...(process.env.FRONTEND_URL ?? 'http://localhost:5173')
    .split(',')
    .map(o => o.trim())
    .filter(Boolean),
];

// ─── App ──────────────────────────────────────────────────────────────────────

/** Arma la app Express — misma instancia de siempre, ahora en una función
 * para poder crearla tanto en modo "un solo proceso" como en cada worker
 * cuando WEB_CONCURRENCY > 1. */
function createApp() {
  const app = express();

  app.use(helmet());
  app.use(compression());

  // CORS — solo acepta peticiones de los orígenes configurados
  app.use(cors({
    origin:         allowedOrigins,
    credentials:    true,
    methods:        ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  }));

  // Rate limiting — límite general generoso (la app hace polling frecuente:
  // GPS cada 5-10s, ofertas cada 30s, etc.) para no frenar uso legítimo, más
  // uno estricto en los endpoints de registro para frenar creación masiva de
  // cuentas. Ventanas cortas en vez de 15 min largos para no castigar de más
  // a IPs compartidas (varios cadetes en la misma red/operador).
  //
  // Nota (2026-08-11): usa el store en memoria por defecto de
  // express-rate-limit. Con WEB_CONCURRENCY > 1 cada worker cuenta aparte,
  // así que el límite efectivo real es ~300×N por IP en vez de 300 estrictos
  // (N = cantidad de workers). Aceptado a propósito — el límite ya es
  // generoso de por sí, no vale la pena sumar Redis solo para esto.
  const apiLimiter = rateLimit({
    windowMs: 60 * 1000,
    limit:    300,
    standardHeaders: true,
    legacyHeaders:    false,
  });
  app.use('/api', apiLimiter);

  const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit:    20,
    standardHeaders: true,
    legacyHeaders:    false,
    message: { error: 'Demasiados intentos. Probá de nuevo en unos minutos.' },
  });
  app.use('/api/auth/register', authLimiter);
  app.use('/api/auth/admin/crear-usuario', authLimiter);

  // Parseo de JSON nativo de Express (no necesita body-parser por separado)
  app.use(express.json());

  // ─── Rutas ──────────────────────────────────────────────────────────────────

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

  // ─── Endpoint de diagnóstico ────────────────────────────────────────────────
  // Útil para health-checks de Railway / Render / EC2 y para depuración rápida.
  // No requiere autenticación — no expone datos sensibles.
  app.get('/health', (_req, res) => {
    res.json({
      ok:        true,
      cors:      allowedOrigins,
      service:   'puertaapuerta-backend',
      env:       process.env.NODE_ENV ?? 'development',
      pid:       process.pid,
      timestamp: new Date().toISOString(),
    });
  });

  // ─── Manejo de rutas no encontradas ────────────────────────────────────────
  app.use((_req, res) => {
    res.status(404).json({ error: 'Endpoint no encontrado.' });
  });

  // ─── Manejo global de errores (Express 5 propaga async errors automáticamente)
  // eslint-disable-next-line no-unused-vars
  app.use((err, _req, res, _next) => {
    console.error('[server] Error no manejado:', err?.message ?? err);
    res.status(500).json({ error: 'Error interno del servidor.' });
  });

  return app;
}

/** Levanta el servidor HTTP y engancha el apagado prolijo (SIGTERM/SIGINT). */
function serve() {
  const app = createApp();
  const server = app.listen(PORT, () => {
    console.log(`[PaP] Backend corriendo en http://localhost:${PORT} (pid ${process.pid})`);
    console.log(`[PaP] Orígenes CORS permitidos: ${allowedOrigins.join(', ')}`);
  });

  // Railway manda SIGTERM en cada redeploy/restart — sin esto, el proceso
  // moría a mitad de un request o de un tick del scheduler, sin cleanup.
  const apagar = (señal) => {
    console.log(`[PaP] ${señal} recibido (pid ${process.pid}) — cerrando servidor...`);
    server.close(() => {
      console.log(`[PaP] Servidor cerrado (pid ${process.pid}). Adiós.`);
      process.exit(0);
    });
    // Si algo queda colgado (conexión que nunca cierra), no esperar para siempre.
    setTimeout(() => process.exit(1), 10_000).unref();
  };
  process.on('SIGTERM', () => apagar('SIGTERM'));
  process.on('SIGINT',  () => apagar('SIGINT'));

  return app;
}

// ─── CLUSTERING ─────────────────────────────────────────────────────────────
//
// WEB_CONCURRENCY <= 1 (default): un solo proceso hace todo — HTTP + los 2
// schedulers — exactamente como funcionaba antes de este cambio.
//
// WEB_CONCURRENCY > 1: el proceso primario reparte las conexiones HTTP
// entre N workers y es el ÚNICO que corre los schedulers — nunca en los
// workers, para no terminar con N copias difundiendo el mismo pedido o
// mandando pushes duplicados. matchingScheduler.js/horariosScheduler.js no
// tienen ningún candado entre procesos (solo dentro de uno mismo), así
// que esto depende de que solo exista un primario por instancia — que es
// justo lo que garantiza node:cluster.

let app;

if (cluster.isPrimary && WEB_CONCURRENCY > 1) {
  console.log(`[PaP] Primary (pid ${process.pid}) — levantando ${WEB_CONCURRENCY} workers HTTP`);

  for (let i = 0; i < WEB_CONCURRENCY; i++) cluster.fork();

  cluster.on('exit', (worker, code, señal) => {
    console.warn(`[PaP] Worker ${worker.process.pid} murió (${señal || code}) — levantando uno nuevo`);
    cluster.fork();
  });

  // Los schedulers corren acá, en el primario, una sola vez.
  iniciarSchedulerMatching();
  iniciarSchedulerHorarios();

  const apagarPrimario = (señal) => {
    console.log(`[PaP] ${señal} recibido en el primario — avisando a los workers...`);
    for (const worker of Object.values(cluster.workers)) worker.process.kill(señal);
    process.exit(0);
  };
  process.on('SIGTERM', () => apagarPrimario('SIGTERM'));
  process.on('SIGINT',  () => apagarPrimario('SIGINT'));
} else if (cluster.isPrimary) {
  // WEB_CONCURRENCY=1 (default): un solo proceso, sin forkear nada.
  app = serve();
  iniciarSchedulerMatching();
  iniciarSchedulerHorarios();
} else {
  // Somos un worker forkeado por el primario de arriba — solo HTTP, sin schedulers.
  app = serve();
}

export default app;
