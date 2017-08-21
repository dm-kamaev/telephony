"use strict";
const logicLog = require('logger')(module, 'logic.log')
const {ruleCollection, extensionCollection} = require('./ami')

const TIMEOUT = 300

const completionActionDict = {
    // CUSTOM status
    'NO_RULE': [async (agiSession)=> await agiSession.agi.asyncCommand('EXEC Playback "/var/lib/asterisk/moh/messages/CHANUNAVAIL"')],
    'PAUSE': null,
    'DND': [async (agiSession)=> await agiSession.agi.asyncCommand('EXEC Playback "/var/lib/asterisk/moh/messages/DND"')],
    'PLAYBACK_SUCCESS': null,
    'PLAYBACK_FAILURE': [(agiSession) => logicLog.error(`${agiSession} STATUS PLAYBACK_FAILURE}`)],
    'AFK': [async (agiSession)=> await agiSession.agi.asyncCommand('EXEC Playback "/var/lib/asterisk/moh/messages/DND"')],
    'BUSY_CHAN_1': [async (agiSession)=> await agiSession.agi.asyncCommand('EXEC Playback "/var/lib/asterisk/moh/messages/BUSY"')],
    'BUSY_CHAN_2': [async (agiSession)=> await agiSession.agi.asyncCommand('EXEC Playback "/var/lib/asterisk/moh/messages/BUSY"')],
    // Dial status Asterisk
    // TODO CHECK CHANUNAVAIL ?
    'CHANUNAVAIL': [async (agiSession)=> await agiSession.agi.asyncCommand('EXEC Playback "/var/lib/asterisk/moh/messages/CHANUNAVAIL"')],
    'CONGESTION': [(agiSession) => logicLog.error(`${agiSession} STATUS CONGESTION}`)],
    'NOANSWER': [async (agiSession)=> await agiSession.agi.asyncCommand('EXEC Playback "/var/lib/asterisk/moh/messages/NOANSWER"')],
    'BUSY': [async (agiSession)=> await agiSession.agi.asyncCommand('EXEC Playback "/var/lib/asterisk/moh/messages/BUSY"')],
    'ANSWER': null,
    'CANCEL': [(agiSession) => logicLog.error(`${agiSession} STATUS CANCEL}`)],
    'DONTCALL': [(agiSession) => logicLog.error(`${agiSession} STATUS DONTCALL}`)],
    'TORTURE': [(agiSession) => logicLog.error(`${agiSession} STATUS TORTURE}`)],
    'INVALIDARGS': [(agiSession) => logicLog.error(`${agiSession} STATUS INVALIDARGS}`)],
    // Queue Status Asterisk
    'TIMEOUT': [async (agiSession)=> await agiSession.agi.asyncCommand('EXEC Playback "/var/lib/asterisk/moh/messages/TIMEOUT"'),
        (agiSession) => logicLog.error(`${agiSession} STATUS TIMEOUT}`)],
    'FULL': [(agiSession) => logicLog.error(`${agiSession} STATUS FULL}`)],
    'JOINEMPTY': [async (agiSession)=> await agiSession.agi.asyncCommand('EXEC Playback "/var/lib/asterisk/moh/messages/TIMEOUT"'),
        (agiSession) => logicLog.error(`${agiSession} STATUS JOINEMPTY}`)],
    'LEAVEEMPTY': [async (agiSession)=> await agiSession.agi.asyncCommand('EXEC Playback "/var/lib/asterisk/moh/messages/TIMEOUT"'),
        (agiSession) => logicLog.error(`${agiSession} STATUS LEAVEEMPTY}`)],
    'JOINUNAVAIL': [async (agiSession)=> await agiSession.agi.asyncCommand('EXEC Playback "/var/lib/asterisk/moh/messages/TIMEOUT"'),
        (agiSession) => logicLog.error(`${agiSession} STATUS JOINUNAVAIL}`)],
    'LEAVEUNAVAIL': [async (agiSession)=> await agiSession.agi.asyncCommand('EXEC Playback "/var/lib/asterisk/moh/messages/TIMEOUT"'),
        (agiSession) => logicLog.error(`${agiSession} STATUS LEAVEUNAVAIL}`)],
    'CONTINUE': null,
    'UNKNOWN': [async (agiSession)=> await agiSession.agi.asyncCommand('EXEC Playback "/var/lib/asterisk/moh/messages/TIMEOUT"'),
        (agiSession) => logicLog.error(`${agiSession} STATUS UNKNOWN}`)],
}


