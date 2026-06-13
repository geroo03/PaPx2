/**
 * pedidoRoutes.js
 *
 * Define los endpoints del recurso /api/pedidos.
 * Todas las rutas de escritura están protegidas por requireAuth.
 *
 * Montado en server.js bajo el prefijo /api/pedidos.
 */

import { Router } from 'express';
import { requireAuth }  from '../middlewares/authMiddleware.js';
import { aceptarPedido } from '../controllers/pedidoController.js';

const router = Router();

// POST /api/pedidos/aceptar
// El cadete acepta un viaje. requireAuth garantiza que solo
// usuarios autenticados con JWT válido pueden ejecutar esta acción.
router.post('/aceptar', requireAuth, aceptarPedido);

export default router;
