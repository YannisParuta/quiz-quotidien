// scripts/seed.js
// Import unique des questions de questions.json dans la base, via l'API
// Usage : API_URL=https://www.quiz-quotidien.fr ADMIN_SECRET=xxx node scripts/seed.js

import { readFileSync } from 'node:fs';

const apiUrl = process.env.API_URL || 'https://www.quiz-quotidien.fr';
const secret = process.env.ADMIN_SECRET;
if (!secret) throw new Error('ADMIN_SECRET manquant');

const data = JSON.parse(readFileSync(new URL('../questions.json', import.meta.url), 'utf8'));
const all = [...data.questions, ...(data.archivedQuestions || [])];
console.log(`📥 ${all.length} questions à importer`);

for (let i = 0; i < all.length; i += 100) {
  const batch = all.slice(i, i + 100).map(({ question, options, correctAnswer, category }) =>
    ({ question, options, correctAnswer, category }));
  const response = await fetch(`${apiUrl}/api/questions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${secret}` },
    body: JSON.stringify({ questions: batch })
  });
  const result = await response.json();
  if (!response.ok) throw new Error(JSON.stringify(result));
  console.log(`✅ +${result.added} (doublons : ${result.duplicates.length}, invalides : ${result.invalid.length}) → ${result.count} en base`);
}
