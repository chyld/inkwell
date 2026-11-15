export class AppError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public extra: Record<string, unknown> = {},
  ) {
    super(message);
  }
}

export const notFound = (what = 'Not found.') => new AppError(404, 'not_found', what);
export const badRequest = (message: string, code = 'invalid_request') => new AppError(400, code, message);
export const quotaExceeded = () =>
  new AppError(413, 'storage_limit', 'Your storage limit has been reached. Delete notes or images (and empty Trash) to free space.');
