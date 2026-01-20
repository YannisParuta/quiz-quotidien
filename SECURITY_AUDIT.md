# 🔒 Audit de Sécurité - Quiz Quotidien
**Date:** 2026-01-20
**Site:** https://quiz-quotidien.fr
**Statut:** ⚠️ Plusieurs vulnérabilités critiques identifiées

---

## 📊 Résumé Exécutif

| Niveau de Gravité | Nombre | Détails |
|-------------------|--------|---------|
| 🔴 **Critique** | 3 | Nécessite une action immédiate |
| 🟠 **Élevé** | 5 | À corriger rapidement |
| 🟡 **Moyen** | 6 | À planifier |
| 🔵 **Faible** | 4 | Amélioration recommandée |

**Score de Sécurité Global:** 4.5/10

---

## 🔴 VULNÉRABILITÉS CRITIQUES

### 1. CVE-2025-27789 - Babel Standalone 7.23.5 (ReDoS)
**Gravité:** 🔴 CRITIQUE
**Localisation:** `index.html:20`
**CVE:** CVE-2025-27789

**Description:**
```html
<script src="https://cdnjs.cloudflare.com/ajax/libs/babel-standalone/7.23.5/babel.min.js"></script>
```

La version Babel 7.23.5 contient une vulnérabilité de complexité d'expression régulière (ReDoS - Regular Expression Denial of Service) qui peut permettre à un attaquant de bloquer le navigateur avec du code JavaScript malveillant.

**Impact:**
- Déni de service côté client
- Blocage du navigateur des utilisateurs
- Exploitation possible via des questions malveillantes

**Solution:**
```html
<!-- Mettre à jour vers Babel 7.26.10+ -->
<script src="https://cdnjs.cloudflare.com/ajax/libs/babel-standalone/7.26.10/babel.min.js"></script>
```

**Recommandation:** Migrer vers un système de build (Vite, Webpack) pour éviter complètement Babel Standalone.

---

### 2. Absence de Subresource Integrity (SRI)
**Gravité:** 🔴 CRITIQUE
**Localisation:** `index.html:18-21`

**Description:**
Tous les scripts CDN sont chargés sans vérification d'intégrité. Si un CDN est compromis, du code malveillant pourrait être injecté.

**Scripts vulnérables:**
```html
<script src="https://cdnjs.cloudflare.com/ajax/libs/react/18.2.0/umd/react.production.min.js"></script>
<script src="https://cdnjs.cloudflare.com/ajax/libs/react-dom/18.2.0/umd/react-dom.production.min.js"></script>
<script src="https://cdnjs.cloudflare.com/ajax/libs/babel-standalone/7.23.5/babel.min.js"></script>
<script src="https://cdn.tailwindcss.com"></script>
```

**Impact:**
- Injection de code malveillant si CDN compromis
- Vol de données utilisateurs (localStorage, analytics)
- Redirection vers sites de phishing
- Cryptojacking

**Solution:**
```html
<script
  src="https://cdnjs.cloudflare.com/ajax/libs/react/18.2.0/umd/react.production.min.js"
  integrity="sha512-..."
  crossorigin="anonymous">
</script>
```

---

### 3. Absence de Content Security Policy (CSP)
**Gravité:** 🔴 CRITIQUE
**Localisation:** Headers HTTP manquants

**Description:**
Aucune politique de sécurité du contenu (CSP) n'est définie, permettant l'exécution de scripts inline et le chargement de ressources depuis n'importe quelle source.

**Impact:**
- Vulnérabilité XSS (Cross-Site Scripting)
- Injection de scripts tiers malveillants
- Clickjacking
- Data exfiltration

**Solution:**
Ajouter un fichier `_headers` pour GitHub Pages:
```
/*
  Content-Security-Policy: default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval' https://cdnjs.cloudflare.com https://cdn.tailwindcss.com https://www.googletagmanager.com; style-src 'self' 'unsafe-inline' https://cdn.tailwindcss.com; img-src 'self' data:; connect-src 'self' https://www.google-analytics.com;
  X-Frame-Options: DENY
  X-Content-Type-Options: nosniff
  Referrer-Policy: strict-origin-when-cross-origin
  Permissions-Policy: geolocation=(), microphone=(), camera=()
```

---

## 🟠 VULNÉRABILITÉS ÉLEVÉES

### 4. Potentiel XSS via questions.json
**Gravité:** 🟠 ÉLEVÉ
**Localisation:** `index.html:390, 420`

