import { Router } from 'express';
import { requireAuth } from '../middlewares/authMiddleware.js';
import { crearPago, consultarEstado } from '../controllers/paywayController.js';

// ⚠️ WIP — ver docs/PAYWAY-INTEGRACION.md. Nada del frontend en producción
// llama a estas rutas todavía; sin PAYWAY_PRIVATE_KEY configurada, ambos
// endpoints devuelven 501 (ver paywayController.js).

const router = Router();

// Cobra un token de tarjeta ya generado en el frontend y, si Payway aprueba,
// crea/confirma el pedido — todo en una sola llamada (no hay webhook).
router.post('/crear-pago', requireAuth, crearPago);

// Reconsulta el estado de un pago por id — reconciliación/debug.
router.get('/estado/:paymentId', requireAuth, consultarEstado);

export default router;
