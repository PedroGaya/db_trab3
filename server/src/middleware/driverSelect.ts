import type { RequestHandler } from "express";
import { z } from "zod";
import type { Stores } from "../drivers";
import type { DataStore } from "../model/DataStore";
import { DbNameSchema } from "../model/schemas";
import { parse } from "./validate";

declare global {
  namespace Express {
    interface Locals {
      store: DataStore;
    }
  }
}

const DbQuerySchema = z.object({ db: DbNameSchema });

export function driverSelect(stores: Stores): RequestHandler {
  return (req, res, next) => {
    const { db } = parse(DbQuerySchema, req.query);
    res.locals.store = stores[db];
    next();
  };
}
