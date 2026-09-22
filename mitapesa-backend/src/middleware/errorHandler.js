const { ApiError } = require("../lib/errors");

// Wrap async route handlers so thrown/rejected errors reach errorHandler
// instead of crashing the process.
const asyncHandler = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

function notFoundHandler(req, res) {
  res.status(404).json({ error: "Route not found" });
}

// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  if (err instanceof ApiError) {
    return res.status(err.status).json({ error: err.message, details: err.details });
  }
  console.error(err); // eslint-disable-line no-console
  res.status(500).json({ error: "Internal server error" });
}

module.exports = { asyncHandler, notFoundHandler, errorHandler };
