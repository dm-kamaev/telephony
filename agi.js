'use strict';
var aio = require('asterisk.io'),
    ami = null,   // see ami section
    agi = null;   // see agi section
const asyncAGI = require('./asyncAGI')


agi = aio.agi(4573); // port and host
agi.on('error', function(err){
    throw err;
});

agi.on('listening', function(){
    console.log('listening on port 14000');
});

agi.on('close', function(){
    //    console.log('close');
});

agi.on('connection', async function(agiHandler){
    asyncAGI(agiHandler)

    agiHandler.on('hangup', function(){
        // console.log('hangup');
    });

    agiHandler.on('error', function(err){
        throw err;
    });

    agiHandler.on('close', function(){
        //console.log('close');
    });

    // answer the channel
    //await agiHandler.asyncCommand('ANSWER')
    console.log('AGI')
    let result = await agiHandler.asyncCommand('EXEC Dial SIP/112, 60')
});