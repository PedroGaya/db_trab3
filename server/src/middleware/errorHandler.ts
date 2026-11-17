import type { ErrorRequestHandler, RequestHandler } from "express";
import { AppError } from "../model/errors";

export const notFound: RequestHandler = (req, res) => {
  res.status(404).json({
    error: {
      code: "NOT_FOUND",
      message: `Route ${req.method} ${req.path} not found`,
    },
  });
};

export const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  if (err instanceof AppError) {
    res.status(err.status).json({
      error: {
        code: err.code,
        message: err.message,
        ...(err.details !== undefined && { details: err.details }),
      },
    });
    return;
  }
  if (err?.type === "entity.parse.failed") {
    res
      .status(400)
      .json({ error: { code: "VALIDATION", message: "Malformed JSON body" } });
    return;
  }
  console.error(err);
  res
    .status(500)
    .json({ error: { code: "INTERNAL", message: "Internal server error" } });
};
