// api/stats.js
// GET /api/stats → statistiques d'usage du quiz (lues par la domotique, voir docs/INTEGRATION-DOMOTIQUE.md)

import { getSql, ensureSchema, TARGET_QUESTIONS } from '../lib/db.js';

const HISTORY_DAYS = 14;

export default async function handler(req, res) {
  // Lisible depuis n'importe quelle origine (dashboard externe, domotique)
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET') {
    return res.status(405).json({ success: false, error: 'Méthode non autorisée' });
  }

  try {
    await ensureSchema();
    const sql = getSql();

    const [{ today }] = await sql`SELECT (now() AT TIME ZONE 'Europe/Paris')::date::text AS today`;
    const rows = await sql`
      SELECT day::text AS day, metric, value FROM daily_stats
    `;
    const [{ count }] = await sql`SELECT COUNT(*)::int AS count FROM questions`;

    // Jours relatifs à aujourd'hui (heure de Paris)
    const dayOffset = day => Math.round((Date.parse(today) - Date.parse(day)) / 86400000);
    const period = (from, to = 0) => summarize(rows.filter(r => {
      const d = dayOffset(r.day);
      return d >= to && d <= from;
    }));

    const history = [];
    for (let d = HISTORY_DAYS - 1; d >= 0; d--) {
      const date = new Date(Date.parse(today) - d * 86400000).toISOString().slice(0, 10);
      const { visits, completions } = summarize(rows.filter(r => r.day === date));
      history.push({ date, visits, completions });
    }

    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).json({
      success: true,
      updatedAt: new Date().toISOString(),
      today: period(0),
      yesterday: period(1, 1),
      last7Days: period(6),
      last30Days: period(29),
      allTime: summarize(rows),
      history,
      questions: { count, target: TARGET_QUESTIONS, remaining: Math.max(0, TARGET_QUESTIONS - count) }
    });
  } catch (error) {
    console.error('❌ Erreur:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
}

function summarize(rows) {
  const sum = metric => rows.filter(r => r.metric === metric).reduce((s, r) => s + r.value, 0);
  const visits = sum('visit');
  const completions = sum('complete');
  const scored = sum('scored');
  return {
    visits,
    completions,
    completionRate: visits ? Math.min(100, Math.round((completions / visits) * 100)) : 0,
    averageScore: scored ? Math.round((sum('score_sum') / scored) * 10) / 10 : null,
    shares: sum('share_whatsapp') + sum('share_x') + sum('share_copy')
  };
}
