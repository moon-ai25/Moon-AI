const { Groq } = require('groq-sdk');
require('dotenv').config({ path: 'd:/Moon AI/Backend/.env' });

async function test(model) {
  try {
    const groqClient = new Groq({ apiKey: process.env.replicate });
    const visionResponse = await groqClient.chat.completions.create({
      model: model,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: 'What is in this image?' },
            { type: 'image_url', image_url: { url: 'https://res.cloudinary.com/demo/image/upload/sample.jpg' } }
          ]
        }
      ],
      max_tokens: 1024
    });
    console.log(model, "Success:", visionResponse.choices[0].message.content);
  } catch (err) {
    console.error(model, "Error:", err.message);
  }
}
async function runAll() {
  await test('llama-3.3-70b-versatile');
}
runAll();
