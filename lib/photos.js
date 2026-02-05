/**
 * Photo storage utility for FUEL food tracker.
 * Saves meal photos to disk and returns the relative path.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PHOTOS_DIR = path.join(__dirname, '..', 'photos');

// Ensure photos directory exists
if (!fs.existsSync(PHOTOS_DIR)) {
  fs.mkdirSync(PHOTOS_DIR, { recursive: true });
}

/**
 * Save a photo from a file path (e.g., Telegram download) to the photos directory.
 * @param {string} sourcePath - Path to the source image file
 * @param {object} options - Optional metadata
 * @param {string} options.mealId - Meal ID to associate (used in filename)
 * @param {string} options.extension - File extension (auto-detected if not provided)
 * @returns {string} Relative path to saved photo (e.g., "photos/2026-02-04_abc123.jpg")
 */
function savePhoto(sourcePath, options = {}) {
  if (!sourcePath || !fs.existsSync(sourcePath)) {
    return null;
  }

  const ext = options.extension || _detectExtension(sourcePath);
  const date = new Date().toISOString().split('T')[0];
  const hash = crypto.randomBytes(6).toString('hex');
  const filename = options.mealId
    ? `${date}_meal${options.mealId}_${hash}${ext}`
    : `${date}_${hash}${ext}`;

  const destPath = path.join(PHOTOS_DIR, filename);
  fs.copyFileSync(sourcePath, destPath);

  return `photos/${filename}`;
}

/**
 * Save a photo from a Buffer (e.g., base64 decoded or HTTP response).
 * @param {Buffer} buffer - Image data
 * @param {string} extension - File extension (e.g., '.jpg', '.png')
 * @param {object} options - Optional metadata
 * @returns {string} Relative path to saved photo
 */
function savePhotoFromBuffer(buffer, extension = '.jpg', options = {}) {
  const date = new Date().toISOString().split('T')[0];
  const hash = crypto.randomBytes(6).toString('hex');
  const filename = options.mealId
    ? `${date}_meal${options.mealId}_${hash}${extension}`
    : `${date}_${hash}${extension}`;

  const destPath = path.join(PHOTOS_DIR, filename);
  fs.writeFileSync(destPath, buffer);

  return `photos/${filename}`;
}

/**
 * Get the absolute path for a relative photo path.
 * @param {string} relativePath - e.g., "photos/2026-02-04_abc123.jpg"
 * @returns {string} Absolute path
 */
function getAbsolutePath(relativePath) {
  return path.join(__dirname, '..', relativePath);
}

/**
 * Delete a photo file.
 * @param {string} relativePath - e.g., "photos/2026-02-04_abc123.jpg"
 * @returns {boolean} Whether the file was deleted
 */
function deletePhoto(relativePath) {
  const absPath = getAbsolutePath(relativePath);
  if (fs.existsSync(absPath)) {
    fs.unlinkSync(absPath);
    return true;
  }
  return false;
}

/**
 * Detect file extension from path or content.
 */
function _detectExtension(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (['.jpg', '.jpeg', '.png', '.gif', '.webp', '.heic'].includes(ext)) {
    return ext;
  }

  // Try to detect from magic bytes
  try {
    const fd = fs.openSync(filePath, 'r');
    const buf = Buffer.alloc(4);
    fs.readSync(fd, buf, 0, 4, 0);
    fs.closeSync(fd);

    if (buf[0] === 0xFF && buf[1] === 0xD8) return '.jpg';
    if (buf[0] === 0x89 && buf[1] === 0x50) return '.png';
    if (buf[0] === 0x47 && buf[1] === 0x49) return '.gif';
    if (buf.toString('ascii', 0, 4) === 'RIFF') return '.webp';
  } catch (e) {}

  return '.jpg'; // default
}

module.exports = { savePhoto, savePhotoFromBuffer, getAbsolutePath, deletePhoto, PHOTOS_DIR };
