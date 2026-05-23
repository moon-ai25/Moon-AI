const express    = require('express');
const router     = express.Router();
const multer     = require('multer');
const fs         = require('fs');
const { v2: cloudinary } = require('cloudinary');
const mongoose   = require('mongoose');
const Groq       = require('groq-sdk');

// Inline image schema (small enough to keep local)
const imageSchema = new mongoose.Schema({
  name:      String,
  url:       String,
  public_id: String
}, { collection: 'images' });

const Image = mongoose.models.Image || mongoose.model('Image', imageSchema);

const upload = multer({ dest: 'uploads/' });

// ─── Upload ───────────────────────────────────────────────────────────────────

router.post('/upload-image', upload.single('image'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No image file provided' });
  }

  try {
    const result = await cloudinary.uploader.upload(req.file.path, {
      folder: 'moon_ai'
    });

    const image = await Image.create({
      name:      req.file.originalname,
      url:       result.secure_url,
      public_id: result.public_id
    });

    // Clean up local temp file
    if (fs.existsSync(req.file.path)) {
      fs.unlinkSync(req.file.path);
    }

    res.json({ imageUrl: image.url, imageId: image._id });
  } catch (err) {
    console.error('❌ Upload error:', err.message);

    // Clean up temp file on failure too
    if (req.file?.path && fs.existsSync(req.file.path)) {
      fs.unlinkSync(req.file.path);
    }

    res.status(500).json({ error: 'Upload failed' });
  }
});

// ─── Upload + OCR (vision) ────────────────────────────────────────────────────
// POST /upload-image-ocr
// Uploads image to Cloudinary, then uses Groq vision to extract text/description.
// Returns: { imageUrl, extractedText }

router.post('/upload-image-ocr', upload.single('image'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No image file provided' });
  }

  let cloudinaryUrl = null;

  try {
    // 1. Upload to Cloudinary
    const uploadResult = await cloudinary.uploader.upload(req.file.path, {
      folder: 'moon_ai_attachments'
    });
    cloudinaryUrl = uploadResult.secure_url;

    // Save metadata
    await Image.create({
      name:      req.file.originalname || 'attachment',
      url:       cloudinaryUrl,
      public_id: uploadResult.public_id
    });

    // Clean up local temp file
    if (fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);

    // 2. Run vision OCR to extract text
    let extractedText = '';
    try {
      const response = await fetch(`https://api.ocr.space/parse/imageurl?apikey=helloworld&url=${encodeURIComponent(cloudinaryUrl)}`);
      const data = await response.json();
      if (data && data.ParsedResults && data.ParsedResults.length > 0) {
        extractedText = data.ParsedResults[0].ParsedText || '';
      }
      if (!extractedText.trim()) {
        extractedText = `[Image attached: ${cloudinaryUrl}]`;
      }
    } catch (visionErr) {
      console.warn('⚠️ OCR:       Failed ->', visionErr.message);
      extractedText = `[Image attached: ${cloudinaryUrl}]`;
    }

    res.json({ imageUrl: cloudinaryUrl, extractedText });

  } catch (err) {
    console.error('❌ upload-image-ocr error:', err.message);
    if (req.file?.path && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
    res.status(500).json({ error: 'Upload or OCR failed', details: err.message });
  }
});

// ─── Fetch Image ──────────────────────────────────────────────────────────────

router.get('/images/:id', async (req, res) => {
  try {
    const image = await Image.findById(req.params.id);
    if (!image) return res.status(404).json({ error: 'Image not found' });
    res.redirect(image.url);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
