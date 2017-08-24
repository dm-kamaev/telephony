const { Pool } = require('pg')
const config = require('config');
const errorLog = require('logger')(module, 'error.log')

const pool = new Pool({
  user: config.db.user,
  host: config.db.host,
  database: config.db.database,
  password: config.db.password,
  port: 5432,
})

async function queryOne (querySQL, args) {
    // console.log(querySQL)
    // console.log(pool.idleCount)
    // console.log(pool.totalCount)
  const client = await pool.connect()
  try {
    const res = await pool.query(querySQL, args)
    if (res.rowCount == 0){
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
    // console.log(querySQL)
    pool.connect(async (err, client, done) => {
        if (err){
            errorLog.error(err)
            return
        }
        let args = null
        if (getArgs){
            args = await getArgs()
        }
        client.query(querySQL, args, (err, res)=>{
            client.release()
            if (err){
                errorLog.error(err)
            }
        })
    })
}

async function query (querySQL, args) {
    // console.log(querySQL)
    // console.log(pool.idleCount)
    // console.log(pool.totalCount)
  const client = await pool.connect()
  try {
    const res = await pool.query(querySQL, args)
    if (res.rowCount == 0){
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