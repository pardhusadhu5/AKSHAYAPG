const multer = require('multer');
const path = require('path');
const fs = require('fs');

let CloudinaryStorage = null;
let cloudinary = null;
let hasCloudinary = false;

try {
  CloudinaryStorage = require('multer-storage-cloudinary').CloudinaryStorage;
  cloudinary = require('cloudinary').v2;
  hasCloudinary = !!(process.env.CLOUDINARY_CLOUD_NAME && process.env.CLOUDINARY_API_KEY && process.env.CLOUDINARY_API_SECRET);
  if (hasCloudinary) {
    cloudinary.config({
      cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
      api_key: process.env.CLOUDINARY_API_KEY,
      api_secret: process.env.CLOUDINARY_API_SECRET
    });
  }
} catch (_) {
  hasCloudinary = false;
}

// Ensure local uploads directory exists
const uploadsDir = path.join(__dirname, '..', 'uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

const cloudStorage = (hasCloudinary && CloudinaryStorage) ? new CloudinaryStorage({
  cloudinary: cloudinary,
  params: async (req, file) => ({
    folder: 'akshaya_pg_uploads',
    resource_type: 'auto',
    public_id: Date.now() + '-' + Math.round(Math.random() * 1E9)
  })
}) : null;

const localStorage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadsDir),
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, uniqueSuffix + path.extname(file.originalname));
  }
});

const fileFilter = (req, file, cb) => {
  const filetypes = /jpeg|jpg|png|pdf/;
  const mimetype = filetypes.test(file.mimetype) || file.mimetype === 'application/pdf';
  const extname = filetypes.test(path.extname(file.originalname).toLowerCase());

  if (mimetype && extname) {
    return cb(null, true);
  }
  cb(new Error('Only JPEG, JPG, PNG, and PDF files are allowed. Max size 5MB.'));
};

const upload = multer({
  storage: hasCloudinary ? cloudStorage : localStorage,
  fileFilter: fileFilter,
  limits: { fileSize: 5 * 1024 * 1024 } // 5MB limit per file
});

// Fields configuration for Student Admission Application documents
const uploadApplicationFields = upload.fields([
  { name: 'photo', maxCount: 1 },
  { name: 'document_collegeId', maxCount: 1 },
  { name: 'document_aadhaar', maxCount: 1 },
  { name: 'document_parentId', maxCount: 1 },
  { name: 'document_bonafide', maxCount: 1 },
  { name: 'document_joiningLetter', maxCount: 1 },
  { name: 'document_marksMemo', maxCount: 1 },
  { name: 'document_other', maxCount: 1 }
]);

const extractPublicId = (url) => {
  if (!url || !url.includes('cloudinary.com')) return null;
  const parts = url.split('/');
  const uploadIndex = parts.findIndex(p => p === 'upload');
  if (uploadIndex === -1) return null;
  const relevantParts = parts.slice(uploadIndex + 2);
  const fullPath = relevantParts.join('/');
  const lastDotIndex = fullPath.lastIndexOf('.');
  if (lastDotIndex !== -1) {
    return fullPath.substring(0, lastDotIndex);
  }
  return fullPath;
};

const deleteFile = async (fileUrl) => {
  try {
    if (!fileUrl) return;
    if (fileUrl.startsWith('/uploads/')) {
      const absolutePath = path.join(__dirname, '..', fileUrl);
      if (fs.existsSync(absolutePath)) {
        fs.unlinkSync(absolutePath);
      }
    } else if (fileUrl.includes('cloudinary.com')) {
      const publicId = extractPublicId(fileUrl);
      if (publicId) {
        try {
          await cloudinary.uploader.destroy(publicId, { resource_type: 'image' });
          await cloudinary.uploader.destroy(publicId, { resource_type: 'raw' });
        } catch (e) {}
      }
    }
  } catch (error) {
    console.error("Failed to delete file:", fileUrl, error);
  }
};

module.exports = { upload, uploadApplicationFields, deleteFile, cloudinary };
