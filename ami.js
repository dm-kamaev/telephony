"use strict";
const aio = require('asterisk.io')
const config = require('config');
const asyncAMI = require('./asyncAMI')
const { query, queryOne, backgroundQuery } = require('./db')
const { Channel } = require('./channels')
const logicLog = require('./logger')(module, 'logic.log')
const errorLog = require('./logger')(module, 'error.log')
const uuidv4 = require('uuid/v4');
const { AppInterface } = require('./interface')
const { sendRequest } = require('./utils')
const { URL } = require('url')

const ami = aio.ami(
    config.ami.host,
    config.ami.port,
    config.ami.login,
    config.ami.password
);

asyncAMI(ami)
const appInterface = new AppInterface(ami)
appInterface.reloadMainSettings()
ami.appInterface = appInterface


const re_number = /^(?:PJ)?SIP\/(?:([^\/]+)\/)?(\w+)/g
const re_voxlink = /^(IAX2\/voxlink)-/g
const re_trunk = /^(?:PJ)?(SIP\/.+)-[^-]+/g

function getUniqueTempID(event) {
    let linkedID = event['Linkedid']
    let destLinkedID = event['DestLinkedid']
    if (linkedID && destLinkedID){
        return linkedID + destLinkedID
    }
    return null
}

function parseChannelName(channelName) {
    re_number.lastIndex = 0
    let parseData = re_number.exec(channelName)
    if (parseData){
        return {number: parseData[2], trunk: parseData[1]}
    }
}

function parseVoxlinkChannel(channelName) {
    re_voxlink.lastIndex = 0
    let parseData = re_voxlink.exec(channelName)
    if (parseData){
        return { trunk: parseData[1]}
    } else {
        return null
    }
}

function parseTrunkName(channelName) {
    re_trunk.lastIndex = 0
    let parseData = re_trunk.exec(channelName)
    if (parseData) {
        return {trunk: parseData[1]}
    }
}

function convertChannelStatus(status){
    if (status == '6'){
        return 1
    } else {
        return null
    }
}


/* Extension Start */
async function extensionStateList() {
    let values = []

    async function addExtensionStatus(event) {
        values.push(event)
    }

    async function extractValues() {
        try{
            for (let extension of appInterface.extensionCollection.collection){
                if (appInterface.reloadedExtension.indexOf(extension.exten) == -1){
                    appInterface.extensionCollection.remove(extension)
                }
            }

            ami.removeListener(Event("ExtensionStatus"), addExtensionStatus)
            ami.removeListener(Event("ExtensionStatus"), extractValues)
            await loadExtensions(values)
        } catch (e) {
            errorLog.error(e)
        }
    }

    ami.on(Event("ExtensionStatus"), addExtensionStatus)
    ami.on(Event("ExtensionStateListComplete"), extractValues)
}


async function loadExtensions(events) {
    for (let event of events){
        appInterface.reloadedExtension.push(event['Exten'])
        let extension = await appInterface.extensionCollection.add_or_reload(event['Exten'], event['Status'], ami)
        await extension.checkDND()
        await extension.checkLock()
    }

    // Handle change status from AMI
    ami.on(Event('ExtensionStatus'), handlerExtension)
    appInterface.emitter.emit('CollectionLoaded')
}


async function handlerExtension(event){
    await appInterface.extensionCollection.checkExten(event['Exten'], event['Status'], ami)
    // Для корректного отображения при DND, HOLD
    if (['0', '1', '16'].indexOf(event['Status']) < 0){
        let extension = appInterface.extensionCollection.getByExten(event['Exten'])
        extension.setStatusWS(event['Status'])
    }
    // Что бы обновлялся статус ws при перезагрузке телефона (мб костыль)
    if (event['Status'] == '0'){
        let extension = appInterface.extensionCollection.getByExten(event['exten'])
        if (extension && extension.statusWS == '4'){
            extension.setStatusWS('0')
        }
    }

}

/* Extension End */

