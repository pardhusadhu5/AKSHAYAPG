const fs = require('fs');
const path = require('path');

const projectRoot = path.join(__dirname, '..');
const controllersDir = path.join(projectRoot, 'controllers');
const files = fs.readdirSync(controllersDir);

function convertPlaceholders(sql) {
  let i = 1;
  return sql.replace(/\?/g, () => '$' + (i++));
}

for (const file of files) {
  if (!file.endsWith('.js')) continue;
  const filePath = path.join(controllersDir, file);
  let code = fs.readFileSync(filePath, 'utf8');

  // db.get
  code = code.replace(/await db\.get\(([\s\S]*?)\)/g, (match, args) => {
    const matchArgs = args.match(/([\s\S]*?)(?:,\s*(\[[\s\S]*?\]))?$/);
    if (matchArgs) {
      let sql = convertPlaceholders(matchArgs[1]);
      let params = matchArgs[2];
      if (params) {
        return `(await (async () => { const { rows } = await db.query(${sql}, ${params}); return rows[0]; })())`;
      } else {
        return `(await (async () => { const { rows } = await db.query(${sql}); return rows[0]; })())`;
      }
    }
    return match;
  });

  // db.all
  code = code.replace(/await db\.all\(([\s\S]*?)\)/g, (match, args) => {
    const matchArgs = args.match(/([\s\S]*?)(?:,\s*(\[[\s\S]*?\]))?$/);
    if (matchArgs) {
      let sql = convertPlaceholders(matchArgs[1]);
      let params = matchArgs[2];
      if (params) {
        return `(await (async () => { const { rows } = await db.query(${sql}, ${params}); return rows; })())`;
      } else {
        return `(await (async () => { const { rows } = await db.query(${sql}); return rows; })())`;
      }
    }
    return match;
  });

  // db.run
  code = code.replace(/await db\.run\(([\s\S]*?)\)/g, (match, args) => {
    const matchArgs = args.match(/([\s\S]*?)(?:,\s*(\[[\s\S]*?\]))?$/);
    if (matchArgs) {
      let sql = convertPlaceholders(matchArgs[1]);
      let params = matchArgs[2];
      if (params) {
        return `(await (async () => { 
          let _sql = ${sql}; 
          if (_sql.trim().toUpperCase().startsWith('INSERT') && !_sql.toUpperCase().includes('RETURNING')) { _sql += ' RETURNING id'; }
          const { rows, rowCount } = await db.query(_sql, ${params}); 
          return { lastID: rows.length > 0 ? rows[0].id : null, changes: rowCount };
        })())`;
      } else {
        return `(await (async () => { 
          let _sql = ${sql}; 
          if (_sql.trim().toUpperCase().startsWith('INSERT') && !_sql.toUpperCase().includes('RETURNING')) { _sql += ' RETURNING id'; }
          const { rows, rowCount } = await db.query(_sql); 
          return { lastID: rows.length > 0 ? rows[0].id : null, changes: rowCount };
        })())`;
      }
    }
    return match;
  });
  
  // db.exec (which might just execute a simple query string without params)
  code = code.replace(/await db\.exec\(([\s\S]*?)\)/g, "await db.query($1)");

  fs.writeFileSync(filePath, code);
}
