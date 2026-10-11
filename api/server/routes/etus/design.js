const express = require('express');
const { requireJwtAuth } = require('~/server/middleware');
const { designProxy } = require('~/server/services/Etus/design/proxy');
const { followDesignPermission } = require('~/server/services/Etus/design/agentAccess');

const router = express.Router();

router.use(requireJwtAuth);
router.use(followDesignPermission);
router.use(designProxy);

module.exports = router;
