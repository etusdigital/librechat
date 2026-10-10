const express = require('express');
const { requireJwtAuth } = require('~/server/middleware');
const { designProxy } = require('~/server/services/Etus/design/proxy');

const router = express.Router();

router.use(requireJwtAuth);
router.use(designProxy);

module.exports = router;
