// lib/db.js
// Accès à la base Postgres (Neon via le Marketplace Vercel) qui stocke les questions

import postgres from 'postgres';
import { timingSafeEqual } from 'node:crypto';

// Objectif : 365 jours × 10 questions → une année complète sans répétition
export const TARGET_QUESTIONS = 3650;
export const QUESTIONS_PER_DAY = 10;

let client;
let schemaReady;

export function getSql() {
  if (!client) {
    const url = process.env.DATABASE_URL || process.env.POSTGRES_URL;
    if (!url) throw new Error('DATABASE_URL non configurée');
    client = postgres(url, { max: 1, onnotice: () => {} });
  }
  return client;
}

export async function ensureSchema() {
  if (!schemaReady) {
    const sql = getSql();
    schemaReady = sql`
      CREATE TABLE IF NOT EXISTS questions (
        id             SERIAL PRIMARY KEY,
        question       TEXT NOT NULL,
        normalized     TEXT NOT NULL UNIQUE,
        options        JSONB NOT NULL,
        correct_answer SMALLINT NOT NULL CHECK (correct_answer BETWEEN 0 AND 3),
        category       TEXT NOT NULL,
        created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `.catch(err => { schemaReady = null; throw err; });
  }
  return schemaReady;
}

export function normalizeQuestion(question) {
  return question
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^\w\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// Vérifie le header "Authorization: Bearer <ADMIN_SECRET>"
export function isAdmin(req) {
  const secret = process.env.ADMIN_SECRET;
  const header = req.headers.authorization || '';
  if (!secret || !header.startsWith('Bearer ')) return false;
  const given = Buffer.from(header.slice(7));
  const expected = Buffer.from(secret);
  return given.length === expected.length && timingSafeEqual(given, expected);
}