/* Channels Start*/
async function addChannel(event, channel_id) {
    channel_id = channel_id || null
    try {
        let number, extension, trunk
        const voxLinkData = parseVoxlinkChannel(event['Channel'])
        if (voxLinkData){
            number = '911'
            extension = null
            trunk = appInterface.trunkCollection.getByChannelName(voxLinkData.trunk)
        }
        else {
            let resultDict = parseChannelName(event['Channel'])
            extension = appInterface.extensionCollection.getByExten(resultDict['number'])
            trunk = null
            if (['', 's'].indexOf(event['Exten']) < 0) {
                trunk = appInterface.trunkCollection.getByChannelName('SIP/' + event['Exten'])
            }
            if (trunk == null) {
                let trunkName = parseTrunkName(event['Channel'])
                trunk = appInterface.trunkCollection.getByChannelName(trunkName.trunk)
                //trunk = appInterface.trunkCollection.getByChannelName(event['Channel'].split('-')[0])
            }
            if (trunk) {
                number = event['CallerIDNum']
            } else {
                number = resultDict['number']
            }
        }
        let channel = new Channel(event['Channel'], event['Uniqueid'], number, extension, trunk, event['Exten'], channel_id)
        appInterface.channelCollection.add(channel)
        if (channel_id){
            logicLog.info(`Loaded ${channel}`)
        } else {
            await channel.createInDB()
            let today = new Date()
            let recordPath = `${today.getFullYear()}/${today.getMonth()+1}/${today.getDate()}/`
            ami.action("MixMonitor", {'Channel': event['Channel'], 'File': `${recordPath}${channel.id}.wav`})
            logicLog.info(`Created ${channel}`)
        }
    } catch (e){
        errorLog.error(e)
    }
}

function closeChannel(event) {
    try {
        let channel = appInterface.channelCollection.getByName(event['Channel'])
        channel.close({'txt': event['Cause-txt'], 'code': event['Cause']})
        if (channel.extension) {
            appInterface.newCallState(channel, 4, [channel.extension.flagWS])
            channel.extension.setStatusWS('0')
        }
    } catch (e){
        errorLog.error(e)
        errorLog.error(event)
    }
}

function holdChannel(event) {
    try {
        let channel = appInterface.channelCollection.getByName(event['Channel'])
        channel.setHold(true)
        if (channel.extension) {
            appInterface.newCallState(channel, 5, [channel.extension.flagWS])
        }
    } catch (e){
        errorLog.error(event)
        errorLog.error(e)
    }
}

function unholdChannel(event) {
    try {
        let channel = appInterface.channelCollection.getByName(event['Channel'])
        channel.setHold(false)
        if (channel.extension){
            appInterface.newCallState(channel, convertChannelStatus(event['ChannelState']), [channel.extension.flagWS])
        }
    } catch (e){
        errorLog.error(event)
        errorLog.error(e)
    }

}

function newStateChannel(event) {
    try {
        let channel = appInterface.channelCollection.getByName(event['Channel'])
        channel.newState(event['ChannelState'])
    } catch (e){
        errorLog.error(event)
        errorLog.error(e)
    }
}

/* Channels End */

/* Bridge */
async function addBridge(event) {
    try{
        let destChannel
        if (event['Channel']){
            let uniqueTempID = getUniqueTempID(event)
            let channel = appInterface.channelCollection.getByName(event['Channel'])
            destChannel = appInterface.channelCollection.getByName(event['DestChannel'])

            let bridge = await appInterface.bridgeCollection.add([channel, destChannel], event['DestLinkedid'], uniqueTempID)
            logicLog.info(`Prepared ${bridge}`)
            if (destChannel.trunk && destChannel.number == ''){
                let number = event['DialString'].split('/').pop()
                destChannel.setNumber(number)
            }
            if (channel.extension){
                if (channel.blind_transfer){
                    delete channel.blind_transfer
                    appInterface.newCallState(channel, 3, [channel.extension.flagWS])
                    channel.extension.setStatusWS('20')
                } else if (channel.originate_key){
                    appInterface.newCallState(channel, 3, [channel.extension.flagWS])
                    channel.extension.setStatusWS('20')
                } else {
                    channel.extension.setStatusWS('20')
                    appInterface.newCall(channel, destChannel.number, 'outgoing', destChannel.dataWS, 3, [channel.extension.flagWS], destChannel.get_location_id(), destChannel.get_dialed_number())
                }
            }
            // Принимающий звонок
            if (destChannel.extension){
                let transferData = null
                // Заглушка от зависших каналов
                try {
                    if (channel.extension && channel.extension.channels.collection.length > 1){
                        let otherChannel = channel.extension.channels.getOtherChannel(channel)
                        let mergeChannel = otherChannel.bridge.channels.getOtherChannel(otherChannel)
                        transferData = {'Number': mergeChannel.number, 'Data': mergeChannel.dataWS}
                    }
                } catch(e){
                    transferData = null
                }
                appInterface.newCall(destChannel, channel.number, 'incoming', channel.dataWS, 0, [destChannel.extension.flagWS],  channel.get_location_id(), channel.get_dialed_number(), transferData)
            }
            destChannel.dataWS = appInterface._originateDataDict[channel.unique_id]
            delete appInterface._originateDataDict[channel.unique_id]
        } else {
           /* Originate */
            destChannel = appInterface.channelCollection.getByName(event['DestChannel'])
            destChannel.setOriginateKey(uuidv4())
            if (destChannel.extension){
                let originateData = appInterface._originateDict[event['DestUniqueid']] || {}
                delete appInterface._originateDict[event['DestUniqueid']]
                appInterface.newCall(destChannel, originateData.number, 'outgoing', originateData.data, 2, [destChannel.extension.flagWS], originateData.location, originateData.dialNumber, originateData.transferData)
            }
        }
    } catch (e){errorLog.error(e)}
}

