const { searchWeb } = require('./services/webSearch');

(async () => {
  const res = await searchWeb('Elon Musk');
  console.log(JSON.stringify(res, null, 2));
})();
