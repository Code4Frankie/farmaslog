export class AppError extends Error {
  constructor(status, errorCode, message, details) {
    super(message);
    this.status = status;
    this.errorCode = errorCode;
    this.details = details;
  }
}
