const { Groq } = require('groq-sdk');
require('dotenv').config({ path: 'd:/Moon AI/Backend/.env' });

async function test() {
  try {
    const groqClient = new Groq({ apiKey: process.env.replicate });
    const visionResponse = await groqClient.chat.completions.create({
      model: 'llama-3.2-90b-vision-preview',
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: 'What is in this image?'
            },
            {
              type: 'image_url',
              image_url: { url: 'https://res.cloudinary.com/demo/image/upload/sample.jpg' }
            }
          ]
        }
      ],
      max_tokens: 1024
    });
    console.log("Success:", visionResponse.choices[0].message.content);
  } catch (err) {
    console.error("Error:", err.message);
  }
}
test();
