const { Groq } = require('groq-sdk');
require('dotenv').config({ path: 'd:/Moon AI/Backend/.env' });

async function listModels() {
  try {
    const groqClient = new Groq({ apiKey: process.env.replicate });
    const models = await groqClient.models.list();
    console.log(models.data.map(m => m.id).filter(id => id.includes('vision')));
  } catch (err) {
    console.error("Error:", err.message);
  }
}
listModels();
