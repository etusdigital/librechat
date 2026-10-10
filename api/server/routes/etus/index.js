const express = require('express');
const design = require('./design');

const router = express.Router();

router.use('/design', design);

module.exports = router;
