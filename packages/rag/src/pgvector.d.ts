declare module "pgvector/pg" {
  import type { Pool } from "pg";

  export function registerType(pool: Pool): Promise<void>;
  export function toSql(vector: number[]): unknown;
}
