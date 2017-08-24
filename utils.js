"use strict";
const https = require('https');
const http = require('http');

function cleanPhone(phone) {
    return phone.replace( /^\D+/g, '')
}

function getStandardPhone(phone) {
    let truePhone = phone
    let tempPhone = cleanPhone(phone)
    if (tempPhone.length == 10){
        truePhone = '7' + tempPhone
    } else if (tempPhone.length == 11){
        if (tempPhone[0] == '8'){
            truePhone = '7' + tempPhone.slice(1)
        }
    } else if (tempPhone.length < 7){
        truePhone = tempPhone
    } else if (tempPhone.length == 7){
        truePhone = '7495' + tempPhone
    }
    return truePhone
}

async function backgroundTask(tasks) {
    try {
        for (let task of tasks) {
            await task()
        }
    } catch (e) {
        console.log(e)
    }
}

function sendRequest (connectParam, body) {
    let protocol
    if (connectParam.protocol == 'https:'){
        protocol = https
    } else {
        protocol = http
    }
    let response = ''
    return new Promise((reslove, reject) => {
        let req = protocol.request(connectParam, (res) => {
            res.setEncoding('utf8')
            res.on('data', (chunk) => {
                response += chunk
            });
            res.on('end', () => {
                reslove(response);
            });
        })
        req.setTimeout(1000 * 20, function () {
            reject(new Error(`Request timeout error - ${connectParam}`))
        })
        req.on('error', (e) => {
            reject(new Error(`The request ended in failure - ${connectParam}`))
        })
        if (connectParam.method == 'POST') {
            req.write(body)
        }
        req.end()
    })
}

module.exports = {
    cleanPhone,
    getStandardPhone,
    backgroundTask,
    sendRequest,
}