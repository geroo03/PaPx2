import { Router } from 'express';
import { requireAuth } from '../middlewares/authMiddleware.js';
import { setRole, register } from '../controllers/authController.js';

const router = Router();

// POST /api/auth/register — crea usuario sin confirmacion de email (usa admin API)
router.post('/register', register);

// POST /api/auth/set-role — cadete/comercio/usuario asigna su propio rol post-registro
router.post('/set-role', requireAuth, setRole);

export default router;
