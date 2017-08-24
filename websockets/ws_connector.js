"use strict";
const config = require('config');
const WebSocketClient = require('./websockets_client')


const wsc = new WebSocketClient();
wsc.open(config.ws.address);

wsc.onopen = function() {
    this.send(JSON.stringify({'Type': 'Request', 'Name': 'SpecialClient', 'Key': config.ws.authKey}));
};

wsc.onmessage = function(message) {
    if (this.appInterface !== null){
        this.appInterface.router(message)
    }
};

module.exports = wsc
