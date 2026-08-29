const fs = require('fs');
const path = require('path');
require('dotenv').config();

class SetupScript {
  async run() {
    console.log('Running Bots.Business Integration Framework setup...');

    await this.createDirectories();
    await this.createEnvFile();
    await this.validateEnvironment();
    await this.initializeDatabase();

    console.log('Setup completed successfully!');
  }

  async createDirectories() {
    const dirs = [
      'logs',
      'credentials',
      'data',
      'tmp'
    ];

    for (const dir of dirs) {
      const fullPath = path.join(__dirname, '..', dir);
      if (!fs.existsSync(fullPath)) {
        fs.mkdirSync(fullPath, { recursive: true });
        console.log(`Created directory: ${dir}`);
      }
    }
  }

  async createEnvFile() {
    const envExamplePath = path.join(__dirname, '..', '.env.example');
    const envPath = path.join(__dirname, '..', '.env');

    if (!fs.existsSync(envPath) && fs.existsSync(envExamplePath)) {
      fs.copyFileSync(envExamplePath, envPath);
      console.log('Created .env file from .env.example');
    }
  }

  async validateEnvironment() {
    const required = [
      'NODE_ENV',
      'DATABASE_URL',
      'REDIS_URL',
      'JWT_SECRET',
      'ENCRYPTION_KEY'
    ];

    const missing = required.filter(key => !process.env[key]);
    if (missing.length > 0) {
      console.warn(`Missing environment variables: ${missing.join(', ')}`);
    } else {
      console.log('All required environment variables are set');
    }
  }

  async initializeDatabase() {
    console.log('Database initialization would run migrations here');
  }
}

const script = new SetupScript();
script.run().catch(console.error);
