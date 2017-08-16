'use strict';


async function asyncAction(action, opts){
    opts = opts || {}
    return new Promise((resolve, reject)=>{
        this.action(action, opts, function (data) {
            resolve(data)
        })
    })
}

async function asyncGetDB(family, key) {
    return new Promise(async (resolve, reject)=> {
        function handlerGetDB(event) {
            this.removeListener('eventDBGetResponse', handlerGetDB)
            resolve(event['Val'])
        }
        this.on('eventDBGetResponse', handlerGetDB)
        let response = await this.asyncAction('DBGet', {Family: family, Key: key})
        if (response['Response'] == 'Error'){
            this.removeListener('eventDBGetResponse', handlerGetDB)
            resolve(null)
            return
        }


    })
}

module.exports = function (ami) {
    ami.asyncAction = asyncAction.bind(ami)
    ami.asyncGetDB = asyncGetDB.bind(ami)
}