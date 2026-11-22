'use strict';
const { env } = require('../config/env');

function notFoundApi(req, res) {
  res.status(404).json({ error: { code: 'not_found', message: 'Route not found' } });
}

// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  let status = err.status || err.statusCode || 500;
  let code = err.code && typeof err.code === 'string' ? err.code : 'server_error';
  let message = err.expose ? err.message : 'Something went wrong';

  if (err.name === 'ValidationError') { status = 400; code = 'validation_error'; message = Object.values(err.errors).map((e) => e.message).join(', '); }
  else if (err.name === 'CastError') { status = 400; code = 'invalid_id'; message = 'Invalid identifier'; }
  else if (err.code === 11000) { status = 409; code = 'duplicate'; message = 'A record with this value already exists'; }
  else if (err.type === 'entity.parse.failed') { status = 400; code = 'bad_json'; message = 'Invalid JSON body'; }
  else if (err.type === 'entity.too.large') { status = 413; code = 'too_large'; message = 'Request body too large'; }

  let ref;
  if (status >= 500) ref = require('../services/monitor').captureError(err, { kind: 'request', method: req.method, path: req.path, requestId: req.id, storeId: req.store ? String(req.store._id) : undefined });
  const body = { code, message: status >= 500 && env.isProd ? 'Something went wrong' : message };
  if (status >= 500) { body.requestId = req.id; body.ref = ref; } // quote this when reporting a problem; matches the log line
  if (err.expose && err.fields) body.fields = err.fields;
  if (err.expose && err.details) body.details = err.details;
  res.status(status).json({ error: body });
}

module.exports = { notFoundApi, errorHandler };