**Description:**
Les questions sont affichées directement sans sanitization:
```javascript
<h2 className="text-2xl font-semibold text-gray-800 mb-6">
    {dailyQuiz[currentQuestion].question}
</h2>
<span className="font-medium">{option}</span>
```

Si `questions.json` est modifié (accès GitHub, man-in-the-middle), du code JavaScript malveillant pourrait être injecté.

**Preuve de Concept:**
```json
{
  "question": "<img src=x onerror='alert(document.cookie)'>",
  "options": ["A", "B", "C", "D"],
  "correctAnswer": 0
}
```

**Impact:**
- Vol de données localStorage
- Redirection malveillante
- Modification du DOM
- Vol de session analytics

**Solution:**
```javascript
// Ajouter une fonction de sanitization
const sanitizeHTML = (str) => {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
};

// Utiliser dans le rendu
<h2>{sanitizeHTML(dailyQuiz[currentQuestion].question)}</h2>
```

Ou utiliser une bibliothèque comme DOMPurify.

---

### 5. Absence de Validation du Schéma JSON
**Gravité:** 🟠 ÉLEVÉ
**Localisation:** `index.html:161-163`

**Description:**
Aucune validation de la structure JSON chargée:
```javascript
const data = await response.json();
const allQuestions = data.questions;
setTotalQuestions(allQuestions.length);
```

Un fichier JSON malformé ou malveillant pourrait crasher l'application ou causer des comportements inattendus.

**Solution:**
```javascript
// Validation du schéma
const validateQuestions = (data) => {
  if (!data || !Array.isArray(data.questions)) {
    throw new Error('Format JSON invalide');
  }

  data.questions.forEach((q, index) => {
    if (!q.question || !Array.isArray(q.options) ||
        typeof q.correctAnswer !== 'number' ||
        q.correctAnswer < 0 || q.correctAnswer >= q.options.length) {
      throw new Error(`Question ${index} invalide`);
    }
  });

  return true;
};

const data = await response.json();
validateQuestions(data);
const allQuestions = data.questions;
```

---

### 6. Dépendances Obsolètes
**Gravité:** 🟠 ÉLEVÉ
**Localisation:** `index.html:18-21`

**Versions actuelles:**
- React 18.2.0 (dernière: 19.2.3)
- Babel 7.23.5 (dernière: 7.26.10)

**Risques:**
- Vulnérabilités de sécurité non patchées
- Bugs connus non corrigés
- Incompatibilités futures

**Solution:**
```html
<script src="https://cdnjs.cloudflare.com/ajax/libs/react/18.3.1/umd/react.production.min.js"></script>
<script src="https://cdnjs.cloudflare.com/ajax/libs/react-dom/18.3.1/umd/react-dom.production.min.js"></script>
<script src="https://cdnjs.cloudflare.com/ajax/libs/babel-standalone/7.26.10/babel.min.js"></script>
```

---

### 7. Absence de Protection HTTPS
**Gravité:** 🟠 ÉLEVÉ
**Localisation:** Configuration serveur

**Description:**
Pas de redirection HTTP → HTTPS forcée, pas de HSTS.

**Solution:**
Ajouter dans `_headers`:
```
/*
  Strict-Transport-Security: max-age=31536000; includeSubDomains; preload
```

---

### 8. Google Analytics sans Consentement
**Gravité:** 🟠 ÉLEVÉ (RGPD)
**Localisation:** `index.html:10-16`

**Description:**
Google Analytics est chargé sans consentement utilisateur, violation du RGPD.

**Solution:**
Implémenter un système de consentement:
```javascript
// Charger GA uniquement après consentement
function loadAnalytics() {
  if (localStorage.getItem('analytics-consent') === 'true') {
    const script = document.createElement('script');
    script.src = 'https://www.googletagmanager.com/gtag/js?id=G-XHE708K9TT';
    document.head.appendChild(script);
    // ... reste du code GA
  }
}

// Afficher une bannière de cookies
```

---

## 🟡 VULNÉRABILITÉS MOYENNES

### 9. LocalStorage Pollution
**Gravité:** 🟡 MOYEN
**Localisation:** `index.html:126, 198`

**Description:**
Pas de limite sur la taille du cache localStorage:
```javascript
localStorage.setItem(dateKey, JSON.stringify(cacheData));
```

Un attaquant pourrait remplir le localStorage pour causer un DoS.