class AgiSession {
    constructor(agi, channel){
        this.agi = agi
        this.channel = channel
        this.processedRules = []
        if (channel.trunk){
            if (agi.agi_extension.length == 3 && channel.blind_transfer_trunk){
                this.exten = agi.agi_extension
            } else {
                this.exten = ''
            }
        } else {
            this.exten = agi.agi_extension
        }
    }

    extenEmpty(){
        if (['', 's'].indexOf(this.exten) > -1){
            return true
        } else {
            return false
        }
    }

    async completion(status){
        /*
            Возможные результаты
            AstDom Status:
                NO_RULE - Нет правила
                PAUSE - Агента находится на паузе
                DND - Агент находится на днд
                BUSY_CHAN_1 - Агент занят, разговаривает по 1 линии (Для привилигерованных звонков)
                BUSY_CHAN_2 - Агент занят, разговаривает по 1 линии (Для НЕ привилигерованных звонков)
                PLAYBACK_SUCCESS - Успешно проигралась запись - rule command 'playback'.
                PLAYBACK_FAILURE - Не успешно проигралась запись - rule command 'playback'.
            Asterisk Dial Status:
                CHANUNAVAIL - канал недоступен
                CONGESTION - Канал возвратил сигнал перегрузки, обычно свидетельствующий о невозможности завершить соединение.
                NOANSWER - Канал не ответил в течение времени, заданного опцией времяожидания-ответа
                BUSY - занят
                ANSWER - ответили
                CANCEL - отменен
                DONTCALL -  (не вызывать) Вызов был переведен в состояние DONTCALL опциями экранирования или конфиденциальности.
                TORTURE - (отключение) Вызов был переведен в состояние TORTURE опциями экранирования или конфиденциальности.
                INVALIDARGS -  (недействительные аргументы) В приложение Dial() были переданы недействительные аргументы.
            Asterisk Queue Status:
                TIMEOUT - Вызов находился в очереди слишком долго, и время ожидания истекло.
                FULL - Очередь была уже заполнена.
                JOINEMPTY - Вызывающий абонент не мог быть поставлен в очередь, поскольку не было участников, которые могли бы ответить на звонок.
                LEAVEEMPTY - Вызывающий абонент был поставлен в очередь, но затем все участники обработки очереди покинули ее.
                JOINUNAVAIL - Вызывающий абонент был поставлен в очередь, но затем все участники обработки очереди стали недоступными
                LEAVEUNAVAIL -
                CONTINUE
        */
        status = status.toUpperCase()
        let actions = completionActionDict[status]
        if (actions){
            for (let action of actions){
                await action(this)
            }
        }
        await this.agi.asyncCommand('HangUp')
    }

    async getData(){
        const maxDigits = 3
        const timeout = 2000
        let result = await this.agi.asyncCommand(`GET DATA "/var/lib/asterisk/moh/gudok" ${timeout} ${maxDigits}`)
        if (result.length == 3){
            this.exten = result[1]
        }
    }

    async playback(params){
        let { file } = params
        let status = await this.agi.asyncCommand(`EXEC Playback "${file}"`)
        if (status['1'] == 0){
            return 'PLAYBACK_SUCCESS'
        }
        return 'PLAYBACK_FAILURE'
    }

    async queue(params){
        let {name, timeout = TIMEOUT} = params
        await this.agi.asyncCommand(`EXEC Queue ${name},c,,,${timeout}`)
        let status = await this.agi.asyncCommand('GET VARIABLE QUEUESTATUS')
        return status['2']
    }

    async dial(params){
        let { number = null, timeout = TIMEOUT } = params
        let asterTrunkStr = params.trunk || null
        logicLog.info(`${this} DIAL  trunk ${asterTrunkStr }, Number ${number}, Timeout ${timeout}`)
        if (number.length == 3){
            if (!asterTrunkStr){
                asterTrunkStr = "SIP"
            }
            let extension = extensionCollection.getByExten(number)
            if (!extension){
                logicLog.info(`${this} DIAL - extension ${number} NOT FOUND - RETURN CHANUNAVAIL`)
                return 'CHANUNAVAIL'
            }
            if (extension.DND){
                logicLog.info(`${this} DIAL - RETURN DND`)
                return 'DND'
            }
            if (extension.channels.collection.length == 0){
                logicLog.info(`${this} DIAL - RUN CALL`)
                return await this.call({asterTrunkStr, number, timeout})
            }
            if (extension.channels.collection.length == 1){
                logicLog.info(`${this} DIAL - RUN CALL second line`)
                // TODO without answer test
                return await this.call({asterTrunkStr, number, timeout, music_class:'second-call'})
            }
            logicLog.info(`${this} DIAL - RETURN BUSY_CHAN_2`)
            return 'BUSY_CHAN_2'
        }
        // TODO SECURE
        if (number.length == 11){
            if (asterTrunkStr == null){
                asterTrunkStr = this.channel.extension.default_trunk
            }
            logicLog.info(`${this} DIAL - RUN CALL`)
            return await this.call({asterTrunkStr, number, timeout})

        }
        // TODO SECURE
        if (asterTrunkStr == null){
            asterTrunkStr = 'SIP'
        }
        logicLog.info(`${this} DIAL - RUN CALL`)
        return await this.call({asterTrunkStr, number, timeout})
    }

