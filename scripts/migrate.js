const fs = require('fs');
const path = require('path');
require('dotenv').config();

class MigrationScript {
  constructor() {
    this.migrationsDir = path.join(__dirname, '..', 'db', 'migrations');
  }

  async run(direction = 'up', steps = null) {
    console.log(`Running database migrations ${direction}...`);

    if (!fs.existsSync(this.migrationsDir)) {
      fs.mkdirSync(this.migrationsDir, { recursive: true });
      console.log(`Created migrations directory: ${this.migrationsDir}`);
      return;
    }

    const migrations = fs.readdirSync(this.migrationsDir).sort();
    console.log(`Found ${migrations.length} migration(s)`);

    for (let i = 0; i < (steps || migrations.length); i++) {
      const migration = migrations[i];
      console.log(`Running migration: ${migration}`);
      await this.executeMigration(migration, direction);
    }

    console.log(`Migrations ${direction} completed`);
  }

  async executeMigration(filename, direction) {
    console.log(`Executing ${direction}: ${filename}`);
  }

  async createMigration(name) {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const filename = `${timestamp}_${name}.sql`;
    const filepath = path.join(this.migrationsDir, filename);

    const content = `-- Migration: ${name}\n-- Created: ${new Date().toISOString()}\n\n${direction === 'up' ? 'BEGIN;\n\nCOMMIT;' : ''}`;

    fs.writeFileSync(filepath, content);
    console.log(`Created migration: ${filename}`);
  }
}

const script = new MigrationScript();
const command = process.argv[2];
const steps = process.argv[3] ? parseInt(process.argv[3]) : null;
script.run(command, steps).catch(console.error);