**Solution:**
```javascript
try {
  const oldSize = JSON.stringify(localStorage).length;
  if (oldSize > 5000000) { // 5MB limite
    localStorage.clear();
  }
  localStorage.setItem(dateKey, JSON.stringify(cacheData));
} catch (e) {
  if (e.name === 'QuotaExceededError') {
    localStorage.clear();
    localStorage.setItem(dateKey, JSON.stringify(cacheData));
  }
}
```

---

### 10. Exposition de l'ID Google Analytics
**Gravité:** 🟡 MOYEN
**Localisation:** `index.html:15`

**Description:**
```javascript
gtag('config', 'G-XHE708K9TT');
```

L'ID Analytics est exposé dans le code source, permettant à des tiers de polluer vos données.

**Impact:**
- Spam dans les analytics
- Fausses statistiques
- Pollution des données

**Solution:**
- Configurer des filtres dans Google Analytics
- Utiliser GA4 avec des mesures de sécurité renforcées
- Implémenter une vérification de domaine

---

### 11. Console.log en Production
**Gravité:** 🟡 MOYEN
**Localisation:** Multiples (lignes 87, 100, 102, 152, 155, etc.)

**Description:**
De nombreux console.log sont présents:
```javascript
console.log('=== DÉMARRAGE DU COMPOSANT DAILYQUIZ ===');
console.log('États initialisés');
console.log('=== RENDER ===');
```

**Risques:**
- Fuite d'informations techniques
- Impact sur les performances
- Messages debug exploitables

**Solution:**
```javascript
// Créer une fonction de logging conditionnelle
const isDev = window.location.hostname === 'localhost';
const log = isDev ? console.log : () => {};

log('=== DÉMARRAGE DU COMPOSANT DAILYQUIZ ===');
```

Ou supprimer tous les console.log en production avec un minifier.

---

### 12. Pas de Gestion d'Erreur Fetch
**Gravité:** 🟡 MOYEN
**Localisation:** `index.html:153`

**Description:**
```javascript
const response = await fetch('questions.json');
if (!response.ok) {
    throw new Error(`Impossible de charger les questions (status: ${response.status})`);
}
```

Pas de retry, pas de fallback, pas de timeout.

**Solution:**
```javascript
const fetchWithTimeout = async (url, timeout = 5000) => {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeout);

  try {
    const response = await fetch(url, { signal: controller.signal });
    clearTimeout(id);
    return response;
  } catch (error) {
    clearTimeout(id);
    throw error;
  }
};

// Avec retry
for (let i = 0; i < 3; i++) {
  try {
    const response = await fetchWithTimeout('questions.json');
    if (response.ok) break;
  } catch (e) {
    if (i === 2) throw e;
    await new Promise(r => setTimeout(r, 1000 * (i + 1)));
  }
}
```

---

### 13. Absence de Rate Limiting
**Gravité:** 🟡 MOYEN
**Localisation:** Général

**Description:**
Pas de protection contre le scraping ou les requêtes excessives.

**Impact:**
- Vol de la base de questions
- Surcharge serveur GitHub Pages
- Abus du quota GitHub

**Solution:**
- Implémenter Cloudflare (gratuit)
- Ajouter un rate limiting côté client
- Obfusquer questions.json

---

### 14. Tailwind CDN en Production
**Gravité:** 🟡 MOYEN
**Localisation:** `index.html:21`

**Description:**
```html
<script src="https://cdn.tailwindcss.com"></script>
```

Tailwind CDN génère les styles à la volée côté client, causant:
- FOUC (Flash of Unstyled Content)
- ~3MB de JavaScript inutile
- Performance dégradée

**Solution:**
Utiliser Tailwind CLI ou PostCSS pour générer un CSS statique.

---

## 🔵 VULNÉRABILITÉS FAIBLES

### 15. Absence de Favicon HTTPS
**Gravité:** 🔵 FAIBLE
**Localisation:** `index.html:7`

**Description:**
```html
<link rel="icon" type="image/png" href="favicon.png">
```

Pas de chemin absolu ni de vérification HTTPS.

---

### 16. Pas de Meta Description
**Gravité:** 🔵 FAIBLE (SEO/Sécurité)
**Localisation:** `index.html:3-7`

**Description:**
Absence de meta tags de sécurité:
```html
<meta http-equiv="X-UA-Compatible" content="IE=edge">
<meta name="description" content="Quiz quotidien - 10 nouvelles questions chaque jour">
```

---

### 17. Algorithme de Rotation Prévisible
**Gravité:** 🔵 FAIBLE
**Localisation:** `index.html:172-191`

