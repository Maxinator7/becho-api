import { Request, Response, NextFunction } from 'express';
import { AuthService } from './auth.service.js';
import { registerSchema, loginSchema, verifyOtpSchema, refreshTokenSchema } from './auth.schema.js';

export class AuthController {
  static async register(req: Request, res: Response, next: NextFunction) {
    try {
      const validated = registerSchema.parse(req.body);
      const result = await AuthService.register(validated);
      res.status(201).json({ success: true, data: result });
    } catch (err) {
      next(err);
    }
  }

  static async login(req: Request, res: Response, next: NextFunction) {
    try {
      const validated = loginSchema.parse(req.body);
      const result = await AuthService.login(validated);
      res.json({ success: true, data: result });
    } catch (err) {
      next(err);
    }
  }

  static async verifyOtp(req: Request, res: Response, next: NextFunction) {
    try {
      const validated = verifyOtpSchema.parse(req.body);
      const result = await AuthService.verifyOtp(req.user!.userId, validated);
      res.json({ success: true, data: result });
    } catch (err) {
      next(err);
    }
  }

  static async resendOtp(req: Request, res: Response, next: NextFunction) {
    try {
      const result = await AuthService.resendOtp(req.user!.userId);
      res.json({ success: true, data: result });
    } catch (err) {
      next(err);
    }
  }

  static async refresh(req: Request, res: Response, next: NextFunction) {
    try {
      const validated = refreshTokenSchema.parse(req.body);
      const tokens = await AuthService.refresh(validated.refreshToken);
      res.json({ success: true, data: tokens });
    } catch (err) {
      next(err);
    }
  }

  static async logout(req: Request, res: Response, next: NextFunction) {
    try {
      const { refreshToken } = req.body || {};
      const result = await AuthService.logout(typeof refreshToken === 'string' ? refreshToken : undefined);
      res.json({ success: true, data: result });
    } catch (err) {
      next(err);
    }
  }
}
