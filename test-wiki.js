(async () => {
  const query = "Elon Musk";
  const url = `https://en.wikipedia.org/w/api.php?action=query&format=json&prop=pageimages&generator=search&gsrsearch=${encodeURIComponent(query)}&gsrlimit=5&pithumbsize=500`;
  const res = await fetch(url);
  const data = await res.json();
  const pages = data.query?.pages || {};
  const images = Object.values(pages)
    .filter(p => p.thumbnail)
    .map(p => p.thumbnail.source);
  console.log("Images found:", images);
})();
