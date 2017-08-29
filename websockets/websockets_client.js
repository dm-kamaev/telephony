"use strict";

"use strict";
const WebSocket = require('ws');

function WebSocketClient(){
	this.autoReconnectInterval = 2000*10;	// ms
}

WebSocketClient.prototype.open = function(url){
	this.url = url;
    this.canReconnect = true
	this.instance = new WebSocket(this.url);
	this.instance.on('open',()=>{
		this.onopen();
	});
	this.instance.on('message',(data,flags)=>{
		this.onmessage(data,flags);
	});
	this.instance.on('close',(e)=>{
		switch (e){
		case 1000:	// CLOSE_NORMAL
			console.log("WebSocket: closed");
			break;
		default:	// Abnormal closure
            console.log('ON CLOSE')
			this.reconnect(e);
			break;
		}
		this.onclose(e);
	});
	this.instance.on('error',(e)=>{
		switch (e.code){
		case 'ECONNREFUSED':
		    console.log('ON ERROR')
			this.reconnect(e);
			break;
		default:
			this.onerror(e);
			break;
		}
	});
}
WebSocketClient.prototype.send = function(data,option){
	try{
		this.instance.send(data,option);
	}catch (e){
		this.instance.emit('error',e);
	}
}
WebSocketClient.prototype.reconnect = function(e){
	console.log(`WebSocketClient: retry in ${this.autoReconnectInterval}ms`,e);
	var that = this;
    if (this.canReconnect){
        this.canReconnect = false
        setTimeout(function(){
            console.log("WebSocketClient: reconnecting...");
            that.canReconnect = true
            that.open(that.url);
        },this.autoReconnectInterval);
    }

}

WebSocketClient.prototype.onerror = function(e){	console.log("WebSocketClient: error",arguments);	}
WebSocketClient.prototype.onclose = function(e){	console.log("WebSocketClient: closed",arguments);	}

module.exports = WebSocketClient
