/**
 * pedidoRoutes.js
 *
 * Define los endpoints del recurso /api/pedidos.
 * Todas las rutas de escritura están protegidas por requireAuth.
 *
 * Montado en server.js bajo el prefijo /api/pedidos.
 */

import { Router } from 'express';
import { requireAuth }          from '../middlewares/authMiddleware.js';
import {
  aceptarPedido,
  cambiarEstadoPedido,
  getPedidoConCadete,
  difundirPedido,
  valorarPedido,
  notificarNuevoPedido,
  reportarNoShow,
} from '../controllers/pedidoController.js';

const router = Router();

// POST /api/pedidos/aceptar          — cadete acepta un viaje (anti-colisión)
router.post('/aceptar',        requireAuth, aceptarPedido);

// POST /api/pedidos/cambiar-estado   — cadete confirma retiro o entrega (valida código)
router.post('/cambiar-estado', requireAuth, cambiarEstadoPedido);

// POST /api/pedidos/difundir         — comercio dispara búsqueda de cadetes cercanos
router.post('/difundir',       requireAuth, difundirPedido);

// POST /api/pedidos/valorar          — cliente valora al comercio o al cadete post-entrega
router.post('/valorar',        requireAuth, valorarPedido);

// POST /api/pedidos/notificar-comercio — push al comercio cuando llega pedido nuevo
router.post('/notificar-comercio', requireAuth, notificarNuevoPedido);

// POST /api/pedidos/no-show — cadete reporta que el cliente no estaba al entregar
router.post('/no-show', requireAuth, reportarNoShow);

// GET  /api/pedidos/:id              — cliente/cadete lee pedido + perfil cadete
// Debe ir al final para que las rutas con nombre no sean interpretadas como :id
router.get('/:id',             requireAuth, getPedidoConCadete);

export default router;