function checkBridge(event) {
    try{
        if (event['Channel']){
            let uniqueTempID = getUniqueTempID(event)
            appInterface.bridgeCollection.checkBridge(event['DialStatus'], event['Channel'], uniqueTempID)
        }
    } catch (e){
        errorLog.error(e)
    }
}

function enterBridge(event) {
    try {
        let channel
        let bridge = appInterface.bridgeCollection.id_dict[event['BridgeUniqueid']]
        if (bridge){
            channel = appInterface.channelCollection.getByName(event['Channel'])
            bridge.enterChannel(channel)
        } else {
            bridge = appInterface.bridgeCollection.linked_id_dict[event['Linkedid']]
            if (!bridge){
                bridge = appInterface.bridgeCollection.destlinked_id_dict[event['Linkedid']]
            }
            bridge.setBridgeID(event['BridgeUniqueid'])
        }
        // FOR API
        channel = appInterface.channelCollection.getByName(event['Channel'])
        if (channel.extension && event['ChannelState'] == '6'){
            appInterface.newCallState(channel, 1, [channel.extension.flagWS])
            channel.extension.setStatusWS('1')
        }
    } catch (e){
        errorLog.error(e)
    }
}

function leaveBridge(event) {
    try{
        let bridge = appInterface.bridgeCollection.id_dict[event['BridgeUniqueid']]
        let channel = appInterface.channelCollection.getByName(event['Channel'])
        bridge.leaveChannel(channel)
    } catch (e) {
        errorLog.error(e)
    }
}

function blindTransfer(event){
    try {
        let channel = appInterface.channelCollection.getByName(event['TransfereeChannel'])
        if (channel.trunk) {
            channel.blind_transfer_trunk = true
        } else {
            appInterface.updateCall(channel, event['Extension'], [channel.extension.flagWS], channel.dataWS)
            appInterface.newCallState(channel, 2, [channel.extension.flagWS])
            channel.blind_transfer = true
        }
        let supportChannel = appInterface.channelCollection.getByName(event['TransfererChannel'])
        let extension = appInterface.extensionCollection.getByExten(event['Extension'])
        let blindTransferSQL = "INSERT INTO transfers (target_channel_id, channel_support_id_1, transferee_extension_id, transfer_type) " +
            "VALUES ($1, $2, $3, $4)"
        backgroundQuery(blindTransferSQL, async()=>[await channel.id, await supportChannel.id, extension.db_id, 'BlindTransfer'])
    } catch (e){
        errorLog.error(e)
    }
}

