const nodemailer = require('nodemailer');

class Alerts {
  constructor() {
    this.rules = new Map();
    this.config = {};
    this.transporter = null;
  }

  async initialize(config) {
    this.config = {
      email: config.email,
      thresholds: config.thresholds || {}
    };

    if (this.config.email) {
      this.transporter = nodemailer.createTransport({
        host: process.env.SMTP_HOST,
        port: process.env.SMTP_PORT || 587,
        secure: false,
        auth: {
          user: process.env.SMTP_USER,
          pass: process.env.SMTP_PASS
        }
      });
    }
  }

  addRule(name, rule) {
    this.rules.set(name, {
      ...rule,
      triggeredAt: null,
      cooldown: rule.cooldown || 300000
    });
  }

  removeRule(name) {
    this.rules.delete(name);
  }

  async evaluate(metricName, value) {
    for (const [name, rule] of this.rules) {
      if (rule.metric === metricName) {
        const threshold = this.config.thresholds[metricName] || rule.threshold;
        if (value > threshold) {
          const now = Date.now();
          if (!rule.triggeredAt || (now - rule.triggeredAt) > rule.cooldown) {
            rule.triggeredAt = now;
            await this.trigger(name, rule, value);
          }
        }
      }
    }
  }

  async trigger(name, rule, value) {
    console.warn(`Alert triggered: ${name} - ${value} ${rule.unit || ''}`);
    if (this.transporter) {
      await this.sendEmail(name, rule, value);
    }
  }

  async sendEmail(name, rule, value) {
    if (!this.transporter || !this.config.email) return;

    const mailOptions = {
      from: process.env.SMTP_FROM || 'alerts@bots.business',
      to: this.config.email,
      subject: `[ALERT] ${name}`,
      text: `Alert: ${name}\nMetric: ${rule.metric}\nValue: ${value}\nThreshold: ${rule.threshold}\nTime: ${new Date().toISOString()}`
    };

    try {
      await this.transporter.sendMail(mailOptions);
    } catch (error) {
      console.error('Failed to send alert email:', error.message);
    }
  }
}

module.exports = Alerts;
