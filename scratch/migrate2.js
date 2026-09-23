const fs = require('fs');
const path = require('path');
const controllersDir = path.join(__dirname, '..', 'controllers');

function convertPlaceholders(sql) {
  let i = 1;
  return sql.replace(/\?/g, () => '$' + (i++));
}

function processFile(filePath) {
  let code = fs.readFileSync(filePath, 'utf8');

  function replaceMethod(methodName) {
    let startIndex = 0;
    while (true) {
      let index = code.indexOf(`await db.${methodName}(`, startIndex);
      if (index === -1) break;
      
      let parenCount = 1;
      let i = index + `await db.${methodName}(`.length;
      let inString = false;
      let stringChar = '';
      
      for (; i < code.length; i++) {
        if (inString) {
          if (code[i] === stringChar && code[i-1] !== '\\') inString = false;
        } else {
          if (code[i] === "'" || code[i] === '"' || code[i] === '`') {
            inString = true;
            stringChar = code[i];
          } else if (code[i] === '(') {
            parenCount++;
          } else if (code[i] === ')') {
            parenCount--;
            if (parenCount === 0) break;
          }
        }
      }
      
      let argsStr = code.substring(index + `await db.${methodName}(`.length, i);
      argsStr = convertPlaceholders(argsStr);
      
      let replacement = '';
      if (methodName === 'get') {
         replacement = `(await (async () => { let args = [${argsStr}]; const { rows } = await db.query(args[0], args.slice(1).length ? args.slice(1)[0] : []); return rows[0]; })())`;
      } else if (methodName === 'all') {
         replacement = `(await (async () => { let args = [${argsStr}]; const { rows } = await db.query(args[0], args.slice(1).length ? args.slice(1)[0] : []); return rows; })())`;
      } else if (methodName === 'exec') {
         replacement = `await db.query(${argsStr})`;
      }

      code = code.substring(0, index) + replacement + code.substring(i + 1);
      startIndex = index + replacement.length;
    }
  }

  replaceMethod('get');
  replaceMethod('all');
  
  let startIndex = 0;
  while(true) {
      let index = code.indexOf(`await db.run(`, startIndex);
      if (index === -1) break;
      
      let parenCount = 1;
      let i = index + `await db.run(`.length;
      let inString = false;
      let stringChar = '';
      for (; i < code.length; i++) {
        if (inString) {
          if (code[i] === stringChar && code[i-1] !== '\\') inString = false;
        } else {
          if (code[i] === "'" || code[i] === '"' || code[i] === '`') {
            inString = true;
            stringChar = code[i];
          } else if (code[i] === '(') {
            parenCount++;
          } else if (code[i] === ')') {
            parenCount--;
            if (parenCount === 0) break;
          }
        }
      }
      
      let argsStr = code.substring(index + `await db.run(`.length, i);
      argsStr = convertPlaceholders(argsStr);
      
      let replacement = `(await (async () => {
         let args = [${argsStr}];
         let sql = args[0];
         let params = args.slice(1).length ? args.slice(1)[0] : [];
         if (sql.trim().toUpperCase().startsWith('INSERT') && !sql.toUpperCase().includes('RETURNING')) {
            sql += ' RETURNING id';
         }
         const { rows, rowCount } = await db.query(sql, params);
         return { lastID: rows.length > 0 ? rows[0].id : null, changes: rowCount };
      })())`;
      
      code = code.substring(0, index) + replacement + code.substring(i + 1);
      startIndex = index + replacement.length;
  }
  
  replaceMethod('exec');
  fs.writeFileSync(filePath, code);
}

for (const file of fs.readdirSync(controllersDir)) {
  if (file.endsWith('.js')) {
    processFile(path.join(controllersDir, file));
  }
}
