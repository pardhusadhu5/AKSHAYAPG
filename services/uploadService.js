const multer = require('multer');
const { CloudinaryStorage } = require('multer-storage-cloudinary');
const cloudinary = require('cloudinary').v2;
const path = require('path');
const fs = require('fs');

// Configure Cloudinary
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET
});

const storage = new CloudinaryStorage({
  cloudinary: cloudinary,
  params: async (req, file) => {
    // Cloudinary automatically handles formats.
    // 'auto' detects if it's raw (like pdf) or image.
    return {
      folder: 'akshaya_pg_uploads',
      resource_type: 'auto',
      public_id: Date.now() + '-' + Math.round(Math.random() * 1E9),
    };
  }
});

const fileFilter = (req, file, cb) => {
  const filetypes = /jpeg|jpg|png|pdf/;
  const mimetype = filetypes.test(file.mimetype) || file.mimetype === 'application/pdf';
  const extname = filetypes.test(path.extname(file.originalname).toLowerCase());

  if (mimetype && extname) {
    return cb(null, true);
  }
  cb(new Error('Only JPEG, JPG, PNG, and PDF files are allowed.'));
};

const upload = multer({
  storage: storage,
  fileFilter: fileFilter,
  limits: { fileSize: 5 * 1024 * 1024 } // 5MB limit
});

// Helper to extract Cloudinary public_id from URL
const extractPublicId = (url) => {
  if (!url || !url.includes('cloudinary.com')) return null;
  const parts = url.split('/');
  const uploadIndex = parts.findIndex(p => p === 'upload');
  if (uploadIndex === -1) return null;
  
  // parts after upload/v12345/
  const relevantParts = parts.slice(uploadIndex + 2);
  const fullPath = relevantParts.join('/');
  // remove extension
  const lastDotIndex = fullPath.lastIndexOf('.');
  if (lastDotIndex !== -1) {
    return fullPath.substring(0, lastDotIndex);
  }
  return fullPath;
};

// Unified delete function for both old local files and new cloud files
const deleteFile = async (fileUrl) => {
  try {
    if (!fileUrl) return;
    
    if (fileUrl.startsWith('/uploads/')) {
      // Local file backward compatibility
      const absolutePath = path.join(__dirname, '..', fileUrl);
      if (fs.existsSync(absolutePath)) {
        fs.unlinkSync(absolutePath);
      }
    } else if (fileUrl.includes('cloudinary.com')) {
      // Cloudinary file
      const publicId = extractPublicId(fileUrl);
      if (publicId) {
        // Destroy without specifying resource_type might fail for raw files, 
        // so we attempt both common types if needed, but 'image' is default.
        // We can just use the admin API which can delete by public_id across types if needed,
        // or just try image then raw.
        try {
          await cloudinary.uploader.destroy(publicId, { resource_type: 'image' });
          await cloudinary.uploader.destroy(publicId, { resource_type: 'raw' });
        } catch (e) {
          console.error("Cloudinary destroy error (ignored):", e);
        }
      }
    }
  } catch (error) {
    console.error("Failed to delete file:", fileUrl, error);
  }
};

module.exports = { upload, deleteFile, cloudinary };
