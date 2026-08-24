import { Router } from 'express';
import { requireAuth } from '../middlewares/authMiddleware.js';
import { crearCheckout, consultarEstado, getnetWebhook } from '../controllers/getnetController.js';

// ⚠️ WIP — ver docs/GETNET-INTEGRACION.md. Nada del frontend en producción
// llama a estas rutas todavía; sin GETNET_CLIENT_ID/GETNET_CLIENT_SECRET
// configuradas, crear-checkout y estado devuelven 501 (ver
// getnetController.js).

const router = Router();

// Arma el checkout hospedado y devuelve la URL a la que redirigir al
// cliente — el pedido recién se crea cuando el webhook confirma el pago.
router.post('/crear-checkout', requireAuth, crearCheckout);

// Reconsulta el estado de una orden por id — reconciliación/debug.
router.get('/estado/:orderId', requireAuth, consultarEstado);

// Notificación asíncrona de Getnet — sin auth (mismo criterio que
// POST /api/mp/webhook), la seguridad la da la verificación de firma.
router.post('/webhook', getnetWebhook);

export default router;
