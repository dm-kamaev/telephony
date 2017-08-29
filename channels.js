"use strict";
const logicLog = require('./logger')(module, 'logic.log')
const { getStandardPhone, backgroundTask, sendRequest } = require('./utils')
const { query, queryOne, backgroundQuery } = require('./db')
const config = require('config');

const EventEmitter = require('events');
class ChannelsEmitter extends EventEmitter {}



class ChannelCollection{
    constructor(){
        this.collection = []
        this.name_list = new Object(null)
        this.originate_key_list = {}
        this.idDict = new Object(null)
    }

    toString(){
        if (this.collection.length == 0){
            return ' Channel Collection None'
        }
        let collectionText = this.collection.reduce((string, channel)=>{return string + `\n       ${channel.toString()}`})
        return ` Channel Collection: \n      ${collectionText }`
    }

    async add(channel){
        if (this.collection.indexOf(channel) !== -1){
            return false
        }

        channel.collections.push(this)
        this.name_list[channel.name] = channel

        if (channel.originate_key){
            this.originate_key_list[channel.originate_key] = channel
        }
        this.collection.push(channel)

        if (channel._id){
            this.idDict[channel._id] = channel
        }
        return true
    }

    async clear(reason){
        let tempArray = this.collection.slice(0)
        for (let channel of tempArray){
            await channel.close(reason)
        }
    }

    async remove(channel){
        if (this.collection.indexOf(channel) > -1){
            this.collection.splice(this.collection.indexOf(channel), 1)
            delete this.name_list[channel.name]
            if (channel.originate_key){
                delete this.originate_key_list[channel.originate_key]
            }
            if (await channel.id){
                delete this.idDict[channel.id]
            }
            return true
        }
        return false
    }

    remove_collection(channel){
        this.collection.splice(this.collection.indexOf(channel), 1)
        channel.collections.splice(channel.collections.indexOf(this), 1)
        return true
    }

    async channel_in_db_is_open(channel_id){
        let channel_row = await queryOne(
            "SELECT id " +
            "FROM channels " +
            `WHERE id=${channel_id} AND "end" IS NULL`
        )
        return Boolean(channel_row)
    }

    getByName(name){
        return this.name_list[name]
    }

    async get_by_name_in_db(name, unique_id){
        let channel_row = await queryOne(
            'SELECT id ' +
            'FROM channels ' +
            `WHERE channel_name=${name} AND unique_id = ${unique_id}`)
        if (channel_row){
            return channel_row.id
        } else {
            return null
        }
    }

    get_by_originate_key(originate_key){
        return this.originate_key_list[originate_key]
    }

    getOtherChannel(channel){
        for (let chn of this.collection){
            if (chn != channel){
                return chn
            }
        }
        return false
    }
}

class Channel{
    constructor(name, unique_id, number, extension, trunk, exten, channel_id){
        this._emitter = new ChannelsEmitter()
        this.name = name
        this.unique_id = unique_id
        this.number = getStandardPhone(number)
        this._originate_key = null
        this._incoming = null
        this._id = channel_id || null
        this.extension = extension
        this.collections = []
        this.trunk = trunk
        // incoming - входящий в мост (вторым), т.е. не является инициатором звонка
        this.setIncoming(exten)
        this._hold = false
        this._hold_db_id = null
        this._not_write_first_connect = Boolean(channel_id)
        this.dataWS = null
        this._bridge = null

        if (this.extension){
            this.extension.channels.add(this)
        }

        if (this.trunk){
            this.call_number = this.trunk.number
        } else {
            this.call_number = getStandardPhone(exten)
        }

        if (this.trunk){
            if (this.trunk.tracking && !this.incoming){
                if (['74959843131', '79255343606', '79161387884'].indexOf(this.number) < 0 ){
                    let connectParam = {
                        hostname: config.site.host,
                        protocol: config.site.schema + ':',
                        rejectUnauthorized: (config.app.debug) ? false : true,
                        path: "/service/calltracking",
                        method: 'POST',
                        headers: {
                            "X-Dom-Service": "AstDom",
                            'Content-Type': 'application/json'
                        }
                    }
                    backgroundTask([
                        async ()=> sendRequest(connectParam, JSON.stringify({
                                "phone": this.call_number,
                                "channel": await this.id
                        }))
                    ])
                }
            }
        }
    }

    toString (){
        return `- Channel ${this.name} | Incoming ${this.incoming} | Trunk ${this.trunk} | Called Number ${this.call_number} | Data WS ${JSON.stringify(this.dataWS)} | DB ID ${this._id}`
    }

    async close(reason){
        this._close_in_db(reason)
        for (let collection of this.collections){
            await collection.remove(this)
        }
        logicLog.info(`Close ${this}`)
    }


    newState(state_code){
        if (state_code == '5'){
            this._begin_ringing_db()
            logicLog.info(`Set Ringing Time ${this}`)
        }
        if (state_code == '6'){
            this._begin_talk_db()
            logicLog.info(`Set Talking Time ${this}`)
        }
    }

