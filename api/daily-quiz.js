// api/daily-quiz.js
// GET /api/daily-quiz?date=YYYY-MM-DD → les 10 questions du jour, tirées de la base

import { getSql, ensureSchema, TARGET_QUESTIONS, QUESTIONS_PER_DAY } from '../lib/db.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ success: false, error: 'Méthode non autorisée' });
  }

  const date = /^\d{4}-\d{2}-\d{2}$/.test(req.query.date || '')
    ? req.query.date
    : new Date().toISOString().slice(0, 10);

  try {
    await ensureSchema();
    const sql = getSql();
    // Tirage sur les seuls ids, puis lecture des 10 questions retenues
    const rows = await sql`SELECT id FROM questions ORDER BY id`;

    if (rows.length < QUESTIONS_PER_DAY) {
      return res.status(503).json({ success: false, error: 'Pas assez de questions en base' });
    }

    const [year, month, day] = date.split('-').map(Number);
    let selected;
    if (rows.length >= TARGET_QUESTIONS) {
      // Base complète : ordre annuel identique pour tous → tranche exclusive par jour
      const dayOfYear = Math.floor((Date.UTC(year, month - 1, day) - Date.UTC(year, 0, 1)) / 86400000);
      const slot = dayOfYear % (TARGET_QUESTIONS / QUESTIONS_PER_DAY);
      selected = seededShuffle(rows, hashString(`year-${year}`))
        .slice(slot * QUESTIONS_PER_DAY, (slot + 1) * QUESTIONS_PER_DAY);
    } else {
      // Base en construction : tirage déterministe par jour
      selected = seededShuffle(rows, hashString(`day-${date}`)).slice(0, QUESTIONS_PER_DAY);
    }

    const ids = selected.map(r => r.id);
    const byId = new Map((await sql`
      SELECT id, question, options, correct_answer, category FROM questions WHERE id = ANY(${ids})
    `).map(q => [q.id, q]));

    // Le quiz d'une date donnée ne change qu'à l'ajout de questions → cache CDN 1 h
    res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate=600');
    return res.status(200).json({
      success: true,
      date,
      questions: ids.map(id => byId.get(id)).map(q => ({
        id: q.id,
        question: q.question,
        options: q.options,
        correctAnswer: q.correct_answer,
        category: q.category
      }))
    });
  } catch (error) {
    console.error('❌ Erreur:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
}

function hashString(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 16777619);
  }
  return h >>> 0;
}

// Fisher-Yates déterministe (même PRNG que l'ancienne sélection côté client)
function seededShuffle(arr, seed) {
  let s = ((seed ^ 0x9E3779B9) >>> 0) || 1;
  const rand = () => {
    s = Math.imul(s ^ (s >>> 16), 0x45d9f3b);
    s = (s ^ (s >>> 16)) >>> 0;
    return s / 4294967296;
  };
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
