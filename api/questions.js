// api/questions.js
// GET  /api/questions          → état de la base (public)
// GET  /api/questions?list=1   → toutes les questions, pour éviter les doublons (admin)
// POST /api/questions          → ajout de questions { questions: [...] } (admin)
// Admin = header "Authorization: Bearer <ADMIN_SECRET>"

import { getSql, ensureSchema, normalizeQuestion, isAdmin, TARGET_QUESTIONS } from '../lib/db.js';

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  try {
    await ensureSchema();
    const sql = getSql();

    if (req.method === 'GET') {
      if (req.query.list) {
        if (!isAdmin(req)) return res.status(401).json({ success: false, error: 'Non autorisé' });
        const rows = await sql`SELECT id, question, category FROM questions ORDER BY id`;
        return res.status(200).json({ success: true, questions: rows });
      }
      return res.status(200).json({ success: true, ...(await getStats(sql)) });
    }

    if (req.method === 'POST') {
      if (!isAdmin(req)) return res.status(401).json({ success: false, error: 'Non autorisé' });
      return await addQuestions(sql, req, res);
    }

    return res.status(405).json({ success: false, error: 'Méthode non autorisée' });
  } catch (error) {
    console.error('❌ Erreur:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
}

async function getStats(sql) {
  const byCategory = await sql`
    SELECT category, COUNT(*)::int AS count FROM questions GROUP BY category ORDER BY count DESC
  `;
  const count = byCategory.reduce((sum, c) => sum + c.count, 0);
  return {
    count,
    target: TARGET_QUESTIONS,
    remaining: Math.max(0, TARGET_QUESTIONS - count),
    byCategory
  };
}

async function addQuestions(sql, req, res) {
  const input = req.body?.questions;
  if (!Array.isArray(input) || input.length === 0) {
    return res.status(400).json({ success: false, error: 'Champ "questions" manquant ou vide' });
  }

  const { remaining } = await getStats(sql);
  const valid = [];
  const invalid = [];

  for (const q of input) {
    const ok = typeof q?.question === 'string' && q.question.trim() &&
      Array.isArray(q.options) && q.options.length === 4 &&
      q.options.every(o => typeof o === 'string' && o.trim()) &&
      new Set(q.options.map(o => o.trim().toLowerCase())).size === 4 &&
      Number.isInteger(q.correctAnswer) && q.correctAnswer >= 0 && q.correctAnswer <= 3 &&
      typeof q.category === 'string' && q.category.trim();
    if (ok) valid.push(q);
    else invalid.push(q?.question ?? null);
  }

  const inserted = [];
  const duplicates = [];

  for (const q of valid) {
    if (inserted.length >= remaining) break;
    const rows = await sql`
      INSERT INTO questions (question, normalized, options, correct_answer, category)
      VALUES (
        ${q.question.trim()}, ${normalizeQuestion(q.question)},
        ${sql.json(q.options.map(o => o.trim()))}, ${q.correctAnswer}, ${q.category.trim()}
      )
      ON CONFLICT (normalized) DO NOTHING
      RETURNING id
    `;
    if (rows.length) inserted.push(rows[0].id);
    else duplicates.push(q.question);
  }

  const stats = await getStats(sql);
  return res.status(200).json({
    success: true,
    added: inserted.length,
    duplicates,
    invalid,
    skippedTargetReached: valid.length - inserted.length - duplicates.length,
    count: stats.count,
    remaining: stats.remaining
  });
}
