# Quiz Quotidien → domotique : intégration des statistiques

Document de passation pour l'agent qui gère Home Assistant sur le serveur domotique local (Linux).
Il décrit tout ce qu'il faut pour ingérer les statistiques du site **Quiz Quotidien** et construire la page de stats côté Home Assistant.

**Répartition des rôles**
- **Agent quiz-quotidien** (dépôt `YannisParuta/quiz-quotidien`) : le site et ses API, dont `/api/stats`. Toute évolution des données exposées passe par ce dépôt.
- **Agent Home Assistant** : la collecte depuis le serveur local, l'historisation et la page/tableau de bord des stats dans HA.

---

## 1. Source des données

| | |
|---|---|
| URL | `https://www.quiz-quotidien.fr/api/stats` |
| Méthode | `GET` |
| Authentification | aucune (endpoint public, chiffres agrégés non sensibles) |
| Format | JSON, `Content-Type: application/json` |
| Cache | `Cache-Control: no-store` (valeurs toujours fraîches) |
| CORS | `Access-Control-Allow-Origin: *` (lisible aussi depuis une page web) |
| Fuseau horaire | **Europe/Paris** : les compteurs « aujourd'hui » repartent de zéro à minuit, heure de Paris |
| Réseau | HTTPS sortant uniquement depuis le serveur local, rien à ouvrir en entrée |

**Fréquence d'interrogation recommandée : toutes les 5 à 15 minutes.** Les chiffres bougent au rythme des joueurs, inutile d'aller plus vite.

## 2. Format de la réponse

```json
{
  "success": true,
  "updatedAt": "2026-10-28T14:55:04.966Z",
  "today":      { "visits": 2, "completions": 0, "completionRate": 0, "averageScore": null, "shares": 0 },
  "yesterday":  { "visits": 0, "completions": 0, "completionRate": 0, "averageScore": null, "shares": 0 },
  "last7Days":  { "visits": 2, "completions": 0, "completionRate": 0, "averageScore": null, "shares": 0 },
  "last30Days": { "visits": 2, "completions": 0, "completionRate": 0, "averageScore": null, "shares": 0 },
  "allTime":    { "visits": 2, "completions": 0, "completionRate": 0, "averageScore": null, "shares": 0 },
  "history": [
    { "date": "2026-10-15", "visits": 0, "completions": 0 },
    "… 14 entrées au total, de la plus ancienne à aujourd'hui (dernière entrée)"
  ],
  "questions": { "count": 330, "target": 3650, "remaining": 3320 }
}
```

### Signification des champs

Chaque période (`today`, `yesterday`, `last7Days`, `last30Days`, `allTime`) a la même structure :

| Champ | Type | Signification |
|---|---|---|
| `visits` | entier | **Joueurs** : nombre d'appareils ayant chargé le quiz du jour. Compté une seule fois par appareil et par jour (au premier chargement). C'est la meilleure mesure du nombre d'utilisateurs quotidiens. |
| `completions` | entier | Quiz terminés (10 questions répondues). |
| `completionRate` | entier, 0-100 | `completions / visits` en %, plafonné à 100. |
| `averageScore` | nombre (1 décimale) ou `null` | Score moyen sur 10 des quiz terminés. **`null` s'il n'y a encore aucun quiz terminé sur la période** : à gérer (afficher « – » ou `unknown`). |
| `shares` | entier | Partages du score (WhatsApp + X + copie). |

Autres champs :

| Champ | Signification |
|---|---|
| `updatedAt` | Horodatage ISO 8601 (UTC) de la réponse. |
| `history` | 14 jours glissants, ordre chronologique, **le dernier élément est aujourd'hui** (journée en cours, donc partielle). `date` au format `AAAA-MM-JJ`. Les jours sans activité sont présents avec des zéros. |
| `questions.count` | Questions actuellement en base. Une tâche planifiée en ajoute 10 chaque nuit (vers 2h47, heure de Paris). |
| `questions.target` | Objectif : 3650 questions (un an de quiz sans répétition). |
| `questions.remaining` | Questions restantes avant l'objectif. Nombre de jours restants ≈ `remaining / 10`. |

