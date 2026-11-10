import { Router } from 'express';
import { AuthController } from './auth.controller.js';
import { authenticateToken } from '../../common/middleware/auth-guard.js';

export const authRouter = Router();

authRouter.post('/register', AuthController.register);
authRouter.post('/login', AuthController.login);
authRouter.post('/verify-otp', authenticateToken, AuthController.verifyOtp);
authRouter.post('/resend-otp', authenticateToken, AuthController.resendOtp);
authRouter.post('/refresh', AuthController.refresh);
authRouter.post('/logout', AuthController.logout);