function attendedTransfer(event) {
    try {
        let startChannel, endChannel, supportChannel, supportChannel2, typeTransfer
        let transfereeChannel = event['TransfereeChannel']
        let transferTargetChannel = event['TransferTargetChannel']
        if (!transfereeChannel) {
            startChannel = appInterface.channelCollection.getByName(transferTargetChannel)
            supportChannel = appInterface.channelCollection.getByName(event['OrigTransfererChannel'])
            supportChannel2 = supportChannel.extension.collection.getOtherChannel(supportChannel)
            let bridge = appInterface.bridgeCollection.initiator_dict[supportChannel.name]
            for (let channel of bridge.start_channel_list){
                if (supportChannel.name != channel.name){
                    endChannel = channel
                    break
                }
            }
            typeTransfer = 'Attended Transfer Forward'
        } else if (!transferTargetChannel){
            startChannel = appInterface.channelCollection.getByName(transfereeChannel)
            supportChannel = appInterface.channelCollection.getByName(event['OrigTransfererChannel'])
            supportChannel2 = supportChannel.extension.channels.getOtherChannel(supportChannel)
            endChannel = supportChannel2.bridge.channels.getOtherChannel(supportChannel2)
            typeTransfer = 'Attended Transfer Back'
        } else {
            startChannel = appInterface.channelCollection.getByName(transfereeChannel)
            supportChannel = appInterface.channelCollection.getByName(event['OrigTransfererChannel'])
            supportChannel2 = supportChannel.extension.channels.getOtherChannel(transferTargetChannel)
            endChannel = appInterface.channelCollection.getByName(transferTargetChannel)
            typeTransfer = 'Attended Transfer'
        }

        // Если канал создан внутри астериска
        if (!startChannel.trunk){
            appInterface.updateCall(startChannel, endChannel.number, [startChannel.extension.flagWS,], endChannel.dataWS)
        }
        // Если канал создан внутри астериска
        if (!endChannel.trunk){
            appInterface.updateCall(endChannel, startChannel.number, [endChannel.extension.flagWS], startChannel.dataWS)
        }
        // Сохранение
        let AttendedTransferSQL = "INSERT INTO transfers (target_channel_id, transferee_channel_id, channel_support_id_1, channel_support_id_2,  transferee_extension_id, transfer_type) " +
            "VALUES ($1, $2, $3, $4, $5, $6)"
        let extension_db_id = endChannel.extension && endChannel.extension.db_id
        backgroundQuery(AttendedTransferSQL, async()=>[await startChannel.id, await endChannel.id, await supportChannel.id, await supportChannel2.id, extension_db_id, typeTransfer])
    } catch (e){
        errorLog.error(e)
        errorLog.error(event)
        try {
            errorLog.error(e)
            errorLog.error(event)
            let startChannel = appInterface.channelCollection.getByName(event['TransfereeChannel'])
            let endChannel = appInterface.channelCollection.getByName(event['TransferTargetChannel'])
            if (!startChannel.trunk){
                appInterface.updateCall(startChannel, endChannel.number, [startChannel.extension.flagWS], endChannel.dataWS)
            }
            if (!endChannel.trunk){
                appInterface.updateCall(endChannel, startChannel.number, [endChannel.extension.flagWS], startChannel.dataWS)
            }
        } catch (e){
            errorLog.error(e)
        }
    }
}

async function lockAgent(event) {
    try {
        let result = parseChannelName(event['Interface'])
        let extension = appInterface.extensionCollection.getByExten(result['number'])
        let channelName = event['DestChannel']
        let channel = appInterface.channelCollection.getByName(channelName)
        extension.setStatusWS('101')
        if (channel){
            extension.setLock('AFK', await channel.id)
        }
    } catch (e){
        errorLog.error(e)
    }
}

function destroyBridge(event) {
    try{
        let bridge = appInterface.bridgeCollection.id_dict[event['BridgeUniqueid']]
        bridge.destroy()
    } catch (e){
        errorLog.error(e)
    }
}
/* End bridge */

/* Queues */
function queueSummary(event) {
    try {
        appInterface.queueCollection.receivedQueue(event['Queue'])
    } catch (e) {
        errorLog.error(e)
    }

}

function queueComplete(event) {
    try {
        appInterface.queueCollection.requestAgentsFromAsterisk()
    } catch (e) {
        errorLog.error(e)
    }
}

async function queueAddAgent(event) {
    try {
        let queue = appInterface.queueCollection.nameDict[event['Queue']]
        if (queue){
            let agentNumber = parseChannelName(event['Name'])['number']
            queue.asteriskAgent[agentNumber] = {'penalty': event['penalty'], 'extension': agentNumber}
            logicLog.info(`Agent ${agentNumber} Queue ${queue.name} received from Asterisk Penalty ${event['Penalty']}`)
        }
    } catch (e) {
        errorLog.error(e)
    }
}

