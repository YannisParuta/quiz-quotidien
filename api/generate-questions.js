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
    
    console.log('📥 Chargement des questions existantes...');
    
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
      throw new Error(`Erreur GitHub: ${getFileResponse.status}`);
    }
    
    const fileData = await getFileResponse.json();
    const existingContent = Buffer.from(fileData.content, 'base64').toString('utf8');
    const existingData = JSON.parse(existingContent);
    
    console.log(`✅ ${existingData.questions.length} questions existantes chargées`);

    // ============================================
    // ÉTAPE 1.5 : Créer un Set des questions existantes (pour détecter les doublons)
    // ============================================
    const existingQuestionsSet = new Set(
      existingData.questions.map(q => 
        normalizeQuestion(q.question)
      )
    );
    
    console.log(`🔍 Index de ${existingQuestionsSet.size} questions uniques créé`);

    // ============================================
    // ÉTAPE 2 : Générer 10 nouvelles questions avec Claude
    // ============================================
    console.log('🤖 Génération de nouvelles questions avec Claude...');
    
    const anthropic = new Anthropic({
      apiKey: process.env.ANTHROPIC_API_KEY,
    });

    // Extraire 30 questions récentes comme exemples à éviter
    const recentQuestions = existingData.questions
      .slice(-30)
      .map(q => `- ${q.question}`)
      .join('\n');

    const prompt = `Génère exactement 15 questions de quiz en français avec 4 options de réponse chacune.

⚠️ IMPORTANT : NE CRÉE PAS de questions similaires aux exemples ci-dessous :

${recentQuestions}

Format STRICTEMENT JSON (sans markdown, sans commentaires) :
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

Consignes :
- Variété de catégories : Géographie, Histoire, Science, Culture, Sport, Art, Littérature, Nature, Mathématiques, Musique, Cinéma, Technologie
- Questions ORIGINALES et DIFFÉRENTES des exemples ci-dessus
- Questions de difficulté moyenne
- Réponses courtes et claires
- correctAnswer est l'INDEX (0, 1, 2 ou 3)
- Questions intéressantes et éducatives
- Retourne UNIQUEMENT le JSON, rien d'autre`;

    const message = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 3000,
      messages: [{
        role: 'user',
        content: prompt
      }]
    });

    // Extraire et nettoyer le JSON
    let jsonContent = message.content[0].text;
    jsonContent = jsonContent.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    
    const generatedQuestions = JSON.parse(jsonContent);
    
    console.log(`✅ ${generatedQuestions.questions.length} questions générées par Claude`);

    // ============================================
    // ÉTAPE 3 : FILTRER LES DOUBLONS
    // ============================================
    console.log('🔍 Vérification des doublons...');
    
    const uniqueNewQuestions = [];
    const duplicates = [];
    const similarQuestions = [];
    
    for (const newQ of generatedQuestions.questions) {
      const normalizedNew = normalizeQuestion(newQ.question);
      
      // Vérification 1 : Doublon exact
      if (existingQuestionsSet.has(normalizedNew)) {
        duplicates.push(newQ.question);
        console.log(`🗑️  Doublon exact : "${newQ.question.substring(0, 60)}..."`);
        continue;
      }
      
      // Vérification 2 : Similarité avec les questions existantes
      let isSimilar = false;
      for (const existingQ of existingData.questions.slice(-100)) {
        const similarity = calculateSimilarity(
          normalizedNew,
          normalizeQuestion(existingQ.question)
        );
        
        if (similarity > 0.85) { // 85% de similarité = trop proche
          isSimilar = true;
          similarQuestions.push({
            new: newQ.question,
            existing: existingQ.question,
            similarity: Math.round(similarity * 100)
          });
          console.log(`⚠️  Question similaire (${Math.round(similarity * 100)}%) :`);
          console.log(`     Nouvelle : "${newQ.question.substring(0, 50)}..."`);
          console.log(`     Existante: "${existingQ.question.substring(0, 50)}..."`);
          break;
        }
      }
      
      if (!isSimilar) {
        uniqueNewQuestions.push(newQ);
        existingQuestionsSet.add(normalizedNew); // Ajouter au Set pour éviter les doublons internes
      }
    }
    
    console.log(`\n📊 Résumé du filtrage :`);
    console.log(`   ✅ ${uniqueNewQuestions.length} questions uniques`);
    console.log(`   ❌ ${duplicates.length} doublons exacts`);
    console.log(`   ⚠️  ${similarQuestions.length} questions trop similaires`);

    // Si on n'a pas assez de questions uniques, on arrête
    if (uniqueNewQuestions.length === 0) {
      console.log('⚠️ Aucune nouvelle question unique générée !');
      return res.status(200).json({
        success: true,
        message: 'Aucune nouvelle question unique (toutes étaient des doublons)',
        added: 0,
        duplicates: duplicates.length,
        similar: similarQuestions.length,
        total: existingData.questions.length
      });
    }

    // ============================================
    // ÉTAPE 4 : Fusionner et limiter à 1000 questions max
    // ============================================
    existingData.questions = [...existingData.questions, ...uniqueNewQuestions];
    
    // Garder les 1000 plus récentes
    if (existingData.questions.length > 1000) {
      const removed = existingData.questions.length - 1000;
      existingData.questions = existingData.questions.slice(-1000);
      console.log(`⚠️ Limitation à 1000 questions (${removed} anciennes supprimées)`);
    }

    // ============================================
    // ÉTAPE 5 : Commit sur GitHub
    // ============================================
    console.log('📤 Mise à jour du fichier sur GitHub...');
    
    const newContent = JSON.stringify(existingData, null, 2);
    const encodedContent = Buffer.from(newContent).toString('base64');
    
    const today = new Date().toLocaleDateString('fr-FR');
    
    // Incrémenter la version
    const currentVersion = existingData.version || 1;
    const newVersion = currentVersion + 1;
    existingData.version = newVersion;
    
    console.log(`🔢 Version: ${currentVersion} → ${newVersion}`);
    
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

    console.log('✅ Fichier mis à jour sur GitHub !');

    // ============================================
    // ÉTAPE 6 : Réponse détaillée
    // ============================================
    return res.status(200).json({
      success: true,
      message: `${uniqueNewQuestions.length} questions uniques ajoutées`,
      added: uniqueNewQuestions.length,
      duplicatesAvoided: duplicates.length,
      similarAvoided: similarQuestions.length,
      total: existingData.questions.length,
      version: newVersion,
      date: today,
      samples: uniqueNewQuestions.slice(0, 3).map(q => ({
        question: q.question,
        category: q.category
      }))
    });

  } catch (error) {
    console.error('❌ Erreur:', error);
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
 * - Sans espaces multiples
 * - Sans ponctuation
 */
function normalizeQuestion(question) {
  return question
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // Enlever les accents
    .replace(/[^\w\s]/g, '') // Enlever la ponctuation
    .replace(/\s+/g, ' ') // Normaliser les espaces
    .trim();
}

/**
 * Calcule la similarité entre deux chaînes (distance de Levenshtein)
 * Retourne un score entre 0 (différent) et 1 (identique)
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
 * Calcule la distance d'édition entre deux chaînes
 */
function getEditDistance(str1, str2) {
  const matrix = [];
  
  // Initialisation
  for (let i = 0; i <= str2.length; i++) {
    matrix[i] = [i];
  }
  
  for (let j = 0; j <= str1.length; j++) {
    matrix[0][j] = j;
  }
  
  // Calcul
  for (let i = 1; i <= str2.length; i++) {
    for (let j = 1; j <= str1.length; j++) {
      if (str2.charAt(i - 1) === str1.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1, // substitution
          matrix[i][j - 1] + 1,     // insertion
          matrix[i - 1][j] + 1      // suppression
        );
      }
    }
  }
  
  return matrix[str2.length][str1.length];
}