    setNumber(number){
        this.number = getStandardPhone(number)
        this.updateInDB()
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

    get hold(){
        return this._hold
    }

    get originate_key(){
        return this._originate_key
    }

    get incoming(){
        return this._incoming
    }

    get bridge(){
        return this._bridge
    }

    setHold(value){
        // IN BACKGROUND
        this._hold = value
        let currentDate = new Date()
        if (value == true){
            backgroundTask([
                async ()=> {
                    let setHoldSQL = "INSERT INTO channel_holds (channel_id, begin) " +
                        'VALUES ($1, $2)' +
                        'RETURNING id'
                    let result = await queryOne(setHoldSQL, [await this.id, currentDate])
                    this._hold_db_id = result.id
                }
            ])
            logicLog.info(`Hold ${this}`)
        } else if (value == false) {
            if (this._hold_db_id) {
                backgroundTask([
                    async()=> {
                        let setHoldSQL = 'UPDATE channel_holds SET "end" = $1 ' +
                            "WHERE id = $2"
                        await query(setHoldSQL, [currentDate, this._hold_db_id])
                    }
                ])
            } else {
                backgroundTask([
                    async()=> {
                        let setHoldSQL = 'UPDATE channel_holds SET "end" = $1 ' +
                        'WHERE id IN (SELECT id FROM channel_holds WHERE ' +
                            'channel_id=$2 AND "end" is NULL ORDER BY "begin" DESC LIMIT 1)'
                        await query(setHoldSQL, [currentDate, await this.id])
                    }
                ])
                logicLog.error(`Unhold _hold_db_id does not exist, ${this}`)
            }
            logicLog.info(`Unhold ${this}`)
            this._hold_db_id = null
        }
    }

    async setOriginateKey(value){
        // IN BACKGROUND
        this._originate_key = value
        for (let collection of this.collections){
            collection.originate_key_list[value] = this
        }
        let setOriginateSQL = 'UPDATE channels SET originate_key = $1 ' +
                            'WHERE id = $2'
        backgroundQuery(setOriginateSQL, async ()=> [value, await this.id])


    }

    setIncoming(value){
        if (['', 's'].indexOf(value)){
            this._incoming = true
        } else {
            this._incoming = false
        }
    }

    setBridge(item){
        // IN BACKGROUND
        let currentDate = new Date()
        if (item){
            if (this._not_write_first_connect){
                this._not_write_first_connect = false
                this._bridge = item
            } else {
                backgroundQuery(
                    "INSERT INTO bridges_channels (begin, bridge_id, channel_id) " +
                    `VALUES ($1, $2, $3)`
                , async ()=>[currentDate, await item.id, await this.id])
                this._bridge = item
            }
        } else  {
            let querySQL = "UPDATE bridges_channels " +
                'SET "end"=$1 ' +
                "WHERE channel_id = $2 AND bridge_id = $3"
            let forBackgroundBridge = this._bridge
            backgroundQuery(querySQL, async ()=>[currentDate, await this.id, await forBackgroundBridge.id])
            this._bridge = null
        }
    }

    _begin_ringing_db(){
        // IN BACKGROUND
        let currentDate = new Date()
        let setBeginRingingSQL = "UPDATE channels SET begin_ringing = $1 " +
            "WHERE id=$2"
        backgroundQuery(setBeginRingingSQL, async ()=> [currentDate, await this.id])
    }

    get_location_id(){
        if (this.trunk){
            return this.trunk.location_id
        }
        return null
    }

    get_dialed_number(){
        if (this.trunk){
            return this.call_number
        }
        return null
    }

    _begin_talk_db(){
        // IN BACKGROUND
        let currentDate = new Date()
        let setBeginRingingSQL = "UPDATE channels SET begin_talk = $1 " +
            "WHERE id=$2"
        backgroundQuery(setBeginRingingSQL, async ()=> [currentDate, await this.id])
    }

    _close_in_db(reason){
        let currentDate = new Date()
        backgroundQuery(
            'UPDATE channels SET "end"=$1, reason_h = $2, reason_h_code = $3 ' +
            "WHERE id=$4"
        ,async ()=>[currentDate, reason.txt, reason.code, await this.id])
    }

    async createInDB(){
        let trunk_id = null
        if (this.trunk && this.trunk.trunk_id){
            trunk_id = this.trunk.trunk_id
        }
        let createChannel = "INSERT INTO channels (channel_name, unique_id, originate_key, number, incoming, trunk_id, begin) " +
                    "VALUES ($1, $2, $3, $4, $5, $6, NOW())" +
                    "RETURNING id"
        let value = [this.name, this.unique_id, this.originate_key, this.number, this._incoming, trunk_id]
        let result = await queryOne(createChannel, value)
        this._id = result.id
        for (let collection of this.collections){
            collection.idDict[this._id] = this
        }
        this._emitter.emit('createdInDB')
    }

    updateInDB(){
        if (this._not_write_first_connect == false){
            let loadChannel = "UPDATE channels SET channel_name = $1, unique_id=$2, number=$3, incoming=$4 "+
                    "WHERE id=$5 "
            backgroundQuery(loadChannel, async ()=>[this.name, this.unique_id, this.number, this.incoming, await this.id])
        }
    }
}

module.exports = {
    Channel,
    ChannelCollection
}