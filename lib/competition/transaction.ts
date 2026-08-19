import type { PoolConnection } from "mysql2/promise";

export async function withCompetitionTransaction<T>(
  connection: PoolConnection,
  operation: (transaction: PoolConnection) => Promise<T>,
): Promise<T> {
  try {
    await connection.beginTransaction();
    const result = await operation(connection);
    await connection.commit();
    return result;
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}
