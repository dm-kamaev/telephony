"use strict";
const aio = require('asterisk.io')
const config = require('config');
const asyncAMI = require('./asyncAMI')
const { query, queryOne, backgroundQuery } = require('./db')
const { TrunkCollection } = require('./trunk')
const { ExtensionCollection } = require('./extension')
const { Channel, ChannelCollection } = require('./channels')
const { QueueCollection } = require('./queues')
const { RuleCollection } = require('./rules')
const { BridgeCollection } = require('./bridges')
const logicLog = require('logger')(module, 'logic.log')
const errorLog = require('logger')(module, 'error.log')
const { getStandardPhone } = require('./utils')


const ami = aio.ami(
    config.ami.host,
    config.ami.port,
    config.ami.login,
    config.ami.password
);

let trunkCollection = new TrunkCollection()
let extensionCollection = new ExtensionCollection()
let channelCollection = new ChannelCollection()
let bridgeCollection = new BridgeCollection()
let queueCollection = new QueueCollection(ami)
let ruleCollection = new RuleCollection(ami)

async function loadCollection() {
    await trunkCollection.reload()
    await ruleCollection.reloadAll(trunkCollection)
}

loadCollection()


let re_number = /^(PJ)?SIP\/((:?[^\/]+)\/)?(:?\w+)/g

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
        return {number: parseData[4], trunk: parseData[3]}
    }

}


asyncAMI(ami)

