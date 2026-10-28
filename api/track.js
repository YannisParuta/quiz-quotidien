// api/track.js
// POST /api/track { event, score? } → incrémente les compteurs anonymes du jour
// Aucune donnée personnelle : ni cookie, ni IP, ni identifiant stocké

import { getSql, ensureSchema, QUESTIONS_PER_DAY } from '../lib/db.js';

const EVENTS = ['visit', 'complete', 'share_whatsapp', 'share_x', 'share_copy'];

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Méthode non autorisée' });
  }

  const { event, score } = req.body || {};
  if (!EVENTS.includes(event)) {
    return res.status(400).json({ success: false, error: 'Événement inconnu' });
  }

  const metrics = { [event]: 1 };
  if (event === 'complete' && Number.isInteger(score) && score >= 0 && score <= QUESTIONS_PER_DAY) {
    metrics.score_sum = score;
    metrics.scored = 1;
  }

  try {
    await ensureSchema();
    const sql = getSql();
    for (const [metric, value] of Object.entries(metrics)) {
      await sql`
        INSERT INTO daily_stats (day, metric, value)
        VALUES ((now() AT TIME ZONE 'Europe/Paris')::date, ${metric}, ${value})
        ON CONFLICT (day, metric) DO UPDATE SET value = daily_stats.value + EXCLUDED.value
      `;
    }
    return res.status(204).end();
  } catch (error) {
    console.error('❌ Erreur:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
}
