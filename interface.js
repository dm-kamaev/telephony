"use strict";
const wsc = require('./websockets')
const wsLog = require('./logger')(module, 'ws.log')
const errorLog = require('./logger')(module, 'error.log')
const config = require('config');
const { backgroundTask } = require('./utils')
const { TrunkCollection } = require('./trunk')
const { ExtensionCollection, EXTENSION_STATUS } = require('./extension')
const { ChannelCollection } = require('./channels')
const { QueueCollection } = require('./queues')
const { RuleCollection } = require('./rules')
const { BridgeCollection } = require('./bridges')
const EventEmitter = require('events');
const schedule = require('./schedule')
class InterfaceEmitter extends EventEmitter {}



const CALL_STATE = {
    '0': 'Ожидание вашего ответа',
    '1': 'Разговор',
    '2': 'Набор номера',
    '3': 'Ожидание ответа',
    '4': 'Завершен',
    '5': 'На удержании'
}

class AppInterface {
    constructor(ami){
        // Event emmiter
        this.emitter = new InterfaceEmitter()
        // AMI
        this.ami = ami
        // Collection
        this.trunkCollection = new TrunkCollection()
        this.extensionCollection = new ExtensionCollection()
        this.channelCollection = new ChannelCollection()
        this.bridgeCollection = new BridgeCollection()
        this.queueCollection = new QueueCollection(ami)
        this.ruleCollection = new RuleCollection(ami)

        // Originate Data
        this._originateDict = new Object(null)
        this._originateDataDict = new Object(null)

        // WS data
        this._stackWSMessage = []
        this.wsc = wsc
        wsc.appInterface = this
        this.emitter.once('CollectionLoaded', ()=> {
            wsc.open(config.ws.address);
            schedule(this)
        })

        this._clientFlag = config.ws.clientFlag
        this._serverFlag = config.ws.serverFlag

        // Temp containers for reload
        this.reloadedExtension = []

    }

    router(data){
        try {
            let parseData = JSON.parse(data)
            if (parseData['Type'] == 'Event' && parseData['Name'] == 'NewMessage') {
                let message = JSON.parse(parseData['Data']['Message'])
                switch (message['Name']) {
                    case 'GetExtensions':
                        this.getExtensions(message, parseData['Data'].Sender, message.RequestID)
                        break
                    case 'Originate':
                        this.originate(message, parseData['Data'].Sender, message.RequestID)
                        break
                    case 'SetLock':
                        this.setLock(message, parseData['Data'].Sender, message.RequestID)
                        break
                    case 'ReloadMainSettings':
                        this.reloadMainSettings()
                        break
                    case 'UpdateCall':
                        this.updateCall(message, parseData['Data'].Sender, message.RequestID)
                        break
                    case 'SetData':
                        this.setData(message, parseData['Data'].Sender, message.RequestID)
                        break
                    case 'Monitor':
                        let monitorMessage = {'Type': 'Request', 'Name': 'Monitor', 'Message': this.monitor()}
                        this._sendWS(monitorMessage)
                }
            }
        } catch (e){
            errorLog.error(e)
            errorLog.error(data)
        }
    }

    async _loadLocalCollection (){
        await this.trunkCollection.reload()
        await this.ruleCollection.reloadAll(this.trunkCollection)
    }

    async _loadRemoteCollection (){
        await this.queueCollection.reload()
    }


    _sendWS(data){
        const message = JSON.stringify(data)
        try {
            this.wsc.send(message)
        } catch (e){
            errorLog.info(`WS error and push in stackWS send message ${message}`)
            this._stackWSMessage.push(message)
        }
    }

    checkStackWS(){
        const countMessage = this._stackWSMessage.length
        for (let i = 0; i < countMessage; i++){
            let oldMessage = this._stackWSMessage.shift()
            try{
                this.wsc.send(oldMessage)
                logicLog.info(`WS Send old message ${oldMessage}`)
            } catch (e) {
                this._stackWSMessage.unshift(oldMessage)
                break
            }
        }
    }

    sendMessage(msg, recipients, requestId=null){
        recipients.push(this._clientFlag)
        recipients.push(this._serverFlag)
        let message = {
            "Type": "Request",
            "Name": "SendMessage",
            "Param": {
                "FlagsRecipients": recipients,
                "Type": "Telephony",
                "Message": msg,
            },
            "RequestID": requestId
        }
        this._sendWS(message)
    }

    // API WS methods
    async reloadMainSettings(){
        try {
            await this._loadLocalCollection()
            await this._loadRemoteCollection()
        } catch (e){
            errorLog.info(e)
        }
    }

    getExtensions(message, sender=null, requestId=null){
        let recipients = (sender) ? [sender] : []
        let response = {
            "Type": "Response",
            "Name": "GetExtensions",
            "Data": [],
            "RequestID": message['RequestID']
        }
        for (let extension of this.extensionCollection.collection){
            if (extension.db_id){
                response['Data'].push({
                    'Extension': extension.exten,
                    'State': Number(extension.statusWS),
                    'StateTitle': EXTENSION_STATUS[extension.status.toString()]
                })
            }
        }
        this.sendMessage(JSON.stringify(response), recipients, requestId)
    }

