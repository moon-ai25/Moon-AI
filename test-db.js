const mongoose = require('mongoose');
mongoose.connect('mongodb://127.0.0.1:27017/moonai')
  .then(async () => {
    console.log("Connected to DB");
    const collections = await mongoose.connection.db.listCollections().toArray();
    console.log("Collections:", collections.map(c => c.name));
    process.exit(0);
  });
