'use strict';
var aio = require('asterisk.io')
const asyncAGI = require('./asyncAGI')
const { agiSwitch } = require('./agiSwitch')
const { appInterface } = require('./ami')
const logicLog = require('./logger')(module, 'logic.log')


appInterface.emitter.once('CollectionLoaded', function () {
    const agi = aio.agi(4573); // port and host
    agi.on('error', function(err){
        throw err;
    });

    agi.on('listening', function(){
        logicLog.info('start AGI listening')
    });

    agi.on('close', function(){
        logicLog.info('stop AGI listening')
    });

    agi.on('connection', async function(agiConnection){
        asyncAGI(agiConnection)

        agiConnection.on('hangup', function(){
        });

        agiConnection.on('error', function(err){
            throw err;
        });

        agiConnection.on('close', function(){
        });

        let channel = appInterface.channelCollection.getByName(agiConnection.agi_channel)
        if (agiConnection.agi_extension == '*78'){
            await agiConnection.asyncCommand('ANSWER')
            await agiConnection.asyncCommand('HANGUP')
            await channel.extension.setDND(true)
            return
        }
        if (agiConnection.agi_extension == '*79'){
            await agiConnection.asyncCommand('ANSWER')
            await agiConnection.asyncCommand('HANGUP')
            await channel.extension.setDND(false)
            return
        }
        try{
            await agiSwitch(agiConnection, channel)
        } catch (e){
            console.log(e)
        }
    });
})