/* Extension Start */
async function extensionStateList() {
    let values = []

    async function addExtensionStatus(event) {
        values.push(event)
    }

    async function extractValues() {
        // TODO 3
        try{
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
        // TODO 3
        // TODO 2
        let extension = await extensionCollection.add_or_reload(event['Exten'], event['Status'], ami)
        await extension.checkDND()
        await extension.checkLock()
    }

    // Handle change status from AMI
    ami.on(Event('ExtensionStatus'), handlerExtension)
}


async function handlerExtension(event){
    // TODO 1
    await extensionCollection.checkExten(event['Exten'], event['Status'], ami)
    // Для корректного отображения при DND, HOLD
    if (['0', '1', '16'].indexOf(event['Status']) < 0){
        let extension = extensionCollection.getByExten(event['Exten'])
        extension.setStatusWS(event['Status'])
    }
    // Что бы обновлялся статус ws при перезагрузке телефона (мб костыль)
    if (event['Status'] == '0'){
        // TODO 1
        let extension = extensionCollection.getByExten(event['exten'])
        if (extension && extension.statusWS == '4'){
            extension.setStatusWS('0')
        }
    }

}

/* Extension End */

/* Channels Start*/
async function addChannel(event, channel_id) {
    channel_id = channel_id || null
    try{
        let number
        // TODO 3 Voxlink
        let resultDict = parseChannelName(event['Channel'])
        // TODO 2
        let extension = extensionCollection.getByExten(resultDict['number'])
        let trunk = null
        if (['', 's'].indexOf(event['Exten']) < 0){
            trunk = trunkCollection.getByChannelName('SIP/' + event['Exten'])
        }
        if (trunk == null){
            trunk = trunkCollection.getByChannelName('SIP/' + event['Exten'])
        }
        if (trunk){
            number = event['CallerIDNum']
        } else {
            number = resultDict['number']
        }
        let channel = new Channel(event['Channel'], event['Uniqueid'], number, extension, trunk, event['Exten'], channel_id)
        channelCollection.add(channel)
        if (channel_id){
            logicLog.info(`Loaded ${channel}`)
        } else {
            await channel.createInDB()
            let today = new Date()
            let recordPath = `${today.getFullYear()}/${today.getMonth()}/${today.getDate()}/`
            ami.action("MixMonitor", {'Channel': event['Channel'], 'File': `${recordPath}${channel.id}.wav`})
            logicLog.info(`Created ${channel}`)
        }
    } catch (e){
        errorLog.error(e)
    }
}

function closeChannel(event) {
    try {
        let channel = channelCollection.getByName(event['Channel'])
        channel.close({'txt': event['Cause-txt'], 'code': event['Cause']})
        if (channel.extension) {
            //TODO 3
            channel.extension.setStatusWS('0')
        }
    } catch (e){
        errorLog.error(e)
    }
}

function holdChannel(event) {
    // todo 1
    let channel = channelCollection.getByName(event['Channel'])
    channel.setHold(true)
    // TODO 3
}

function unholdChannel(event) {
    // todo 1
    let channel = channelCollection.getByName(event['Channel'])
    channel.setHold(false)
    // TODO 3
}

function newStateChannel(event) {
    let channel = channelCollection.getByName(event['Channel'])
    channel.newState(event['ChannelState'])
}

/* Channels End */

/* Bridge */
async function addBridge(event) {
    try{
        let destChannel
        if (event['Channel']){
            let uniqueTempID = getUniqueTempID(event)
            let channel = channelCollection.getByName(event['Channel'])
            destChannel = channelCollection.getByName(event['DestChannel'])

            let bridge = await bridgeCollection.add([channel, destChannel], event['DestLinkedid'], uniqueTempID)
            logicLog.info(`Prepared ${bridge}`)
            if (destChannel.trunk && destChannel.number == ''){
                let number = event['DialString'].split('/').pop()
                destChannel.setNumber(number)
            }
            if (channel.extension){
                if (channel.blind_transfer){
                    delete channel.blind_transfer
                    // TODO 3
                    channel.extension.setStatusWS('20')
                } else if (channel.originate_key){
                    // TODO 3
                    channel.extension.setStatusWS('20')
                } else {
                    channel.extension.setStatusWS('20')
                    // TODO 3
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
                // TODO 3
            }
            // TODO3
            // destChannel.dataWS =
        } else {
           /* Originate */
            destChannel = channelCollection.getByName(event['DestChannel'])
            // TODO 3 uuid
            destChannel.setOriginateKey('dsfghjk')
            if (destChannel.extension){
                // TODO 3
            }
        }
    } catch (e){errorLog.error(e)}
}

function checkBridge(event) {
    try{
        if (event['Channel']){
            let uniqueTempID = getUniqueTempID(event)
            bridgeCollection.checkBridge(event['DialStatus'], event['Channel'], uniqueTempID)
        }
    } catch (e){
        errorLog.error(e)
    }
}

function enterBridge(event) {
    try {
        // TODO 2
        let channel
        let bridge = bridgeCollection.id_dict[event['BridgeUniqueid']]
        if (bridge){
            channel = channelCollection.getByName(event['Channel'])
            bridge.enterChannel(channel)
        } else {
            bridge = bridgeCollection.linked_id_dict[event['Linkedid']]
            if (!bridge){
                bridge = bridgeCollection.destlinked_id_dict[event['Linkedid']]
            }
            bridge.setBridgeID(event['BridgeUniqueid'])
        }
        // FOR API
        channel = channelCollection.getByName(event['Channel'])
        if (channel.extension && event['ChannelState'] == '6'){
            // TODO 3
            channel.extension.setStatusWS('1')
        }
    } catch (e){
        errorLog.error(e)
    }
}

function leaveBridge(event) {
    try{
        let bridge = bridgeCollection.id_dict[event['BridgeUniqueid']]
        let channel = channelCollection.getByName(event['Channel'])
        bridge.leaveChannel(channel)
    } catch (e) {
        errorLog.error(e)
    }
}

function blindTransfer(event){
    try {
        let channel = channelCollection.getByName(event['TransfereeChannel'])
        if (channel.trunk) {
            channel.blind_transfer_trunk = true
        } else {
            // TODO 3
            channel.blind_transfer = true
        }
        let supportChannel = channelCollection.getByName(event['TransfererChannel'])
        let extension = extensionCollection.getByExten(event['Extension'])
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
            startChannel = channelCollection.getByName(transferTargetChannel)
            supportChannel = channelCollection.getByName(event['OrigTransfererChannel'])
            supportChannel2 = supportChannel.extension.collection.getOtherChannel(supportChannel)
            let bridge = bridgeCollection.initiator_dict[supportChannel.name]
            for (let channel of bridge.start_channel_list){
                if (supportChannel.name != channel.name){
                    endChannel = channel
                    break
                }
            }
            typeTransfer = 'Attended Transfer Forward'
        } else if (!transferTargetChannel){
            startChannel = channelCollection.getByName(transfereeChannel)
            supportChannel = channelCollection.getByName(event['OrigTransfererChannel'])
            supportChannel2 = supportChannel.extension.channels.getOtherChannel(supportChannel)
            endChannel = supportChannel2.bridge.channels.getOtherChannel(supportChannel2)
            typeTransfer = 'Attended Transfer Back'
        } else {
            startChannel = channelCollection.getByName(transfereeChannel)
            supportChannel = channelCollection.getByName(event['OrigTransfererChannel'])
            supportChannel2 = supportChannel.extension.channels.getOtherChannel(transferTargetChannel)
            endChannel = channelCollection.getByName(transferTargetChannel)
            typeTransfer = 'Attended Transfer'
        }

        // Если канал создан внутри астериска
        if (!startChannel.trunk){
            // TODO 3
        }
        // Если канал создан внутри астериска
        if (!endChannel.trunk){
            // TODO 3
        }
        // Сохранение
        let AttendedTransferSQL = "INSERT INTO transfers (target_channel_id, transferee_channel_id, channel_support_id_1, channel_support_id_2,  transferee_extension_id, transfer_type) " +
            "VALUES ($1, $2, $3, $4, $5, $6)"
        let extension_db_id = endChannel.extension && endChannel.extension.db_id
        backgroundQuery(AttendedTransferSQL, async()=>[await startChannel.id, await endChannel.id, await supportChannel.id, await supportChannel2.id, extension_db_id, typeTransfer])
    } catch (e){
        errorLog.error(e)
        errorLog.error(event)
        let startChannel = channelCollection.getByName(event['TransfereeChannel'])
        let endChannel = channelCollection.getByName(event['TransferTargetChannel'])
        if (!startChannel.trunk){
            // TODO 3
        }
        if (!endChannel.trunk){
            // TODO 3
        }

    }
}

async function lockAgent(event) {
    try {
        let result = parseChannelName(event['Interface'])
        let extension = extensionCollection.getByExten(result['number'])
        let channelName = event['DestChannel']
        // TODO 1
        let channel = channelCollection.getByName(channelName)
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
        // TODO 1
        let bridge = bridgeCollection.id_dict[event['BridgeUniqueid']]
        bridge.destroy()
    } catch (e){
        errorLog.error(e)
    }
}
/* End bridge */

/* Queues */
function queueSummary(event) {
    try {
        queueCollection.receivedQueue(event['Queue'])
    } catch (e) {
        errorLog.error(e)
    }

}

function queueComplete(event) {
    try {
        queueCollection.requestAgentsFromAsterisk()
    } catch (e) {
        errorLog.error(e)
    }
}

async function queueAddAgent(event) {
    try {
        let queue = queueCollection.nameDict[event['Queue']]
        if (queue){
            let agentNumber = parseChannelName(event['Name'])['number']
            let agent = queue.agentDict[agentNumber]
            if (agent){
                if (agent.penalty != event['penalty']){
                    agent.penalty = event['Penalty']
                    logicLog.info(`Asterisk update penalty ${event['Penalty']} - Agent ${agent.number} Queue ${queue.name}`)
                }
            } else {
                await queue._addAgent(agentNumber, event['Penalty'])
                logicLog.info(`Agent ${agentNumber} Queue ${queue.name} received from Asterisk Penalty ${event['Penalty']}`)
            }
        }
    } catch (e) {
        errorLog.error(e)
    }
}

async function queueAgentComplete(event) {
    try {
        await queueCollection.loadFromDB()
    } catch (e) {
        errorLog.error(e)
    }
}

async function queueCallerAbandon(event) {
    try {
        let queue = queueCollection.nameDict[event['Queue']]
        if (queue && queue.abandonWebhook){
            let postData = {'info': {}}
            let channel = channelCollection.getByName(event['Channel'])
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
            let url = queue.abandonWebhook['url']
            let headers = queue.abandonWebhook['headers'] || {}
            // TODO 3
            // sendPost(url, postData, headers
        }
    } catch (e) {
        errorLog.error(e)
    }
}

/* End queues */


function Event (eventName) {
    return 'event' + eventName
}

ami.on('error', function(err){
    console.log(err)
    throw err;
});

// Channel
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
ami.on(Event('QueueSummary'), queueSummary)
ami.on(Event('QueueSummaryComplete'), queueComplete)
ami.on(Event('QueueMember'), queueAddAgent)
ami.on(Event('QueueStatusComplete'), queueAgentComplete)
ami.on(Event('QueueCallerAbandon'), queueCallerAbandon)

// Restore collection
ami.on(Event('CoreShowChannel'), function (){})
ami.on(Event('CoreShowChannelsComplete'), function (){})
ami.on(Event('BridgeListItem'), function (){})
ami.on(Event('BridgeInfoChannel'), function (){})
ami.on(Event('BridgeListComplete'), function (){})


ami.on('ready', async function(){
    try{
        await extensionStateList()
        await queueCollection.reload()
    } catch (e){
        console.log(e)
    }
    ami.action('ExtensionStateList')
});

module.exports = {
    channelCollection,
    trunkCollection,
    ruleCollection,
    extensionCollection,
}