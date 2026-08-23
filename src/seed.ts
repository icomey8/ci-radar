import { db, pool } from "./db.js";
import { users } from "./schema.js";

const [existing] = await db.select().from(users).limit(1);

if (existing) {
  console.log(`User ${existing.id} already exists.`);
} else {
  const [created] = await db.insert(users).values({}).returning();
  console.log(`Created user ${created!.id}.`);
}

await pool.end();
