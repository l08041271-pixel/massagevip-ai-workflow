const { IntegrationRegistry } = require('../../src/integrations');

describe('Integration Registry', () => {
  let registry;

  beforeEach(() => {
    registry = new IntegrationRegistry();
  });

  test('should list all available integration domains', () => {
    const domains = registry.list();
    expect(domains).toHaveProperty('crm');
    expect(domains).toHaveProperty('sheets');
    expect(domains).toHaveProperty('analytics');
    expect(domains).toHaveProperty('payments');
    expect(domains).toHaveProperty('email');
  });

  test('should throw error for unknown domain', () => {
    expect(() => registry.get('unknown', 'test')).toThrow('Unknown integration domain');
  });
});
