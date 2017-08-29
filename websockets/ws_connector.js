"use strict";
const config = require('config');
const WebSocketClient = require('./websockets_client')
const logicLog = require('../logger')(module, 'logic.log')


const wsc = new WebSocketClient();


wsc.onopen = function() {
    logicLog.info('start WS working')
    this.send(JSON.stringify({'Type': 'Request', 'Name': 'SpecialClient', 'Key': config.ws.authKey}));
};

wsc.onmessage = function(message) {
    if (this.appInterface){
        this.appInterface.router(message)
    }
};

module.exports = wsc
