const fs = require('fs').promises;
const csv = require('csv-parser');
const { createObjectCsvWriter } = require('csv-writer');

class CSVHandler {
  constructor() {
    this.name = 'csv';
  }

  async read(filePath, options = {}) {
    const results = [];
    const stream = require('fs').createReadStream(filePath);

    return new Promise((resolve, reject) => {
      stream
        .pipe(csv(options))
        .on('data', (data) => results.push(data))
        .on('end', () => resolve(results))
        .on('error', reject);
    });
  }

  async write(filePath, data, headers, options = {}) {
    const csvWriter = createObjectCsvWriter({
      path: filePath,
      headers: headers.map(h => ({ id: h, title: h })),
      ...options
    });

    await csvWriter.writeRecords(data);
    return filePath;
  }

  async append(filePath, data, headers, options = {}) {
    const csvWriter = createObjectCsvWriter({
      path: filePath,
      headers: headers.map(h => ({ id: h, title: h })),
      append: true,
      ...options
    });

    await csvWriter.writeRecords(data);
    return filePath;
  }

  async exists(filePath) {
    try {
      await fs.access(filePath);
      return true;
    } catch {
      return false;
    }
  }

  async delete(filePath) {
    await fs.unlink(filePath);
  }

  async validate(filePath, requiredHeaders) {
    const data = await this.read(filePath);
    if (data.length === 0) {
      return { valid: false, error: 'CSV file is empty' };
    }

    const headers = Object.keys(data[0]);
    const missingHeaders = requiredHeaders.filter(h => !headers.includes(h));

    if (missingHeaders.length > 0) {
      return { valid: false, error: `Missing headers: ${missingHeaders.join(', ')}` };
    }

    return { valid: true, rowCount: data.length };
  }
}

module.exports = new CSVHandler();
