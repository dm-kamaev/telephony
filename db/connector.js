const {Pool} = require('pg')
const config = require('config');
const errorLog = require('../logger')(module, 'error.log')
const systemLog = require('../logger')(module, 'system.log')

const pool = new Pool({
    user: config.db.user,
    host: config.db.host,
    database: config.db.database,
    password: config.db.password,
    port: 5432,
})

async function queryOne(querySQL, args) {
    systemLog.info('QUERY ' + querySQL)
    systemLog.info('idle count' + pool.idleCount)
    systemLog.info('total count' + pool.totalCount)
    const client = await pool.connect()
    try {
        const res = await pool.query(querySQL, args)
        if (res.rowCount == 0) {
            return null
        }
        return res.rows[0]
    } catch (e) {
        errorLog.error(e.stack)
    }
    finally {
        client.release(true)
    }
}

function backgroundQuery(querySQL, getArgs) {
    systemLog.info('QUERY ' + querySQL)
    systemLog.info('idle count' + pool.idleCount)
    systemLog.info('total count' + pool.totalCount)
    pool.connect(async(err, client, done) => {
        try {
            if (err) {
                errorLog.error(err)
                return
            }
            let args = null
            if (getArgs) {
                args = await getArgs()
            }
            await client.query(querySQL, args)
        } catch (e) {
            errorLog.error(e)
        } finally {
            client.release(true)
        }
    })
}

async function query(querySQL, args) {
    systemLog.info('QUERY ' + querySQL)
    systemLog.info('idle count' + pool.idleCount)
    systemLog.info('total count' + pool.totalCount)
    const client = await pool.connect()
    try {
        const res = await pool.query(querySQL, args)
        if (res.rowCount == 0) {
            return null
        }
        return res.rows
    } catch (e) {
        console.log(e.stack)
    }
    finally {
        client.release(true)
    }
}

module.exports = {
    query,
    queryOne,
    backgroundQuery,
    pool,
}