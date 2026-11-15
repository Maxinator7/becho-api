import { Router } from 'express';
import { AuthController } from './auth.controller.js';
import { authenticateToken } from '../../common/middleware/auth-guard.js';
import { asyncHandler as wrap } from '../../common/async-handler.js';

export const authRouter = Router();

authRouter.post('/register', wrap(AuthController.register));
authRouter.post('/login', wrap(AuthController.login));
authRouter.post('/verify-otp', authenticateToken, wrap(AuthController.verifyOtp));
authRouter.post('/resend-otp', authenticateToken, wrap(AuthController.resendOtp));
authRouter.post('/forgot-password', wrap(AuthController.forgotPassword));
authRouter.post('/reset-password', wrap(AuthController.resetPassword));
authRouter.post('/change-password', authenticateToken, wrap(AuthController.changePassword));
authRouter.post('/refresh', wrap(AuthController.refresh));
authRouter.post('/logout', wrap(AuthController.logout));
