/**
 * File Handler Service
 * Manages temporary file storage and URLs for sending media through WhatsApp/LINE
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

class FileHandler {
  constructor() {
    // Create temp directory if it doesn't exist
    this.tempDir = path.join(__dirname, '../../temp_uploads');
    if (!fs.existsSync(this.tempDir)) {
      fs.mkdirSync(this.tempDir, { recursive: true });
    }

    // Clean up old files every hour
    setInterval(() => this.cleanupOldFiles(), 60 * 60 * 1000);
  }

  /**
   * Save uploaded file to temp directory
   * @param {Buffer} fileBuffer - File buffer from multer
   * @param {string} originalName - Original filename
   * @param {string} mimeType - File MIME type
   * @returns {Object} File info including path and URL
   */
  async saveFile(fileBuffer, originalName, mimeType) {
    try {
      // Generate unique filename
      const fileId = crypto.randomBytes(16).toString('hex');
      const ext = path.extname(originalName);
      const filename = `${fileId}${ext}`;
      const filepath = path.join(this.tempDir, filename);

      // Save file
      await fs.promises.writeFile(filepath, fileBuffer);

      console.log(`📁 Saved file: ${filename} (${fileBuffer.length} bytes)`);

      return {
        id: fileId,
        filename: filename,
        originalName: originalName,
        path: filepath,
        mimeType: mimeType,
        size: fileBuffer.length,
        createdAt: Date.now()
      };
    } catch (error) {
      console.error('Error saving file:', error);
      throw error;
    }
  }

  /**
   * Get file URL for sending through APIs
   * Note: In production, you'd upload to S3/Cloud Storage and return public URL
   * For now, we'll use a local file server endpoint
   * @param {string} fileId - File ID
   * @returns {string} Public URL for the file
   */
  getFileUrl(fileId, filename) {
    // In production, this would return an S3/Cloud Storage URL
    // For now, return local server URL
    const baseUrl = process.env.PUBLIC_URL || `https://bma-messenger-hub-ooyy.onrender.com`;
    return `${baseUrl}/files/${filename}`;
  }

  /**
   * Read file from temp directory
   * @param {string} filename - Filename to read
   * @returns {Object} File data and metadata
   */
  async readFile(filename) {
    try {
      const filepath = path.join(this.tempDir, filename);

      if (!fs.existsSync(filepath)) {
        throw new Error('File not found');
      }

      const stats = await fs.promises.stat(filepath);
      const data = await fs.promises.readFile(filepath);

      // Determine MIME type based on extension
      const ext = path.extname(filename).toLowerCase();
      const mimeTypes = {
        '.pdf': 'application/pdf',
        '.doc': 'application/msword',
        '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        '.xls': 'application/vnd.ms-excel',
        '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        '.jpg': 'image/jpeg',
        '.jpeg': 'image/jpeg',
        '.png': 'image/png',
        '.gif': 'image/gif',
        '.mp4': 'video/mp4',
        '.mp3': 'audio/mpeg',
        '.wav': 'audio/wav'
      };

      const mimeType = mimeTypes[ext] || 'application/octet-stream';

      return {
        data: data,
        mimeType: mimeType,
        size: stats.size,
        filename: filename
      };
    } catch (error) {
      console.error('Error reading file:', error);
      throw error;
    }
  }

  /**
   * Delete a file from temp directory
   * @param {string} filename - Filename to delete
   */
  async deleteFile(filename) {
    try {
      const filepath = path.join(this.tempDir, filename);
      if (fs.existsSync(filepath)) {
        await fs.promises.unlink(filepath);
        console.log(`🗑️ Deleted file: ${filename}`);
      }
    } catch (error) {
      console.error('Error deleting file:', error);
    }
  }

  /**
   * Clean up files older than 24 hours
   */
  async cleanupOldFiles() {
    try {
      const files = await fs.promises.readdir(this.tempDir);
      const now = Date.now();
      const maxAge = 24 * 60 * 60 * 1000; // 24 hours

      for (const filename of files) {
        const filepath = path.join(this.tempDir, filename);
        const stats = await fs.promises.stat(filepath);

        if (now - stats.mtimeMs > maxAge) {
          await this.deleteFile(filename);
        }
      }
    } catch (error) {
      console.error('Error cleaning up old files:', error);
    }
  }

  /**
   * Get file statistics
   * @returns {Object} Statistics about stored files
   */
  async getStats() {
    try {
      const files = await fs.promises.readdir(this.tempDir);
      let totalSize = 0;

      for (const filename of files) {
        const filepath = path.join(this.tempDir, filename);
        const stats = await fs.promises.stat(filepath);
        totalSize += stats.size;
      }

      return {
        fileCount: files.length,
        totalSize: totalSize,
        totalSizeMB: (totalSize / (1024 * 1024)).toFixed(2)
      };
    } catch (error) {
      return {
        fileCount: 0,
        totalSize: 0,
        totalSizeMB: 0
      };
    }
  }
}

// Export singleton instance
const fileHandler = new FileHandler();

module.exports = {
  fileHandler,
  saveFile: (fileBuffer, originalName, mimeType) =>
    fileHandler.saveFile(fileBuffer, originalName, mimeType),
  getFileUrl: (fileId, filename) =>
    fileHandler.getFileUrl(fileId, filename),
  readFile: (filename) =>
    fileHandler.readFile(filename),
  deleteFile: (filename) =>
    fileHandler.deleteFile(filename),
  getStats: () =>
    fileHandler.getStats()
};