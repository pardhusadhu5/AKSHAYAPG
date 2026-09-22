const sqlite3 = require('sqlite3');
const { open } = require('sqlite');
const path = require('path');

async function inspectTriggers() {
  const dbPath = path.join(__dirname, '..', 'database.db');
  const db = await open({
    filename: dbPath,
    driver: sqlite3.Database
  });

  const triggers = await db.all("SELECT type, name, tbl_name, sql FROM sqlite_master WHERE sql LIKE '%students_old%' OR sql LIKE '%beds_old%'");
  console.log('Triggers/Views referencing _old:', JSON.stringify(triggers, null, 2));

  const allMaster = await db.all("SELECT type, name, tbl_name, sql FROM sqlite_master WHERE type IN ('trigger', 'view')");
  console.log('All Triggers & Views:', JSON.stringify(allMaster, null, 2));

  await db.close();
}

inspectTriggers().catch(console.error);
