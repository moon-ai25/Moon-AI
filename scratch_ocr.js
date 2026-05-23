async function testOcr() {
  const url = 'https://api.ocr.space/parse/imageurl?apikey=helloworld&url=https://res.cloudinary.com/demo/image/upload/sample.jpg';
  try {
    const response = await fetch(url);
    const data = await response.json();
    console.log(data.ParsedResults[0].ParsedText);
  } catch (err) {
    console.error(err);
  }
}
testOcr();
