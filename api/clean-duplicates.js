// api/clean-duplicates.js
// Endpoint Vercel pour nettoyer les doublons dans questions.json

export default async function handler(req, res) {
  console.log('🚀 Début du nettoyage des doublons...');

  try {
    const githubRepo = 'yannisparuta/quiz-quotidien';
    const filePath = 'questions.json';

    // ============================================
    // ÉTAPE 1 : Charger le fichier depuis GitHub
    // ============================================
    console.log('📥 Chargement de questions.json...');
    
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
    const data = JSON.parse(existingContent);
    
    console.log(`✅ ${data.questions.length} questions chargées`);

    // ============================================
    // ÉTAPE 2 : Détecter et supprimer les doublons
    // ============================================
    console.log('🔍 Analyse des doublons...');
    
    const uniqueQuestions = [];
    const seenQuestions = new Map();
    const duplicates = [];
    const similarQuestions = [];

    for (let i = 0; i < data.questions.length; i++) {
      const question = data.questions[i];
      const normalized = normalizeQuestion(question.question);

      // Vérification 1 : Doublon exact
      if (seenQuestions.has(normalized)) {
        duplicates.push({
          index: i,
          question: question.question,
          duplicate_of: seenQuestions.get(normalized)
        });
        console.log(`🗑️  Doublon : "${question.question.substring(0, 60)}..."`);
        continue;
      }

      // Vérification 2 : Similarité >90%
      let foundSimilar = false;
      for (let j = 0; j < uniqueQuestions.length; j++) {
        const existingNormalized = normalizeQuestion(uniqueQuestions[j].question);
        const similarity = calculateSimilarity(normalized, existingNormalized);

        if (similarity > 0.90) {
          foundSimilar = true;
          similarQuestions.push({
            index: i,
            question: question.question,
            similar_to: uniqueQuestions[j].question,
            similarity: Math.round(similarity * 100)
          });
          console.log(`⚠️  Similaire (${Math.round(similarity * 100)}%) : "${question.question.substring(0, 50)}..."`);
          break;
        }
      }

      if (!foundSimilar) {
        seenQuestions.set(normalized, uniqueQuestions.length);
        uniqueQuestions.push(question);
      }
    }

    console.log(`\n📊 Résumé :`);
    console.log(`   Original : ${data.questions.length} questions`);
    console.log(`   Unique   : ${uniqueQuestions.length} questions`);
    console.log(`   Doublons : ${duplicates.length}`);
    console.log(`   Similaire: ${similarQuestions.length}`);

    // Si aucun doublon, on arrête
    if (duplicates.length === 0 && similarQuestions.length === 0) {
      return res.status(200).json({
        success: true,
        message: 'Aucun doublon détecté !',
        original_count: data.questions.length,
        cleaned_count: uniqueQuestions.length,
        duplicates_removed: 0,
        similar_removed: 0
      });
    }

    // ============================================
    // ÉTAPE 3 : Sauvegarder le fichier nettoyé
    // ============================================
    console.log('💾 Sauvegarde sur GitHub...');

    const cleanedData = {
      questions: uniqueQuestions,
      version: (data.version || 0) + 1,
      last_cleaned: new Date().toISOString()
    };

    const newContent = JSON.stringify(cleanedData, null, 2);
    const encodedContent = Buffer.from(newContent).toString('base64');

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
          message: `🧹 Nettoyage automatique : ${duplicates.length + similarQuestions.length} doublons supprimés`,
          content: encodedContent,
          sha: fileData.sha
        })
      }
    );

    if (!updateResponse.ok) {
      const errorData = await updateResponse.json();
      throw new Error(`Erreur commit: ${JSON.stringify(errorData)}`);
    }

    console.log('✅ Fichier nettoyé et sauvegardé !');

    // ============================================
    // ÉTAPE 4 : Réponse
    // ============================================
    return res.status(200).json({
      success: true,
      message: `${duplicates.length + similarQuestions.length} doublons supprimés`,
      original_count: data.questions.length,
      cleaned_count: uniqueQuestions.length,
      duplicates_removed: duplicates.length,
      similar_removed: similarQuestions.length,
      duplicates_examples: duplicates.slice(0, 5).map(d => ({
        question: d.question,
        index: d.index
      })),
      similar_examples: similarQuestions.slice(0, 5).map(s => ({
        question: s.question,
        similar_to: s.similar_to,
        similarity: s.similarity
      }))
    });

  } catch (error) {
    console.error('❌ Erreur:', error);
    return res.status(500).json({
      success: false,
      error: error.message
    });
  }
}

// ============================================
// FONCTIONS UTILITAIRES
// ============================================

function normalizeQuestion(question) {
  return question
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\w\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function calculateSimilarity(str1, str2) {
  const longer = str1.length > str2.length ? str1 : str2;
  const shorter = str1.length > str2.length ? str2 : str1;
  
  if (longer.length === 0) return 1.0;
  
  const editDistance = getEditDistance(longer, shorter);
  return (longer.length - editDistance) / longer.length;
}

function getEditDistance(str1, str2) {
  const matrix = [];
  
  for (let i = 0; i <= str2.length; i++) {
    matrix[i] = [i];
  }
  
  for (let j = 0; j <= str1.length; j++) {
    matrix[0][j] = j;
  }
  
  for (let i = 1; i <= str2.length; i++) {
    for (let j = 1; j <= str1.length; j++) {
      if (str2.charAt(i - 1) === str1.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1,
          matrix[i][j - 1] + 1,
          matrix[i - 1][j] + 1
        );
      }
    }
  }
  
  return matrix[str2.length][str1.length];
}
