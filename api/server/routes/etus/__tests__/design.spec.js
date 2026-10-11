jest.mock('~/server/middleware', () => ({
  requireJwtAuth: jest.fn((req, res, next) => {
    if (req.headers.authorization !== 'Bearer chat.jwt') {
      return res.status(401).json({ message: 'Unauthorized' });
    }
    req.user = { id: 'user-1' };
    return next();
  }),
}));

jest.mock('~/server/services/Etus/design/proxy', () => ({
  designProxy: jest.fn((req, res) =>
    res.json({ method: req.method, url: req.url, user: req.user.id }),
  ),
}));

jest.mock('~/server/services/Etus/design/agentAccess', () => ({
  followDesignPermission: jest.fn((req, res, next) => next()),
}));

const express = require('express');
const request = require('supertest');
const { requireJwtAuth } = require('~/server/middleware');
const { designProxy } = require('~/server/services/Etus/design/proxy');
const { followDesignPermission } = require('~/server/services/Etus/design/agentAccess');
const etusRoutes = require('../index');

const app = express();
app.use('/api/etus', etusRoutes);

describe('/api/etus routes', () => {
  beforeEach(() => jest.clearAllMocks());

  it('requires the chat session before the design proxy', async () => {
    const response = await request(app).get('/api/etus/design/me');
    expect(response.status).toBe(401);
    expect(requireJwtAuth).toHaveBeenCalledTimes(1);
    expect(designProxy).not.toHaveBeenCalled();
    expect(followDesignPermission).not.toHaveBeenCalled();
  });

  it('lets the design agents follow the permission before the proxy answers', async () => {
    const response = await request(app)
      .get('/api/etus/design/me')
      .set('Authorization', 'Bearer chat.jwt');
    expect(response.status).toBe(200);
    expect(followDesignPermission).toHaveBeenCalledTimes(1);
    expect(followDesignPermission.mock.calls[0][0].path).toBe('/me');
    expect(followDesignPermission.mock.invocationCallOrder[0]).toBeLessThan(
      designProxy.mock.invocationCallOrder[0],
    );
  });

  it('hands every method under /design to the proxy with the rest of the path', async () => {
    for (const method of ['get', 'post', 'put', 'patch', 'delete']) {
      const response = await request(app)
        [method]('/api/etus/design/projects/prj_1/files/content?path=index.html')
        .set('Authorization', 'Bearer chat.jwt');
      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        method: method.toUpperCase(),
        url: '/projects/prj_1/files/content?path=index.html',
        user: 'user-1',
      });
    }
    expect(designProxy).toHaveBeenCalledTimes(5);
  });

  it('leaves other paths under /api/etus alone', async () => {
    const response = await request(app)
      .get('/api/etus/other')
      .set('Authorization', 'Bearer chat.jwt');
    expect(response.status).toBe(404);
    expect(requireJwtAuth).not.toHaveBeenCalled();
  });
});
