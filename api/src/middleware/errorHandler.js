import mongoose from 'mongoose';
import { AppError } from '../utils/AppError.js';
import { logger } from '../utils/logger.js';

export const notFound = (_req, _res, next) => next(new AppError(404, 'ROUTE_NOT_FOUND', 'Route not found.'));

export function errorHandler(err, req, res, _next) {
  let status = err.status || 500;
  let errorCode = err.errorCode || 'INTERNAL_ERROR';
  let message = err.message;
  let details = err.details;

  if (err.type === 'entity.parse.failed') {
    status = 400; errorCode = 'INVALID_JSON'; message = 'Request body is not valid JSON.';
  } else if (err.type === 'entity.too.large') {
    status = 413; errorCode = 'PAYLOAD_TOO_LARGE'; message = 'Request body is too large.';
  } else if (err instanceof mongoose.Error.CastError) {
    status = 400; errorCode = 'INVALID_ID'; message = 'Invalid identifier.';
  } else if (err instanceof mongoose.Error.ValidationError) {
    status = 400; errorCode = 'VALIDATION_ERROR'; message = 'Validation failed.';
    details = Object.values(err.errors).map((e) => e.message);
  } else if (err.code === 11000) {
    status = 409; errorCode = 'DUPLICATE_RECORD'; message = 'A record with these unique values already exists.';
  } else if (err.name === 'MulterError') {
    status = 400;
    errorCode = err.code === 'LIMIT_FILE_SIZE' ? 'FILE_TOO_LARGE' : 'UPLOAD_ERROR';
    message = err.code === 'LIMIT_FILE_SIZE' ? 'File exceeds the 5 MB limit.' : 'Upload failed.';
  }

  if (status >= 500) {
    logger.error('unhandled_error', { requestId: req.id, path: req.path, stack: err.stack });
    errorCode = 'INTERNAL_ERROR';
    message = 'Something went wrong. Quote the requestId when contacting support.';
    details = undefined;
  }
  if (err.retryAfterSeconds != null) res.set('Retry-After', String(err.retryAfterSeconds));

  res.status(status).json({
    errorCode,
    message,
    requestId: req.id,
    ...(details ? { details } : {}),
    ...(err.retryAfterSeconds != null ? { retryAfterSeconds: err.retryAfterSeconds } : {}),
  });
}
