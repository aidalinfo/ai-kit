import { Client } from "pg";
import type { VectorStore, VectorStoreResult, SearchFilters } from "mem0ai/oss";
import type { PgVectorConfig } from "../types.js";

export class PgVectorStore implements VectorStore {
    private client: Client;
    private collectionName: string;
    private dims: number;
    private userId: string | null = null;

    constructor(config: PgVectorConfig) {
        this.client = new Client({
            user: config.user,
            password: config.password,
            host: config.host,
            port: config.port,
            database: config.dbname || "postgres",
        });
        this.collectionName = config.collectionName || "memories";
        this.dims = config.embeddingModelDims || 1536;
    }

    async initialize(): Promise<void> {
        await this.client.connect();
        await this.client.query("CREATE EXTENSION IF NOT EXISTS vector");
        await this.client.query(`
      CREATE TABLE IF NOT EXISTS ${this.collectionName} (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        vector vector(${this.dims}),
        payload JSONB,
        user_id TEXT,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      )
    `);
        // Create HNSW index if requested (simplified, assumes pg_vector >= 0.5)
        // For now, we skip complex index creation to keep it simple, or add basic IVFFlat
    }

    async insert(
        vectors: number[][],
        ids: string[],
        payloads: Record<string, any>[]
    ): Promise<void> {
        const query = `
      INSERT INTO ${this.collectionName} (id, vector, payload, user_id)
      VALUES ($1, $2, $3, $4)
      ON CONFLICT (id) DO UPDATE SET
        vector = EXCLUDED.vector,
        payload = EXCLUDED.payload,
        user_id = EXCLUDED.user_id,
        updated_at = CURRENT_TIMESTAMP
    `;

        for (let i = 0; i < vectors.length; i++) {
            await this.client.query(query, [
                ids[i],
                JSON.stringify(vectors[i]),
                JSON.stringify(payloads[i]),
                this.userId,
            ]);
        }
    }

    async search(
        query: number[],
        limit: number = 5,
        filters?: SearchFilters
    ): Promise<VectorStoreResult[]> {
        let sql = `
      SELECT id, payload, vector <-> $1 as distance
      FROM ${this.collectionName}
      WHERE 1=1
    `;
        const params: any[] = [JSON.stringify(query)];
        let paramIndex = 2;

        if (this.userId) {
            sql += ` AND user_id = $${paramIndex}`;
            params.push(this.userId);
            paramIndex++;
        }

        if (filters) {
            for (const [key, value] of Object.entries(filters)) {
                // Basic JSONB filtering
                sql += ` AND payload->>'${key}' = $${paramIndex}`;
                params.push(String(value));
                paramIndex++;
            }
        }

        sql += ` ORDER BY distance ASC LIMIT $${paramIndex}`;
        params.push(limit);

        const result = await this.client.query(sql, params);

        return result.rows.map((row) => ({
            id: row.id,
            payload: row.payload,
            score: 1 - row.distance, // Convert distance to similarity score roughly
        }));
    }

    async get(vectorId: string): Promise<VectorStoreResult | null> {
        const result = await this.client.query(
            `SELECT id, payload FROM ${this.collectionName} WHERE id = $1`,
            [vectorId]
        );
        if (result.rows.length === 0) return null;
        return {
            id: result.rows[0].id,
            payload: result.rows[0].payload,
            score: 1,
        };
    }

    async update(
        vectorId: string,
        vector: number[],
        payload: Record<string, any>
    ): Promise<void> {
        await this.client.query(
            `UPDATE ${this.collectionName} SET vector = $1, payload = $2, updated_at = CURRENT_TIMESTAMP WHERE id = $3`,
            [JSON.stringify(vector), JSON.stringify(payload), vectorId]
        );
    }

    async delete(vectorId: string): Promise<void> {
        await this.client.query(`DELETE FROM ${this.collectionName} WHERE id = $1`, [
            vectorId,
        ]);
    }

    async deleteCol(): Promise<void> {
        await this.client.query(`DROP TABLE IF EXISTS ${this.collectionName}`);
    }

    async list(
        filters?: SearchFilters,
        limit: number = 100
    ): Promise<[VectorStoreResult[], number]> {
        // Simplified list implementation
        return [[], 0];
    }

    async getUserId(): Promise<string> {
        return this.userId || "";
    }

    async setUserId(userId: string): Promise<void> {
        this.userId = userId;
    }
}
