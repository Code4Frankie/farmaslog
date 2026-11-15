import { AppError } from '../utils/AppError.js';

export const validate = (schema, source = 'body') => (req, _res, next) => {
  const { error, value } = schema.validate(req[source], { abortEarly: false, stripUnknown: true, convert: true });
  if (error) {
    return next(
      new AppError(400, 'VALIDATION_ERROR', 'Request validation failed.', error.details.map((d) => d.message.replace(/"/g, "'"))),
    );
  }
  if (source === 'query') Object.defineProperty(req, 'query', { value, writable: true, configurable: true });
  else req[source] = value;
  return next();
};
