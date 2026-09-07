import { readFile } from "node:fs/promises";
import { queryPostgres } from "../src/server/postgresClient";
for (const name of ["0002_tag_location_history.sql", "0003_room_decisions.sql"]) {
  await queryPostgres(await readFile(new URL(`../drizzle/${name}`, import.meta.url), "utf8"));
  console.log(`Applied ${name}`);
}
