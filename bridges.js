"use strict";
const logicLog = require('./logger')(module, 'logic.log')
const { query, queryOne, backgroundQuery } = require('./db')
const { ChannelCollection } = require('./channels')

const EventEmitter = require('events');
class BridgesEmitter extends EventEmitter {}

const CREATE_STATUS = ['ANSWER', 'CONTINUE']
const DESTROY_STATUS = ['ABORT', 'BUSY', 'CANCEL', 'CHANUNAVAIL', 'CONGESTION', 'GOTO', 'NOANSWER']


class BridgeCollection {
    constructor() {
        this.collection = []
        this.initiator_dict = new Object(null)
        this.id_dict = new Object(null)
        this.linked_id_dict = new Object(null)
        this.destlinked_id_dict = new Object(null)
        this.unique_temp_id_dict = new Object(null)
    }

    async add(channel_list, destinitiator_unique_id, unique_temp_id, id){
        destinitiator_unique_id = destinitiator_unique_id || null
        unique_temp_id = unique_temp_id || null
        const bridge = new Bridge(channel_list, id, destinitiator_unique_id, unique_temp_id)
        this.collection.push(bridge)
        this.initiator_dict[bridge.initiator] = bridge
        this.linked_id_dict[bridge.initiator_unique_id] = bridge
        // Для корявых трансферов
        if (bridge.destinitiator_unique_id){
            this.destlinked_id_dict[bridge.destinitiator_unique_id] = bridge
        }
        if (bridge.unique_temp_id){
            this.unique_temp_id_dict[bridge.unique_temp_id] = bridge
        }
        bridge.collection = this
        await bridge.fill(channel_list)
        return bridge
    }

    async getBridgeByUniqueIDinDB(uniqueID){
        const querySQL = (
            "SELECT id " +
            "FROM bridges " +
            "WHERE bridgeuniqueid = $1 LIMIT 1"
        )
        let result = await queryOne(querySQL, [uniqueID])
        if (result){
            return result.id
        }
        return null
    }

    checkBridge(status, initiator, unique_temp_id){
        let bridge = this.unique_temp_id_dict[unique_temp_id]
        if (!bridge){
            bridge = this.initiator_dict[initiator]
        }
        if (CREATE_STATUS.indexOf(status) !== -1) {
            bridge.created = true
            logicLog.info(`Create Bridge Initiator ${bridge.initiator}`)
        } else if (DESTROY_STATUS.indexOf(status) !== -1){
            if (bridge){
                bridge.destroy()
            }
        } else {
            logicLog.error('неизвестный dialstatus в DialEnd')
        }
    }
}

class Bridge{
    constructor(channel_list, id, destinitiator_unique_id, unique_temp_id){
        destinitiator_unique_id = destinitiator_unique_id || null
        unique_temp_id = unique_temp_id || null
        this._emitter = new BridgesEmitter()
        this._id = id || null
        this.channels = new ChannelCollection()
        this._bridge_id = null
        this.initiator = channel_list[0].name
        this.initiator_unique_id = channel_list[0].unique_id
        this.destinitiator_unique_id = destinitiator_unique_id
        this.unique_temp_id = unique_temp_id
        this.start_channel_list = channel_list
        this.created = (this._id) ? true : false
    }

    async fill(channel_list){
        if (!this._id){
            this.created = false
            this._id = await this._save_in_db()
            this._emitter.emit('createdInDB')
        }
        for (let channel of channel_list){
            if (this.channels.collection.indexOf(channel) === -1){
                await channel.id
                this.channels.add(channel)
                channel.setBridge(this)
            }
        }

    }

    toString(){
        return `- Bridge_id ${this.bridge_id} | Initiator ${this.initiator} | Initiator UnqID ${this.initiator_unique_id} | Created ${this.created} `
    }

    enterChannel(channel){
        if (this.channels.collection.indexOf(channel) === -1){
            this.channels.add(channel)
            channel.setBridge(this)
            logicLog.info(`Enter Channel ${channel.name} ${this}`)
        }
    }

    leaveChannel(channel){
        this.channels.remove_collection(channel)
        channel.setBridge(null)
        logicLog.info(`Leave Channel ${channel.name} ${this}`)
    }

    async _save_in_db(){
        let result = await queryOne(
            "INSERT INTO bridges (begin, bridgeuniqueid)" +
            "VALUES (NOW(), NULL) " +
            "RETURNING id"
        )
        return result.id
    }

    destroy(){
        // IN BACKGROUND
        this.collection.collection.splice(this.collection.collection.indexOf(this), 1)
        delete this.collection.id_dict[this._bridge_id]
        delete this.collection.initiator_dict[this.initiator]
        delete this.collection.linked_id_dict[this.initiator_unique_id]
        delete this.collection.destlinked_id_dict[this.destinitiator_unique_id]
        delete this.collection.unique_temp_id_dict[this.unique_temp_id]
        logicLog.info(`Destroy Bridge ${this}`)
        const row = (
            "UPDATE bridges " +
            'SET "end"=$1 ' +
            "WHERE id=$2"
        )
        let currentDate = new Date()
        backgroundQuery(row, async ()=>[currentDate,await this.id])
        if (!this.created){
            let row = (
                "UPDATE bridges_channels " +
                'SET "end"=$1 ' +
                "WHERE bridge_id=$2"
            )
            backgroundQuery(row, async ()=>[currentDate, await this.id])
        }
    }

    get id(){
        if (this._id !== null){
            return this._id
        } else {
            return new Promise((resolve, reject)=> {
                this._emitter.on('createdInDB', ()=>{resolve(this._id)})
            })
        }
    }

    get bridge_id(){
        return this._bridge_id
    }

    setBridgeID(bridge_id){
        // IN BACKGROUND
        this.collection.id_dict[bridge_id] = this
        this._bridge_id = bridge_id
        const querySQL = (
            "UPDATE bridges " +
            "SET bridgeuniqueid = $1 " +
            "WHERE id=$2"
        )
        backgroundQuery(querySQL, async ()=>[this._bridge_id, await this.id])
    }
}

module.exports = {
    BridgeCollection,
}