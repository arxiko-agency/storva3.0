'use strict';
class AppError extends Error {
  constructor(message, status = 400, code = 'bad_request', extra = {}) {
    super(message);
    this.status = status;
    this.code = code;
    this.expose = true;
    if (extra.fields) this.fields = extra.fields;   // per-field validation messages
    if (extra.details) this.details = extra.details; // small, non-secret hints for the UI
  }
}
module.exports = AppError;
