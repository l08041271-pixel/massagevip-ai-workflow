const winston = require('winston');

class Logger {
  constructor() {
    this.logger = null;
  }

  async initialize(config) {
    const logLevel = config?.logLevel || 'info';
    const transports = [
      new winston.transports.Console({
        format: winston.format.combine(
          winston.format.timestamp(),
          winston.format.colorize(),
          winston.format.printf(({ timestamp, level, message, ...meta }) => {
            return `${timestamp} [${level}]: ${message} ${Object.keys(meta).length ? JSON.stringify(meta) : ''}`;
          })
        )
      })
    ];

    if (config?.file) {
      transports.push(
        new winston.transports.File({
          filename: config.file?.error || 'logs/error.log',
          level: 'error'
        }),
        new winston.transports.File({
          filename: config.file?.combined || 'logs/combined.log'
        })
      );
    }

    this.logger = winston.createLogger({
      transports,
      level: logLevel
    });
  }

  info(message, meta = {}) {
    this.logger?.info(message, meta);
  }

  warn(message, meta = {}) {
    this.logger?.warn(message, meta);
  }

  error(message, meta = {}) {
    this.logger?.error(message, meta);
  }

  debug(message, meta = {}) {
    this.logger?.debug(message, meta);
  }

  child(meta) {
    return this.logger?.child(meta);
  }
}

module.exports = Logger;
