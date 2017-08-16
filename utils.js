"use strict";

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
        // TODO
        truePhone = '7495' + tempPhone
    }
    return truePhone
}

async function backgroundTask(tasks) {
    for (let task of tasks){
        await task()
    }
}

module.exports = {
    cleanPhone,
    getStandardPhone,
    backgroundTask,
}