    updateCall(channel, number, recipients, data=null){
        backgroundTask([async ()=> {
            let event = {
                "Type": "Event",
                "Name": "UpdateCall",
                "Data": {
                    "Channel": await channel.id,
                    "Number": number,
                    "Data": data
                }
            }
            this.sendMessage(JSON.stringify(event), recipients)
        }])
    }

    newExtensionState(exten, state, stateTitle){
        let event = {
            "Type": "Event",
            "Name": "NewExtensionState",
            "Data": {
                "Extension": exten,
                "State": state,
                "StateTitle": stateTitle
            }
        }
        this.sendMessage(JSON.stringify(event), [])
    }

    newCallState(channel, state, recipients){
        backgroundTask([async ()=> {
            const event = {
                "Type": "Event",
                "Name": "NewCallState",
                "Data": {
                    "Channel": await channel.id,
                    "State": state,
                    "StateTitle": CALL_STATE[state.toString()]
                }
            }
            this.sendMessage(JSON.stringify(event), recipients)
        }])
    }

    newCall(channel, number, typeCall, data=null, state=0, recipients=[], location=null, dialNumber=null, transferData=null){
        backgroundTask([async ()=> {
            const event = {
                "Type": "Event",
                "Name": "NewCall",
                "Data": {
                    "Channel": await channel.id,
                    "Number": number,
                    "DialedNumber": dialNumber,
                    "Location": location,
                    "State": state,
                    "StateTitle": CALL_STATE[state.toString()],
                    "Data": data,
                    "TransferData": transferData,
                    "Type": typeCall
                }
            }
            this.sendMessage(JSON.stringify(event), recipients)
        }])
    }

    async originate(message, sender, requestId=null){
        const recipients = (sender) ? [sender]: []
        const uniqueId = Math.random().toString()
        const result = await this.ami.asyncAction('Originate', {
            CallerID: message['Param']['Number'],
            Channelid: uniqueId,
            Variable: {'originate-channel': message['Param']['Extension']},
            async: true,
            Channel: 'SIP/'+message['Param']['Extension'],
            Context: 'common',
            Priority: 1,
            Timeout: message['Param']['Timeout'] * 100,
            Exten: message['Param']['Number']
        })
        const response = {
            "Type": "Response",
            "Name": "Originate",
            "Param": result,
            "RequestID": message["RequestID"]
        }
        this.sendMessage(JSON.stringify(response), recipients, requestId)
        this._originateDict[uniqueId] = {'data': message.Param.Data, number: message.Param.Number}
    }

    async setData(message, sender, requestId=null){
        const recipients = (sender) ? [sender]: []
        const channel = this.channelCollection.idDict[message.Param.Channel]
        if (channel){
            if (channel.bridge){
                let clientChannel = channel.bridge.channels.getOtherChannel(channel)
                if (clientChannel){
                    clientChannel.dataWS = message.Param.Data
                } else {
                    wsLog.error(`Client channel is not found - db id channel ${message['Param']['Channel']}`)
                }
            } else {
                this._originateDataDict[channel.unique_id] = message.Param.Data
            }
            const response = {
                "Type": "Response",
                "Name": "SetData",
                "Param": true,
                "RequestID": message["RequestID"]
            }
            this.sendMessage(JSON.stringify(response), recipients, requestId)
        } else {
            wsLog.error(`Channel id ${message['Param']['Channel']} not found`)
        }
    }

    setLock(message, sender=null, requestId=null){
        const recipients = (sender) ? [sender] : []
        let extension = this.extensionCollection.getByExten(message.Param.Extension)
        if (message.Param.Value){
            extension.setStatusWS('102')
            extension.setLock('1C_LOCK', message.Param.Channel)
        } else {
            extension.setLock('Off', message.Param.Channel)
            extension.setStatusWS('0')
        }
        const response = {
            "Type": "Response",
            "Name": "SetLock",
            "Data": true,
            "RequestID": message['RequestID']
        }
        this.sendMessage(JSON.stringify(response), recipients, requestId)
    }

    // DEBUG
    monitor(){
        const resultInfo = new Object(null)
        // General info
        resultInfo['AMI'] = true
        resultInfo['WS'] = true
        resultInfo['AGI'] = null

        resultInfo['Extension_Count'] = this.extensionCollection.collection.length
        resultInfo['Trunk_Count'] = this.trunkCollection.collection.length
        resultInfo['Channel_Count'] = this.channelCollection.collection.length
        resultInfo['Bridge_Count'] = this.bridgeCollection.collection.length

        // Trank map
        resultInfo['Trunks'] = this.trunkCollection.collection.map((trunk)=>trunk.toString())

        // Extension map
        resultInfo['Extensions'] = this.extensionCollection.collection.map((extension)=>{return{'Collection': extension.toString(), 'Channels': extension.channels.toString()}})

        // Bridge map
        resultInfo['Bridges'] = this.bridgeCollection.collection.map((bridge)=>{return{'Collection': bridge.toString(), 'Channels': bridge.channels.toString()}})

        return resultInfo
    }

}


module.exports = {
    AppInterface
}