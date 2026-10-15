const fs = require('fs');
const path = require('path');

// Lê o ficheiro app.js
const appJsPath = path.join(__dirname, 'app.js');
let content = fs.readFileSync(appJsPath, 'utf-8');

// Substitui o placeholder da API key pelo valor da variável de ambiente
// Só substitui se o placeholder ainda estiver no ficheiro (evita substituição dupla)
if (content.includes('__FIREBASE_API_KEY__')) {
  const apiKey = process.env.FIREBASE_API_KEY;
  console.log('[Build] FIREBASE_API_KEY env var:', apiKey ? `"${apiKey}" (length: ${apiKey.length})` : 'NOT SET');
  
  if (!apiKey || apiKey.trim() === '') {
    console.log('[Build] WARNING: FIREBASE_API_KEY is empty or not set. Using fallback.');
    const fallbackKey = 'REPLACE_API_KEY';
    content = content.replace(/__FIREBASE_API_KEY__/g, fallbackKey);
  } else {
    console.log('[Build] Replacing placeholder with API key...');
    content = content.replace(/__FIREBASE_API_KEY__/g, apiKey.trim());
  }
} else {
  console.log('[Build] Placeholder already replaced. Skipping.');
  process.exit(0);
}

// Escreve o ficheiro app.js com o valor substituído
fs.writeFileSync(appJsPath, content, 'utf-8');

console.log('Build completed successfully. Firebase API key updated.');
