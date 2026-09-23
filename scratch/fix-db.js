const fs = require('fs');
let c = fs.readFileSync('config/db.js', 'utf8');
c = c.replace(/\\`/g, '`');
fs.writeFileSync('config/db.js', c);
