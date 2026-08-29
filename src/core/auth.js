const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');

class AuthHandler {
  constructor(config = {}) {
    this.config = {
      jwtSecret: config.jwtSecret || process.env.JWT_SECRET || 'default-secret',
      tokenExpiry: config.tokenExpiry || '24h',
      encryptionKey: config.encryptionKey || process.env.ENCRYPTION_KEY || 'default-encryption-key-32'
    };
  }

  async initialize() {
    if (!this.config.jwtSecret || this.config.jwtSecret === 'default-secret') {
      console.warn('Using default JWT secret. Set JWT_SECRET in production.');
    }
  }

  async hashPassword(password) {
    const saltRounds = 12;
    return bcrypt.hash(password, saltRounds);
  }

  async verifyPassword(password, hash) {
    return bcrypt.compare(password, hash);
  }

  generateToken(payload) {
    return jwt.sign(payload, this.config.jwtSecret, {
      expiresIn: this.config.tokenExpiry
    });
  }

  verifyToken(token) {
    try {
      return jwt.verify(token, this.config.jwtSecret);
    } catch (error) {
      throw new Error('Invalid or expired token');
    }
  }

  getHeaders() {
    return {
      'Authorization': `Bearer ${this.generateToken({ type: 'service', timestamp: Date.now() })}`
    };
  }

  encrypt(text) {
    const crypto = require('crypto');
    const key = crypto.scryptSync(this.config.encryptionKey, 'salt', 32);
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv('aes-256-cbc', key, iv);
    let encrypted = cipher.update(text, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    return iv.toString('hex') + ':' + encrypted;
  }

  decrypt(text) {
    const crypto = require('crypto');
    const key = crypto.scryptSync(this.config.encryptionKey, 'salt', 32);
    const parts = text.split(':');
    const iv = Buffer.from(parts[0], 'hex');
    const encrypted = parts[1];
    const decipher = crypto.createDecipheriv('aes-256-cbc', key, iv);
    let decrypted = decipher.update(encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  }
}

module.exports = AuthHandler;
