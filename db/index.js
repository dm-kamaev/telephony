"use strict";

const { query, queryOne, backgroundQuery, pool } = require('./connector')

module.exports = {
    query,
    queryOne,
    backgroundQuery,
    pool,
}