const fs = require('fs');
const path = require('path');

// Lê o ficheiro app.js
const appJsPath = path.join(__dirname, 'app.js');
let content = fs.readFileSync(appJsPath, 'utf-8');

// Substitui o placeholder da API key pelo valor da variável de ambiente
// Só substitui se o placeholder ainda estiver no ficheiro (evita substituição dupla)
if (content.includes('__FIREBASE_API_KEY__')) {
  const apiKey = process.env.FIREBASE_API_KEY || 'REPLACE_API_KEY';
  content = content.replace(/__FIREBASE_API_KEY__/g, apiKey);
} else {
  console.log('Placeholder already replaced. Skipping.');
  process.exit(0);
}

// Escreve o ficheiro app.js com o valor substituído
fs.writeFileSync(appJsPath, content, 'utf-8');

console.log('Build completed successfully. Firebase API key updated.');