async function queueAgentComplete(event) {
    try {
        await appInterface.queueCollection.loadFromDB()
    } catch (e) {
        errorLog.error(e)
    }
}

async function queueCallerAbandon(event) {
    try {
        let queue = appInterface.queueCollection.nameDict[event['Queue']]
        if (queue && queue.abandonWebhook){
            let postData = {'info': {}}
            let channel = appInterface.channelCollection.getByName(event['Channel'])
            if (channel){
                postData.info.channel = {
                    'number': channel.number,
                    'id': await channel.id
                }
                if (channel.extension){
                    postData.info.extension = {'exten': channel.extension.exten}
                }
                if (channel.trunk){
                    postData.info.channel.trunk = {
                        'name': channel.trunk.name,
                        'id': channel.trunk.trunk_id
                    }
                }
            }

            const options = new URL(queue.abandonWebhook['url'])
            const headers = queue.abandonWebhook['headers'] || {}
            headers['Content-Type'] = 'application/json'
            let connectionParam = {}
            connectionParam.headers = headers
            connectionParam.method = 'POST'
            connectionParam.path = options.pathname
            connectionParam.hostname = options.hostname
            connectionParam.protocol = options.protocol

            await sendRequest(connectionParam, JSON.stringify(postData))
        }
    } catch (e) {
        errorLog.error(e)
    }
}

/* End queues */

/* Restore */
async function loadChannel (event) {
    console.log(event)
    //appInterface.reloadedChannel.push(event['Channel'])
    let channel = appInterface.channelCollection.getByName(event['Channel'])
    if (!channel){
        let channelDBid = await appInterface.channelCollection.get_by_name_in_db(event['Channel'], event['Uniqueid'])
        if (!channelDBid){
            await addChannel(event)
        } else {
            // Если канал открыл в бд
            if (appInterface.channelCollection.channel_in_db_is_open(channelDBid)){
                if (['Down', 'down'].indexOf(event['ChannelStatedesc']) < 0){
                    await addChannel(event, channelDBid)
                }
            }
        }
    }
}


function Event (eventName) {
    return 'event' + eventName
}

ami.on('error', function(err){
    console.log(err)
    throw err;
});

// Channel
appInterface.emitter.once('CollectionLoaded', function () {
    logicLog.info('start AMI event handling')
    ami.on(Event('Newchannel'), addChannel)
    ami.on(Event('Hangup'), closeChannel)
    ami.on(Event('Hold'), holdChannel)
    ami.on(Event('Unhold'), unholdChannel)
    ami.on(Event('Newstate'), newStateChannel)
    ami.on(Event('AgentRingNoAnswer'), lockAgent)

    // Bridge
    ami.on(Event('DialBegin'), addBridge)
    ami.on(Event('DialEnd'), checkBridge)
    ami.on(Event('BridgeEnter'), enterBridge)
    ami.on(Event('BridgeLeave'), leaveBridge)
    ami.on(Event('BridgeDestroy'), destroyBridge)

    // Close zombie channel
    ami.on(Event('HangupRequest'), function () {})
    ami.on(Event('SoftHangupRequest'), function () {})

    // Transfers
    ami.on(Event('BlindTransfer'), blindTransfer)
    ami.on(Event('AttendedTransfer'), attendedTransfer)

    // Queue
    ami.on(Event('QueueCallerAbandon'), queueCallerAbandon)

    // Restore collection
    ami.on(Event('CoreShowChannel'), loadChannel)
    ami.on(Event('CoreShowChannelsComplete'), function (){})
    ami.on(Event('BridgeListItem'), function (){})
    ami.on(Event('BridgeInfoChannel'), function (){})
    ami.on(Event('BridgeListComplete'), function (){})
})

// Queue
ami.on(Event('QueueSummary'), queueSummary)
ami.on(Event('QueueSummaryComplete'), queueComplete)
ami.on(Event('QueueMember'), queueAddAgent)
ami.on(Event('QueueStatusComplete'), queueAgentComplete)

ami.on('ready', async function(){
    try{
        await extensionStateList()
    } catch (e){
        console.log(e)
    }
    ami.action('ExtensionStateList')
});

module.exports = {
    appInterface
}