import Anthropic from '@anthropic-ai/sdk';

export default async function handler(req, res) {
  // Sécurité : vérifier que c'est bien le cron Vercel
  const cronSecret = req.headers['x-vercel-cron-signature'];
  
  console.log('🚀 Début de la génération de questions...');

  try {
    // ============================================
    // ÉTAPE 1 : Charger les questions existantes depuis GitHub
    // ============================================
    const githubRepo = 'yannisparuta/quiz-quotidien';
    const filePath = 'questions.json';
    
    console.log('📥 Chargement des questions existantes depuis GitHub...');
    
    const getFileResponse = await fetch(
      `https://api.github.com/repos/${githubRepo}/contents/${filePath}`,
      {
        headers: {
          'Authorization': `Bearer ${process.env.GITHUB_TOKEN}`,
          'Accept': 'application/vnd.github.v3+json'
        }
      }
    );
    
    if (!getFileResponse.ok) {
      throw new Error(`Erreur GitHub GET: ${getFileResponse.status}`);
    }
    
    const fileData = await getFileResponse.json();
    const existingContent = Buffer.from(fileData.content, 'base64').toString('utf8');
    const existingData = JSON.parse(existingContent);
    
    console.log(`✅ ${existingData.questions.length} questions existantes chargées`);

    // ============================================
    // ÉTAPE 2 : Créer un index des questions existantes
    // ============================================
    console.log('🔍 Création de l\'index des questions existantes...');
    
    // Set pour les doublons exacts
    const existingQuestionsSet = new Set(
      existingData.questions.map(q => normalizeQuestion(q.question))
    );
    
    console.log(`📊 Index créé : ${existingQuestionsSet.size} questions uniques`);

    // ============================================
    // ÉTAPE 3 : Générer de nouvelles questions avec Claude
    // ============================================
    console.log('🤖 Génération de nouvelles questions avec Claude...');
    
    const anthropic = new Anthropic({
      apiKey: process.env.ANTHROPIC_API_KEY,
    });

    // Prendre les 30 dernières questions comme exemples à éviter
    const recentQuestions = existingData.questions
      .slice(-30)
      .map((q, i) => `${i + 1}. ${q.question}`)
      .join('\n');

    const prompt = `Tu es un expert en création de quiz éducatifs. Génère exactement 15 questions de quiz en français.

⚠️ IMPORTANT : NE CRÉE PAS de questions identiques ou trop similaires à ces exemples récents :

${recentQuestions}

Format STRICTEMENT JSON (sans markdown, sans commentaires, sans texte avant ou après) :
{
  "questions": [
    {
      "question": "Ta question ici ?",
      "options": ["Option A", "Option B", "Option C", "Option D"],
      "correctAnswer": 0,
      "category": "Catégorie"
    }
  ]
}

CONSIGNES IMPORTANTES :
- Variété de catégories : Géographie, Histoire, Science, Culture, Sport, Art, Littérature, Nature, Mathématiques, Musique, Cinéma, Technologie, Gastronomie
- Questions ORIGINALES et DIFFÉRENTES des exemples ci-dessus
- Difficulté : moyenne
- Réponses courtes et claires
- correctAnswer est l'INDEX de la bonne réponse (0, 1, 2 ou 3)
- Questions intéressantes et éducatives
- Évite les questions trop génériques
- Retourne UNIQUEMENT le JSON, rien d'autre`;

    const message = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 3000,
      messages: [{
        role: 'user',
        content: prompt
      }]
    });

    // Extraire et nettoyer le JSON
    let jsonContent = message.content[0].text;
    
    // Nettoyer les balises markdown si présentes
    jsonContent = jsonContent
      .replace(/```json\n?/g, '')
      .replace(/```\n?/g, '')
      .trim();
    
    // Parser le JSON
    let generatedData;
    try {
      generatedData = JSON.parse(jsonContent);
    } catch (parseError) {
      console.error('❌ Erreur parsing JSON:', jsonContent.substring(0, 200));
      throw new Error(`Erreur parsing JSON: ${parseError.message}`);
    }
    
    const generatedQuestions = generatedData.questions;
    
    console.log(`✅ ${generatedQuestions.length} questions générées par Claude`);

    // ============================================
    // ÉTAPE 4 : FILTRER LES DOUBLONS (CRUCIAL !)
    // ============================================
    console.log('🔍 Vérification des doublons avec l\'historique complet...');
    
    const uniqueNewQuestions = [];
    const duplicates = [];
    const similarQuestions = [];
    
    for (const newQuestion of generatedQuestions) {
      const normalizedNew = normalizeQuestion(newQuestion.question);
      
      // ===== VÉRIFICATION 1 : Doublon exact avec l'historique =====
      if (existingQuestionsSet.has(normalizedNew)) {
        duplicates.push(newQuestion.question);
        console.log(`🗑️  Doublon exact détecté : "${newQuestion.question.substring(0, 60)}..."`);
        continue;
      }
      
      // ===== VÉRIFICATION 2 : Similarité avec les questions existantes =====
      let isTooSimilar = false;
      
      // Vérifier contre les 100 dernières questions pour optimiser la performance
      const questionsToCheck = existingData.questions.slice(-100);
      
      for (const existingQuestion of questionsToCheck) {
        const normalizedExisting = normalizeQuestion(existingQuestion.question);
        const similarity = calculateSimilarity(normalizedNew, normalizedExisting);
        
        // Seuil de similarité : 85%
        if (similarity > 0.85) {
          isTooSimilar = true;
          const similarityPercent = Math.round(similarity * 100);
          
          similarQuestions.push({
            newQuestion: newQuestion.question,
            existingQuestion: existingQuestion.question,
            similarity: similarityPercent
          });
          
          console.log(`⚠️  Question trop similaire (${similarityPercent}%) :`);
          console.log(`     Nouvelle  : "${newQuestion.question.substring(0, 50)}..."`);
          console.log(`     Existante : "${existingQuestion.question.substring(0, 50)}..."`);
          break;
        }
      }
      
      // ===== VÉRIFICATION 3 : Doublon interne (entre les nouvelles questions) =====
      const isDuplicateInternal = uniqueNewQuestions.some(q => 
        normalizeQuestion(q.question) === normalizedNew
      );
      
      if (isDuplicateInternal) {
        console.log(`🗑️  Doublon interne détecté : "${newQuestion.question.substring(0, 60)}..."`);
        continue;
      }
      
      // Si pas de doublon et pas trop similaire, on l'accepte
      if (!isTooSimilar) {
        uniqueNewQuestions.push(newQuestion);
        existingQuestionsSet.add(normalizedNew); // Ajouter au Set pour les prochaines vérifications
      }
    }
    
    console.log(`\n${'='.repeat(60)}`);
    console.log('📊 RÉSUMÉ DU FILTRAGE');
    console.log('='.repeat(60));
    console.log(`✅ Questions uniques acceptées  : ${uniqueNewQuestions.length}`);
    console.log(`❌ Doublons exacts évités       : ${duplicates.length}`);
    console.log(`⚠️  Questions similaires évitées : ${similarQuestions.length}`);
    console.log(`📈 Total généré par Claude      : ${generatedQuestions.length}`);
    console.log('='.repeat(60) + '\n');

    // Si aucune question unique, on arrête
    if (uniqueNewQuestions.length === 0) {
      console.log('⚠️ Aucune nouvelle question unique générée (toutes étaient des doublons)');
      return res.status(200).json({
        success: true,
        message: 'Aucune nouvelle question unique (toutes étaient des doublons)',
        added: 0,
        duplicatesAvoided: duplicates.length,
        similarAvoided: similarQuestions.length,
        total: existingData.questions.length,
        date: new Date().toLocaleDateString('fr-FR')
      });
    }

    // ============================================
    // ÉTAPE 5 : Ajouter des IDs uniques aux nouvelles questions
    // ============================================
    console.log(`📝 Ajout de ${uniqueNewQuestions.length} nouvelles questions...`);
    
    // Générer des IDs uniques pour les nouvelles questions
    const questionsWithIds = uniqueNewQuestions.map((q, index) => {
      const timestamp = Date.now();
      const randomPart = Math.random().toString(36).substring(2, 8);
      return {
        ...q,
        id: q.id || `q_${timestamp}_${index}_${randomPart}`,
        addedAt: new Date().toISOString()
      };
    });
    
    // Ajouter les IDs aux questions existantes qui n'en ont pas
    const existingWithIds = existingData.questions.map((q, index) => {
      if (!q.id) {
        const fallbackId = `q_legacy_${index}_${q.question.substring(0, 10).replace(/\s+/g, '_')}`;
        return { ...q, id: fallbackId, addedAt: q.addedAt || '2026-01-01T00:00:00.000Z' };
      }
      return q;
    });
    
    // Fusionner toutes les questions
    const allQuestionsWithIds = [...existingWithIds, ...questionsWithIds];
    
    // ============================================
    // ÉTAPE 6 : Système de Pool Rotatif (100 questions actives)
    // ============================================
    
    // Trier par date d'ajout (plus récentes en premier)
    allQuestionsWithIds.sort((a, b) => {
      const dateA = new Date(a.addedAt || '2026-01-01');
      const dateB = new Date(b.addedAt || '2026-01-01');
      return dateB - dateA; // Plus récent d'abord
    });
    
    // Définir le pool actif (100 questions les plus récentes)
    const POOL_SIZE = 100;
    const activePool = allQuestionsWithIds.slice(0, POOL_SIZE);
    const archivedQuestions = allQuestionsWithIds.slice(POOL_SIZE);
    
    console.log(`📊 Pool actif : ${activePool.length} questions`);
    console.log(`📦 Archive : ${archivedQuestions.length} questions`);
    
    // Sauvegarder séparément le pool actif et l'archive
    existingData.questions = activePool;
    existingData.archivedQuestions = archivedQuestions;
    existingData.poolSize = POOL_SIZE;
    
    // Limiter l'archive à 1000 questions max
    if (existingData.archivedQuestions.length > 1000) {
      const removed = existingData.archivedQuestions.length - 1000;
      existingData.archivedQuestions = existingData.archivedQuestions.slice(0, 1000);
      console.log(`⚠️ Archive limitée à 1000 questions (${removed} supprimées)`);
    }

    // ============================================
    // ÉTAPE 7 : Incrémenter la version
    // ============================================
    const currentVersion = existingData.version || 1;
    const newVersion = currentVersion + 1;
    existingData.version = newVersion;
    existingData.last_updated = new Date().toISOString();
    
    console.log(`🔢 Version: ${currentVersion} → ${newVersion}`);

    // ============================================
    // ÉTAPE 8 : Commit sur GitHub
    // ============================================
    console.log('📤 Mise à jour du fichier sur GitHub...');
    
    const newContent = JSON.stringify(existingData, null, 2);
    const encodedContent = Buffer.from(newContent).toString('base64');
    
    const today = new Date().toLocaleDateString('fr-FR');
    
    const updateResponse = await fetch(
      `https://api.github.com/repos/${githubRepo}/contents/${filePath}`,
      {
        method: 'PUT',
        headers: {
          'Authorization': `Bearer ${process.env.GITHUB_TOKEN}`,
          'Accept': 'application/vnd.github.v3+json',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          message: `🤖 Ajout automatique de ${uniqueNewQuestions.length} questions uniques - ${today}`,
          content: encodedContent,
          sha: fileData.sha
        })
      }
    );

    if (!updateResponse.ok) {
      const errorData = await updateResponse.json();
      throw new Error(`Erreur commit GitHub: ${JSON.stringify(errorData)}`);
    }

    console.log('✅ Fichier mis à jour avec succès sur GitHub !');

    // ============================================
    // ⭐ ÉTAPE 9 : PURGER LE CACHE VERCEL (NOUVEAU!)
    // ============================================
    console.log('🔄 Purge du cache Vercel...');
    
    try {
      // Attendre 2 secondes que GitHub se synchronise avec Vercel
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      // Purger le cache du fichier questions.json
      const purgeUrl = `https://${process.env.VERCEL_URL || 'www.quiz-quotidien.fr'}/questions.json`;
      
      if (process.env.VERCEL_TOKEN) {
        // Méthode 1 : Utiliser l'API Vercel (si token disponible)
        const purgeResponse = await fetch(
          `https://api.vercel.com/v1/purge?url=${encodeURIComponent(purgeUrl)}`,
          {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${process.env.VERCEL_TOKEN}`
            }
          }
        );
        
        if (purgeResponse.ok) {
          console.log('✅ Cache Vercel purgé avec succès via API !');
        } else {
          console.log('⚠️  Purge API échouée, mais pas critique');
        }
      }
      
      // Méthode 2 : Forcer un redéploiement (toujours fonctionnel)
      // Le commit GitHub va déclencher un redéploiement automatique
      console.log('✅ Le commit GitHub va déclencher un redéploiement automatique');
      
    } catch (purgeError) {
      console.log('⚠️  Erreur purge cache (non-bloquante):', purgeError.message);
    }

    // ============================================
    // ÉTAPE 10 : Réponse détaillée
    // ============================================
    return res.status(200).json({
      success: true,
      message: `${uniqueNewQuestions.length} questions uniques ajoutées avec succès`,
      added: uniqueNewQuestions.length,
      duplicatesAvoided: duplicates.length,
      similarAvoided: similarQuestions.length,
      totalGenerated: generatedQuestions.length,
      totalInDatabase: existingData.questions.length,
      version: newVersion,
      date: today,
      samples: uniqueNewQuestions.slice(0, 3).map(q => ({
        question: q.question,
        category: q.category
      })),
      duplicatesExamples: duplicates.slice(0, 3),
      similarExamples: similarQuestions.slice(0, 3)
    });

  } catch (error) {
    console.error('❌ ERREUR FATALE:', error);
    return res.status(500).json({
      success: false,
      error: error.message,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
}

// ============================================
// FONCTIONS UTILITAIRES
// ============================================

/**
 * Normalise une question pour la comparaison
 * - Minuscules
 * - Sans accents
 * - Sans ponctuation
 * - Sans espaces multiples
 * 
 * Exemple :
 * "Quelle est la Capitale de la France ?" 
 * → "quelle est la capitale de la france"
 */
function normalizeQuestion(question) {
  return question
    .toLowerCase()
    .normalize('NFD')                    // Décomposer les caractères accentués
    .replace(/[\u0300-\u036f]/g, '')    // Supprimer les accents
    .replace(/[^\w\s]/g, '')            // Supprimer la ponctuation
    .replace(/\s+/g, ' ')               // Normaliser les espaces
    .trim();
}

/**
 * Calcule la similarité entre deux chaînes de caractères
 * Utilise la distance de Levenshtein
 * 
 * Retourne un score entre 0 (complètement différent) et 1 (identique)
 * 
 * Exemple :
 * calculateSimilarity("Quelle est la capitale", "Quelle capitale") 
 * → 0.76 (76% similaire)
 */
function calculateSimilarity(str1, str2) {
  const longer = str1.length > str2.length ? str1 : str2;
  const shorter = str1.length > str2.length ? str2 : str1;
  
  if (longer.length === 0) {
    return 1.0;
  }
  
  const editDistance = getEditDistance(longer, shorter);
  return (longer.length - editDistance) / longer.length;
}

/**
 * Calcule la distance d'édition (Levenshtein) entre deux chaînes
 * 
 * La distance de Levenshtein mesure le nombre minimum d'opérations 
 * (insertion, suppression, substitution) nécessaires pour transformer 
 * une chaîne en une autre.
 * 
 * Exemple :
 * getEditDistance("chat", "chien") → 3
 * (remplacer 'a' par 'i', 't' par 'e', ajouter 'n')
 */
function getEditDistance(str1, str2) {
  const matrix = [];
  
  // Initialisation de la première colonne
  for (let i = 0; i <= str2.length; i++) {
    matrix[i] = [i];
  }
  
  // Initialisation de la première ligne
  for (let j = 0; j <= str1.length; j++) {
    matrix[0][j] = j;
  }
  
  // Calcul de la matrice
  for (let i = 1; i <= str2.length; i++) {
    for (let j = 1; j <= str1.length; j++) {
      if (str2.charAt(i - 1) === str1.charAt(j - 1)) {
        // Les caractères sont identiques, pas d'opération nécessaire
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        // Prendre le minimum entre substitution, insertion, suppression
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1, // Substitution
          matrix[i][j - 1] + 1,     // Insertion
          matrix[i - 1][j] + 1      // Suppression
        );
      }
    }
  }
  
  return matrix[str2.length][str1.length];
}
