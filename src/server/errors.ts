import "server-only";
export class AppError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}
export function denied(
  status = 403,
  code = "forbidden",
  message = "العملية دي مش متاحة لحسابك.",
): never {
  throw new AppError(status, code, message);
}
