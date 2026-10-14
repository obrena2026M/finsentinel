import { expect, test } from '@playwright/test';
import { createTestApp } from '../helpers/app.ts';

test('Swagger UI and OpenAPI document are available outside production', async () => {
  const { app, ctx } = await createTestApp();
  try {
    const ui = await app.inject({ method: 'GET', url: '/docs/' });
    expect(ui.statusCode).toBe(200);
    expect(ui.headers['content-type']).toContain('text/html');

    const response = await app.inject({ method: 'GET', url: '/docs/json' });
    expect(response.statusCode).toBe(200);
    const spec = response.json();
    expect(spec.info.title).toBe('FinSentinel API');
    expect(spec.paths['/api/auth/login']).toBeDefined();
    expect(spec.paths['/api/cases']).toBeDefined();
  } finally {
    await app.close();
    ctx.db.close();
  }
});

test('Swagger routes are not registered in production', async () => {
  const { app, ctx } = await createTestApp({}, { NODE_ENV: 'production' });
  try {
    const response = await app.inject({ method: 'GET', url: '/docs/' });
    expect(response.statusCode).toBe(404);
    const spec = await app.inject({ method: 'GET', url: '/docs/json' });
    expect(spec.statusCode).toBe(404);
  } finally {
    await app.close();
    ctx.db.close();
  }
});
