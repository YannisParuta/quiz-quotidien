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
    // ÉTAPE 2 : Générer 10 nouvelles questions avec Claude
    // ============================================
    console.log('🤖 Génération de nouvelles questions avec Claude...');
    
    const anthropic = new Anthropic({
      apiKey: process.env.ANTHROPIC_API_KEY,
    });

    const prompt = `Génère exactement 10 questions de quiz en français avec 4 options de réponse chacune.

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
- Questions de difficulté moyenne
- Réponses courtes et claires
- correctAnswer est l'INDEX (0, 1, 2 ou 3)
- Questions originales et intéressantes
- Retourne UNIQUEMENT le JSON, rien d'autre`;

    const message = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 2500,
      messages: [{
        role: 'user',
        content: prompt
      }]
    });

    // Extraire et nettoyer le JSON
    let jsonContent = message.content[0].text;
    jsonContent = jsonContent.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    
    const newQuestions = JSON.parse(jsonContent);
    
    console.log(`✅ ${newQuestions.questions.length} nouvelles questions générées`);

    // ============================================
    // ÉTAPE 3 : Fusionner et limiter à 1000 questions max
    // ============================================
    existingData.questions = [...existingData.questions, ...newQuestions.questions];
    
    // Garder les 1000 plus récentes
    if (existingData.questions.length > 1000) {
      existingData.questions = existingData.questions.slice(-1000);
      console.log('⚠️ Limitation à 1000 questions (suppression des plus anciennes)');
    }

    // ============================================
    // ÉTAPE 4 : Commit sur GitHub
    // ============================================
    console.log('📤 Mise à jour du fichier sur GitHub...');
    
    const newContent = JSON.stringify(existingData, null, 2);
    const encodedContent = Buffer.from(newContent).toString('base64');
    
    const today = new Date().toLocaleDateString('fr-FR');
    
    // Incrémenter aussi la version du quiz dans questions.json
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
          message: `🤖 Ajout automatique de 10 questions - ${today}`,
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
    // ÉTAPE 5 : Réponse
    // ============================================
    return res.status(200).json({
      success: true,
      message: `${newQuestions.questions.length} questions générées et ajoutées`,
      total: existingData.questions.length,
      date: today,
      samples: newQuestions.questions.slice(0, 2)
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
