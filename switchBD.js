"use strict";

const mysql = require('mysql');
const { query, queryOne, backgroundQuery, pool } = require('./db')
var connection = mysql.createConnection({
        "host": "localhost",
        "user": "astdom",
        "password": "Rei3jaimoojaephe",
        "database": "astdom"
});

connection.connect();

function queryMysql(query){
    return new Promise((resolve, reject)=>{
        connection.query(query, function (error, results) {
            resolve(results)
        })
    })
}

async function getLastIDMySQL(name){
    let result = await queryMysql(`SELECT id FROM ${name} ORDER BY id DESC LIMIT 1`)
    if (result && result.length){
        return result[0].id
    }
    return 1

}

async function getLastIDPSQL(name) {
    let result = await queryOne(`SELECT id FROM ${name} ORDER BY id DESC LIMIT 1`)
    if (result){
        return result.id
    }
    return 1
}



async function migrate(name, goToPSQL) {
    let lastMysql = await getLastIDMySQL(name)
    let lastPsql = await getLastIDPSQL(name)
    if (goToPSQL){
        if (lastMysql > lastPsql){
            // CHECK
            let empty = await query(`SELECT * FROM ${name} WHERE id=${lastMysql}`)
            if (empty == null){
                await query(`SELECT setval('${name + '_id_seq'}', ${lastMysql});`)
                console.log(name, `change in PSQL ID from ${lastPsql} to ${lastMysql}`)
            }
        }
    } else {
        if (lastPsql > lastMysql){
            await queryMysql(`ALTER TABLE ${name} AUTO_INCREMENT = ${lastPsql+1}`)
            console.log(name, `change in MYSQL ID from ${lastMysql} to ${lastPsql+1}`)
        }
    }
}

async function main() {
    let goToPsql = false
    try {
        await migrate('channels', goToPsql)
        await migrate('bridges', goToPsql)
        await migrate('channel_holds', goToPsql)
        await migrate('extension_dnd', goToPsql)
        await migrate('extension_lock', goToPsql)
        await migrate('transfers', goToPsql)
    } catch (e){
        console.log(e)
    }
    connection.destroy()
    pool.end()
}

main()