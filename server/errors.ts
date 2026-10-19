export class HttpError extends Error {
  constructor(
    readonly status: 400 | 401 | 403 | 404 | 409 | 413 | 415 | 422 | 500,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = "HttpError";
  }
}

export const badRequest = (message: string, details?: unknown) => new HttpError(400, "bad_request", message, details);
export const unauthorized = (message = "Sign in again.") => new HttpError(401, "unauthorized", message);
export const forbidden = (code: string, message: string) => new HttpError(403, code, message);
export const notFound = (what = "That") => new HttpError(404, "not_found", `${what} was not found.`);
export const conflict = (code: string, message: string, details?: unknown) => new HttpError(409, code, message, details);