    async call(params){
        let {asterTrunkStr, number, timeout=TIMEOUT, music_class=null} = params
        let opts = ''
        if (music_class){
            opts += `m(${music_class})`
        }

        if (opts != ''){
            opts = "," + opts
        }

        logicLog.info(`${this} Dial ${asterTrunkStr}/${number}, ${timeout}, ${opts}`)
        await this.agi.asyncCommand(`EXEC Dial ${asterTrunkStr}/${number}, ${timeout}${opts}`)
        let result = await this.agi.asyncCommand('GET VARIABLE DIALSTATUS')
        return result['2']
    }

    async switchIn(){
        if (this.extenEmpty()){
            if (this.channel.trunk.trySwitchIn){
                logicLog.info(`${this} SWITCH - GET RULE IN VALUE ${this.channel.number}`)
                let rule = ruleCollection.getRuleFromSwitch('in', this.channel.number)
                if (rule !== ruleCollection.EMPTY_RULE){
                    return await rule.run(this)
                }
            }
            return await this.channel.trunk.defaultRule.run(this)
        }
        return await this.dial({number: this.exten})

    }

    async switchOut(){
        if (!await this.channel.extension.canDial()){
            return this.channel.extension._lock_type
        }
        let rule = ruleCollection.getRuleFromSwitch('out', this.exten)
        if (rule === ruleCollection.EMPTY_RULE && (this.exten.length == 3 || this.exten.length == 11)){
            logicLog.info(`${this} SWITCH OUT - RULE EMPTY - DIAL ${this.exten}`)
            return await this.dial({number: this.exten})
        }
        logicLog.info(`${this} SWITCH OUT - RULE ${rule}`)
        return await rule.run(this)
    }

    async router(){
        logicLog.info(`${this} START SWITCH - EXTEN ${this.exten}`)
        // Звонок инициирован внутри телефонии
        if (this.channel.trunk){
            return await this.switchIn()
        }
        // Звонок инициирован НЕ внутри телефонии
        return await this.switchOut()
    }

    toString(){
        return `channel ${this.channel.name}`
    }
}

async function agiSwitch(agi, channel) {
    let agiSession = new AgiSession(agi, channel)
    logicLog.info(`${agiSession} AGI - NEW`)
    await agiSession.agi.asyncCommand('ANSWER')
    // Correct number
    if (agiSession.channel.trunk){
        if (agiSession.channel.number.length == 11 && agiSession.channel.number[0] == '7' && agiSession.agi.agi_callerid != ('8' + agiSession.channel.number.slice(1))){
            logicLog.info(`Change AGI CallerID from ${agiSession.agi.agi_callerid} to ${'8' + agiSession.channel.number.slice(1)}`)
            await agiSession.agi.asyncCommand(`SET CALLERID ${'8' + agiSession.channel.number.slice(1)}`)
        }
        if (!(agiSession.channel.number.length == 11 && agiSession.channel.number[0] == '7') && agiSession.agi.agi_callerid != agiSession.channel.number){
            logicLog.info(`Change AGI CallerID from ${agiSession.agi.agi_callerid} to ${agiSession.channel.number}`)
            await agiSession.agi.asyncCommand(`SET CALLERID ${agiSession.channel.number}`)
        }
    }

    // Запрашиваем добавочный
    if (agiSession.extenEmpty() && agiSession.channel.trunk && agiSession.channel.trunk.waitExten) {
        logicLog.info(`${agiSession} AGI - GET DATA`)
        await agiSession.getData()
    }

    let status = await agiSession.router()
    await agiSession.completion(status)
}

module.exports = {
    agiSwitch
}