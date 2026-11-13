import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';

const client = postgres(process.env.DATABASE_URL, { max: 1 });
try {
  await migrate(drizzle(client), { migrationsFolder: '/app/drizzle' });
  console.log('PublishGuard 数据库迁移完成。');
} finally {
  await client.end();
}
