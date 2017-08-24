"use strict";
const { query, queryOne, backgroundQuery } = require('./db')
const systemLog = require('./logger')(module, 'system.log')
const logicLog = require('./logger')(module, 'logic.log')
const { ChannelCollection } = require('./channels')
const { backgroundTask } = require('./utils')


const EXTENSION_STATUS = {
    '-1': "Номер не найден",
    '0': "Свободен",
    '1': "Разговаривает",
    '2': "Занят",
    '4': "Отключен",
    '8': "Принимает вызов",
    '9': "Разговаривает, принимает вызов по второй линии",
    '16': "На удержании",
    '20': "Звонит",
    '21': "На удержании, звонит по второй линии",
    '100': 'Недоступен',
    '101': 'Заблокирован',
    '102': 'Заблокирован',
    '103': 'Заблокирован',
}

const LOCK_TYPE = {'AFK': '101', '1C_LOCK': '102', 'FILLING_ORDER': '103'}

class ExtensionCollection {
    constructor(){
        this.collection = []
        this.exten_list = {}
    }

    async checkExten(number, status, ami){
        let extension = this.getByExten(number)
        if (extension){
            await extension.setStatus(status)
            extension.ami = ami
        } else {
            await this.add(number, status, ami)
        }
    }

    async add_or_reload(exten, status, ami){
        let extension = this.getByExten(exten)
        if (extension){
            systemLog.info(`Reload ${extension}`)
            extension.default_trunk = extension.get_default_trunk()
            extension.ami = ami
            await extension.setStatus(status)
        } else {
            extension = await this.add(exten, status, ami)
            systemLog.info(`Create ${extension}`)
        }
        return extension
    }

    async add(exten, status, ami){
        let extension = new Extension(exten, status, ami)
        await extension.fill()
        this.collection.push(extension)
        this.exten_list[exten] = extension
        return extension
    }

    getByExten(exten){
        return this.exten_list[exten]
    }

    remove(extension){
        let index = this.collection.indexOf(extension)
        if (index){
            this.collection.splice(index, 1)
            return true
        }
        return false
    }

    clear(){
        this.collection = []
        this.exten_list = new Object(null)
    }

    async extension_lock(opts){
        let extension = this.getByExten(opts['Exten'])
        if (extension){
            await extension.setLock(opts['LookType'])
            return true
        }
        return false
    }

    async extension_unlock(exten){
        let extension = this.getByExten(exten)
        if (extension){
            await extension.setLock('OFF')
            return true
        }
        return true
    }

    default_trunk_reload(){
        for (let extension in this.collection){
            extension.default_trunk = extension.get_default_trunk()
        }
    }

}

class Extension {
    constructor(exten, status, ami){
        this.exten = exten
        this.ami = ami
        this.flagWS = 'Phone' + exten.toString()
        this._DND = false
        this._lock = false
        this._lock_type = null
        this._pause = false
        // Asterisk extension status
        this._status = status
        // Status for 1C
        this._status_ws = status.toString()
        this.channels = new ChannelCollection()
        // to fill
        this.db_id = null
        this.default_trunk = null
    }

    toString(){
        return `- Extension ${this.exten} | Status ${this.status} | Status WS ${this.statusWS} | Default trunk ${this.default_trunk} | DND ${this.DND} | Lock ${this.lock} | Lock Type ${this._lock_type}`
    }

    async fill(){
        this.db_id = await this.get_db_id()
        this.default_trunk = await this.get_default_trunk()
    }

    async get_default_trunk(){
        let result = await queryOne(
            'SELECT t.name ' +
            'FROM trunks as t ' +
            'INNER JOIN extensions as e ON e.default_trunk_id = t.id ' +
            `WHERE e.extension='${this.exten}'`)
        if (result){
            return result.name
        } else {
            systemLog.warn(`Default Trunk NULL for Extension ${this.exten}`)
            return null
        }

    }

    async get_db_id(){
        let result = await queryOne(
            'SELECT e.id ' +
            'FROM extensions AS e ' +
            `WHERE e.extension='${this.exten}'`
         )
        if (result){
            return result.id
        }
        return null
    }

    async checkDND(){
        let result = await this.ami.asyncGetDB('CUSTOM_DND', this.exten)
        await this.setDND(result == 'ON')
        return this.DND
    }

    async checkLock(){
        let result = await this.ami.asyncGetDB('CUSTOM_LOCK', this.exten)
        await this.setLock(result)
        return this.lock
    }

    async canDial(){
        if (this.lock){
            if (this.channels.collection.length < 2){
                logicLog.info(`${this} UNLOCK`)
                await this.setLock('OFF')
                return true
            } else {
                logicLog.info(`${this} BREAK DIAL`)
                return false
            }
        }
        return true
    }

    async update_pause(){
        if (this._pause == (this._DND || this._lock)){
            return
        }
        this._pause = this._DND || this._lock

        this.ami.action('QueuePause', {
            'Interface': `SIP/${this.exten}`,
            'Paused': (this._pause) ? 'True' : 'False',
            'Reason': 'No Answer'
        })
    }

    get pause(){ return this._pause }

    get status(){ return this._status }

    get DND(){ return this._DND }

    get lock() { return this._lock }

    get statusWS(){
        if (this.DND){
            return '100'
        } else if (this.lock){
            return LOCK_TYPE[this._lock_type]
        } else {
            return this._status_ws
        }
    }

    async setStatus(value){
        this._status = value
    }

    async setDND(value){
        if (this._DND == value){
            return
        }

        this._DND = value
        logicLog.info(`Update DND ${this}`)
        await queryOne(
            "INSERT INTO extension_dnd (extension, value) " +
            `VALUES ('${this.exten}', ${value})`
        )
        await this.ami.asyncAction('DBPut', {
            Family: 'CUSTOM_DND',
            Key: this.exten,
            Val: (this._DND) ? 'ON' : 'OFF'
        })
        await this.update_pause()
    }

    setLock(value, channel_id){
        // IN BACKGROUND
        if (this._lock_type == value){
            return
        }
        channel_id = channel_id || null
        this._lock = (LOCK_TYPE[value]) ? true : false
        this._lock_type = value
        logicLog.info(`Update Lock ${this}`)
        let setLockSQL = "INSERT INTO extension_lock (extension, value, type, channel_id) " +
            "VALUES ($1, $2, $3, $4)"
        backgroundQuery(setLockSQL, ()=>[this.exten, value, this._lock_type, channel_id])
        backgroundTask([
            async ()=>{await this.ami.asyncAction('DBPut', {
                        Family: 'CUSTOM_LOCK',
                        Key: this.exten,
                        Val: this._lock_type
                    })},
            async ()=>[await this.update_pause()]
        ])
    }


    setStatusWS(value){
        let statusWS = null
        if (value == '0'){
            if (this.channels.collection.length >= 1){
                statusWS = '1'
            }
        } else if (value == '1') {
            if (this.channels.collection.length > 1){
                statusWS = '2'
            }
        } else if (value == '20'){
            if (this.channels.collection.length > 1){
                statusWS = '21'
            }
        } else if (value == '8') {
            if (this.channels.collection.length > 1){
                statusWS = '9'
            }
        }
        if (!statusWS){
            statusWS = value
        }
        this._status_ws = statusWS
        this.ami.appInterface.newExtensionState(this.exten, Number(this.statusWS), EXTENSION_STATUS[this.statusWS])
    }
}

module.exports = {
    ExtensionCollection,
    EXTENSION_STATUS
}