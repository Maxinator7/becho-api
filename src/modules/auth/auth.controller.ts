import { Request, Response } from 'express';
import { AuthService } from './auth.service.js';
import {
  changePasswordSchema,
  forgotPasswordSchema,
  loginSchema,
  refreshTokenSchema,
  registerSchema,
  resetPasswordSchema,
  verifyOtpSchema,
} from './auth.schema.js';

export class AuthController {
  static async register(req: Request, res: Response) {
    res.status(201).json({ success: true, data: await AuthService.register(registerSchema.parse(req.body)) });
  }

  static async login(req: Request, res: Response) {
    res.json({ success: true, data: await AuthService.login(loginSchema.parse(req.body)) });
  }

  static async verifyOtp(req: Request, res: Response) {
    res.json({ success: true, data: await AuthService.verifyOtp(req.user!.userId, verifyOtpSchema.parse(req.body)) });
  }

  static async resendOtp(req: Request, res: Response) {
    res.json({ success: true, data: await AuthService.resendOtp(req.user!.userId) });
  }

  static async forgotPassword(req: Request, res: Response) {
    const { identifier } = forgotPasswordSchema.parse(req.body);
    res.json({ success: true, data: await AuthService.forgotPassword(identifier) });
  }

  static async resetPassword(req: Request, res: Response) {
    res.json({ success: true, data: await AuthService.resetPassword(resetPasswordSchema.parse(req.body)) });
  }

  static async changePassword(req: Request, res: Response) {
    const input = changePasswordSchema.parse(req.body);
    const current = typeof req.body?.refreshToken === 'string' ? req.body.refreshToken : undefined;
    res.json({ success: true, data: await AuthService.changePassword(req.user!.userId, input, current) });
  }

  static async refresh(req: Request, res: Response) {
    res.json({ success: true, data: await AuthService.refresh(refreshTokenSchema.parse(req.body).refreshToken) });
  }

  static async logout(req: Request, res: Response) {
    const { refreshToken } = req.body || {};
    res.json({ success: true, data: await AuthService.logout(typeof refreshToken === 'string' ? refreshToken : undefined) });
  }
}
