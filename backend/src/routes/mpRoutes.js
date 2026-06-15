import { Router } from 'express';
import { requireAuth } from '../middlewares/authMiddleware.js';
import { crearPreferencia, mpWebhook } from '../controllers/mpController.js';

const router = Router();

// Crea preferencia de pago en MercadoPago (requiere auth del cliente)
router.post('/crear-preferencia', requireAuth, crearPreferencia);

// Webhook de MercadoPago (sin auth — verifica firma HMAC internamente)
router.post('/webhook', mpWebhook);

export default router;
