class ApiError extends Error {
  constructor(status, message, details) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

const badRequest = (msg, details) => new ApiError(400, msg, details);
const unauthorized = (msg = "Unauthorized") => new ApiError(401, msg);
const forbidden = (msg = "Forbidden") => new ApiError(403, msg);
const notFound = (msg = "Not found") => new ApiError(404, msg);
const conflict = (msg = "Conflict") => new ApiError(409, msg);
const locked = (msg = "Locked due to too many failed attempts") => new ApiError(423, msg);

module.exports = { ApiError, badRequest, unauthorized, forbidden, notFound, conflict, locked };
