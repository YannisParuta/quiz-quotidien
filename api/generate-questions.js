import Anthropic from '@anthropic-ai/sdk';
import fs from 'fs';
import path from 'path';

export default async function handler(req, res) {
  // Sécurité : seul Vercel Cron peut appeler cette fonction
  if (req.headers['x-vercel-cron-signature']) {
    console.log('✅ Cron job exécuté');
  }

  try {
    console.log('🚀 Début de la génération de questions...');

    // Initialiser Claude API
    const anthropic = new Anthropic({
      apiKey: process.env.ANTHROPIC_API_KEY,
    });

    // Prompt pour générer 10 questions
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
- Variété de catégories : Géographie, Histoire, Science, Culture, Sport, Art, Littérature, Nature, Mathématiques, Musique
- Questions de difficulté moyenne
- Réponses courtes et claires
- correctAnswer est l'INDEX (0, 1, 2 ou 3)
- Retourne UNIQUEMENT le JSON, rien d'autre`;

    const message = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 2000,
      messages: [{
        role: 'user',
        content: prompt
      }]
    });

    // Extraire le contenu JSON
    let jsonContent = message.content[0].text;
    
    // Nettoyer le markdown si présent
    jsonContent = jsonContent.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    
    const newQuestions = JSON.parse(jsonContent);
    
    console.log(`✅ ${newQuestions.questions.length} questions générées`);

    // Charger les questions existantes
    const questionsPath = path.join(process.cwd(), 'questions.json');
    let existingData = { questions: [] };
    
    try {
      const fileContent = fs.readFileSync(questionsPath, 'utf8');
      existingData = JSON.parse(fileContent);
    } catch (err) {
      console.log('⚠️ Aucun fichier existant, création...');
    }

    // Ajouter les nouvelles questions
    existingData.questions = [...existingData.questions, ...newQuestions.questions];
    
    // Limiter à 1000 questions max (garde les plus récentes)
    if (existingData.questions.length > 1000) {
      existingData.questions = existingData.questions.slice(-1000);
    }

    // Sauvegarder
    fs.writeFileSync(questionsPath, JSON.stringify(existingData, null, 2));
    
    console.log(`✅ Total: ${existingData.questions.length} questions dans la base`);

    return res.status(200).json({
      success: true,
      message: `${newQuestions.questions.length} questions générées`,
      total: existingData.questions.length,
      samples: newQuestions.questions.slice(0, 2) // Aperçu des 2 premières
    });

  } catch (error) {
    console.error('❌ Erreur:', error);
    return res.status(500).json({
      success: false,
      error: error.message
    });
  }
}