### Points d'attention

- **`today` est une journée en cours** : comparer `today` à `yesterday` en cours de journée donne toujours une baisse apparente. Pour des tendances, utiliser `yesterday`, `last7Days`, ou l'historique.
- **Données anonymes** : de simples totaux journaliers, sans cookie, sans IP et sans identifiant. Il n'existe pas (et il n'existera pas) de détail par utilisateur.
- **Les compteurs ont démarré le 28/10/2026** : il n'y a pas d'historique avant cette date.
- En cas d'erreur serveur, la réponse est `HTTP 500` avec `{ "success": false, "error": "…" }` : garder la dernière valeur connue plutôt que de passer les capteurs à zéro.

## 3. Endpoint complémentaire (facultatif)

`GET https://www.quiz-quotidien.fr/api/questions` (public) :

```json
{ "success": true, "count": 330, "target": 3650, "remaining": 3320,
  "byCategory": [ { "category": "Science", "count": 47 }, "…" ] }
```

Utile pour afficher la répartition des questions par catégorie.

## 4. À ne pas faire

- **Ne pas appeler `/api/track`** : c'est l'endpoint où le site enregistre les événements des joueurs. L'appeler fausserait les statistiques.
- **Pas besoin du secret `ADMIN_SECRET`** : il sert uniquement à ajouter des questions et ne doit pas être copié sur le serveur domotique.

## 5. Vercel Web Analytics (visiteurs de pages)

Le site utilise aussi Vercel Web Analytics (sans cookie) pour les pages vues et les visiteurs, tous visiteurs confondus, y compris ceux qui ne jouent pas.
Ces données sont visibles dans le tableau de bord Vercel (projet `quiz-quotidien`, onglet Analytics) et **ne sont pas exposées par `/api/stats`**.
Pour les récupérer dans Home Assistant, il faudrait un jeton d'API Vercel (`https://api.vercel.com/v1/query/web-analytics/visits/count`). C'est facultatif et à décider avec le propriétaire. Pour le nombre d'utilisateurs, `visits` de `/api/stats` suffit.

## 6. Exemple de départ pour Home Assistant

Indication seulement : la mise en place, l'historisation et le tableau de bord relèvent de l'agent Home Assistant.

```yaml
rest:
  - resource: https://www.quiz-quotidien.fr/api/stats
    scan_interval: 900
    sensor:
      - name: "Quiz joueurs aujourd'hui"
        unique_id: quiz_quotidien_joueurs_jour
        value_template: "{{ value_json.today.visits }}"
        state_class: measurement
      - name: "Quiz terminés aujourd'hui"
        unique_id: quiz_quotidien_termines_jour
        value_template: "{{ value_json.today.completions }}"
        state_class: measurement
      - name: "Quiz score moyen aujourd'hui"
        unique_id: quiz_quotidien_score_moyen_jour
        value_template: "{{ value_json.today.averageScore if value_json.today.averageScore is not none else 'unknown' }}"
        unit_of_measurement: "/10"
        state_class: measurement
      - name: "Quiz joueurs hier"
        unique_id: quiz_quotidien_joueurs_hier
        value_template: "{{ value_json.yesterday.visits }}"
      - name: "Quiz joueurs 7 jours"
        unique_id: quiz_quotidien_joueurs_7j
        value_template: "{{ value_json.last7Days.visits }}"
      - name: "Quiz questions en base"
        unique_id: quiz_quotidien_questions
        value_template: "{{ value_json.questions.count }}"
        json_attributes_path: "$.questions"
        json_attributes: [target, remaining]
```

Vérification rapide depuis le serveur local :

```bash
curl -s https://www.quiz-quotidien.fr/api/stats | python3 -m json.tool
```
