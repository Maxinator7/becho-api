export class ApiError extends Error {
  public readonly statusCode: number;
  public readonly code: string;

  constructor(statusCode: number, code: string, message: string) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
    Object.setPrototypeOf(this, new.target.prototype);
  }

  static badRequest(message: string, code: string = 'BAD_REQUEST'): ApiError {
    return new ApiError(400, code, message);
  }

  static unauthorized(message: string = 'Unauthorized', code: string = 'UNAUTHORIZED'): ApiError {
    return new ApiError(401, code, message);
  }

  static forbidden(message: string = 'Forbidden', code: string = 'FORBIDDEN'): ApiError {
    return new ApiError(403, code, message);
  }

  static notFound(message: string = 'Resource not found', code: string = 'NOT_FOUND'): ApiError {
    return new ApiError(404, code, message);
  }

  static internal(message: string = 'Internal server error', code: string = 'INTERNAL_ERROR'): ApiError {
    return new ApiError(500, code, message);
  }
}
