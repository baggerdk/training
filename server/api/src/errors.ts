// Errors the API returns to the app. message is Danish, since the app shows it to the user.
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export const unauthorized = () => new ApiError(401, 'unauthorized', 'Du er ikke logget ind');
export const forbidden = (message = 'Du har ikke rettighed til at gøre dette') => new ApiError(403, 'forbidden', message);
export const notFound = (message = 'Findes ikke') => new ApiError(404, 'not_found', message);