**Description:**
```javascript
const dayOfYear = Math.floor(diff / 86400000);
const startIndex = (dayOfYear * 10) % allQuestions.length;
```

L'algorithme de sélection des questions est entièrement prévisible. Un utilisateur peut connaître les questions du lendemain.

**Solution:**
```javascript
// Utiliser un hash de la date + une clé secrète
const crypto = window.crypto || window.msCrypto;
const dateStr = `${today.getFullYear()}-${today.getMonth()}-${today.getDate()}`;
const encoder = new TextEncoder();
const data = encoder.encode(dateStr + 'SECRET_KEY_HERE');
const hashBuffer = await crypto.subtle.digest('SHA-256', data);
const hashArray = Array.from(new Uint8Array(hashBuffer));
const seed = hashArray.reduce((acc, val) => acc + val, 0);
const startIndex = (seed * 10) % allQuestions.length;
```

---

### 18. Absence de robots.txt
**Gravité:** 🔵 FAIBLE
**Localisation:** Fichier manquant

**Description:**
Pas de `robots.txt` pour protéger certains endpoints.

**Solution:**
Créer `/robots.txt`:
```
User-agent: *
Allow: /
Disallow: /questions.json

Sitemap: https://quiz-quotidien.fr/sitemap.xml
```

---

## 🛠️ PLAN D'ACTION RECOMMANDÉ

### Phase 1: Urgence Immédiate (Aujourd'hui)
1. ✅ Mettre à jour Babel vers 7.26.10+
2. ✅ Ajouter SRI sur tous les scripts CDN
3. ✅ Ajouter Content-Security-Policy
4. ✅ Implémenter validation JSON

### Phase 2: Court Terme (Cette semaine)
5. ✅ Mettre à jour React vers 18.3.1
6. ✅ Ajouter sanitization XSS
7. ✅ Implémenter consentement RGPD
8. ✅ Supprimer console.log

### Phase 3: Moyen Terme (Ce mois)
9. ✅ Migrer vers build system (Vite)
10. ✅ Remplacer Tailwind CDN par CSS statique
11. ✅ Ajouter retry/timeout sur fetch
12. ✅ Implémenter Cloudflare

### Phase 4: Long Terme (Prochain trimestre)
13. ✅ Migration vers React 19.x
14. ✅ Ajout d'authentification (optionnel)
15. ✅ Backend API pour questions (optionnel)
16. ✅ Tests de sécurité automatisés

---

## 📋 CHECKLIST DE SÉCURITÉ

### Headers HTTP
- [ ] Content-Security-Policy
- [ ] X-Frame-Options: DENY
- [ ] X-Content-Type-Options: nosniff
- [ ] Referrer-Policy: strict-origin-when-cross-origin
- [ ] Strict-Transport-Security (HSTS)
- [ ] Permissions-Policy

### Scripts
- [ ] SRI sur tous les CDN
- [ ] Dépendances à jour
- [ ] Pas de scripts inline
- [ ] Build process en production

### Données
- [ ] Validation JSON
- [ ] Sanitization XSS
- [ ] LocalStorage sécurisé
- [ ] Pas de données sensibles côté client

### Conformité
- [ ] Consentement cookies (RGPD)
- [ ] Politique de confidentialité
- [ ] Mentions légales
- [ ] robots.txt

---

## 🔗 RESSOURCES

- [OWASP Top 10](https://owasp.org/www-project-top-ten/)
- [MDN Web Security](https://developer.mozilla.org/en-US/docs/Web/Security)
- [SRI Hash Generator](https://www.srihash.org/)
- [CSP Evaluator](https://csp-evaluator.withgoogle.com/)
- [RGPD - CNIL](https://www.cnil.fr/fr/rgpd-de-quoi-parle-t-on)

---

## ✅ CONCLUSION

Le site Quiz Quotidien présente plusieurs vulnérabilités de sécurité qui nécessitent une attention immédiate, notamment:

1. **CVE critique dans Babel** (réparation immédiate requise)
2. **Absence de SRI** (risque d'injection de code)
3. **Pas de CSP** (vulnérabilité XSS)
4. **Non-conformité RGPD** (risque légal)

**Recommandation principale:** Migrer vers un système de build moderne (Vite + React) pour éliminer les dépendances CDN et améliorer la sécurité globale.

**Temps estimé pour sécurisation complète:** 2-3 jours de développement

---

*Audit réalisé le 2026-01-20 par Claude Code*
