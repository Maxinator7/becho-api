import { Router } from 'express';
import { AuthController } from './auth.controller.js';

export const authRouter = Router();

authRouter.post('/register', AuthController.register);
authRouter.post('/login', AuthController.login);
authRouter.post('/verify-otp', AuthController.verifyOtp);
authRouter.post('/refresh', AuthController.refresh);
authRouter.post('/logout', AuthController.logout);
