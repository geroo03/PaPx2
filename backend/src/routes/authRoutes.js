import { Router } from 'express';
import { requireAuth, requireAdmin } from '../middlewares/authMiddleware.js';
import { setRole, register, crearUsuarioAdmin } from '../controllers/authController.js';

const router = Router();

// POST /api/auth/register — crea usuario sin confirmacion de email (usa admin API)
router.post('/register', register);

// POST /api/auth/set-role — cadete/comercio/usuario asigna su propio rol post-registro
router.post('/set-role', requireAuth, setRole);

// POST /api/auth/admin/crear-usuario — solo admin, crea cualquier rol incluyendo embajador
router.post('/admin/crear-usuario', requireAdmin, crearUsuarioAdmin);

export default router;
