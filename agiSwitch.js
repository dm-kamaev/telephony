"use strict";
const logicLog = require('./logger')(module, 'logic.log')
const errorLog = require('./logger')(module, 'error.log')
const { backgroundQuery } = require('./db')
const { sendRequest, backgroundTask } = require('./utils')
const { URL } = require('url')
const { appInterface } = require('./ami')

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
    'WEBHOOK_FAILURE': null,
    'WEBHOOK_WRONG_RESPONSE': null,
    'WEBHOOK_SENT': null,
    'MENU_FAILURE': null,
    'MENU_TIMEOUT': null,
    'MENU_HANGUP': null,
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
        if (!this.exten){
            return true
        }
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
                WEBHOOK_FAILURE - Нужен был ответ от сервера 1С, но ответ не был получен.
                WEBHOOK_WRONG_RESPONSE - Ответ от сервера 1С был получен в неизвестном формате.
                WEBHOOK_SENT - Webhook отправлен без ожидания ответа.
                MENU_FAILURE - Ответ от астериска не пришел.
                MENU_TIMEOUT - Не нажато нужное количество клавиш за таймаут.
                MENU_HANGUP - Звонок был сброшен.
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
        try {
            const currentDate = new Date()
            let saveRunRuleSQL = "INSERT INTO rule_run (rule_id, channel_id, previous_result, datetime) VALUES ($1, $2, $3, $4)"
            backgroundQuery(saveRunRuleSQL, async ()=>[null, await this.channel.id, status, currentDate])
        } catch (e){
            errorLog.error(e)
        }
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
        if (result && result['1'] && result['1'].toString().length == 3){
            this.exten = result['1'].toString()
        }
    }

    async webhook(params, wait, rule_run) {
        const sendWebhook = async()=>{
            let postData = {'info': {}}
            if(rule_run) {
                postData.info['rule_run'] = rule_run
            }
            if (this.channel) {
                postData.info.channel = {
                    'number': this.channel.number,
                    'id': await this.channel.id
                }

                if (this.extension) {
                    postData.info.extension = {'exten': this.channel.extension.exten}
                }
                if (this.channel.trunk){
                    postData.info.channel.trunk = {
                        'name': this.channel.trunk.name,
                        'id': this.channel.trunk.trunk_id
                    }
                }
            }
            if (this.processedRules.length > 0){
                postData.info.processed_rules = []
                for (let runRule of this.processedRules){
                    postData.info.processed_rules.push({
                        'id': runRule.id,
                        'value': runRule.value
                    })
                }
            }
            const options = new URL(params.url)
            const headers = params.headers || {}
            headers['Content-Type'] = 'application/json'
            let connectionParam = {}
            connectionParam.headers = headers
            connectionParam.method = 'POST'
            connectionParam.path = options.pathname
            connectionParam.hostname = options.hostname
            connectionParam.protocol = options.protocol

            return await sendRequest(connectionParam, JSON.stringify(postData))
        }
        if(wait) {
            let response
            try {
                response = await sendWebhook()
            } catch(e) {
                errorLog.error(e)
            }
            if(!response) {
                return 'WEBHOOK_FAILURE'
            }
            let response_result
            try {
                response_result = JSON.parse(response).result
            } catch(e) {
                errorLog.error(e)
            }
            if(!response_result) {
                return 'WEBHOOK_WRONG_RESPONSE'
            }
            return response_result
        }
        else {
            backgroundTask([sendWebhook])
            return 'WEBHOOK_SENT'
        }
    }

    async menu(params){
        let {file, timeout = TIMEOUT} = params
        const maxDigits = 1
        let result = await this.agi.asyncCommand(`GET DATA "${file}" ${timeout} ${maxDigits}`)
        if(!result) {
            return 'MENU_FAILURE'
        }
        if (!result['1'] || result['1'].toString().length < maxDigits){
            return 'MENU_TIMEOUT'
        } else if(result['1'] == -1) {
            return 'MENU_HANGUP'
        } else {
            return result['1']
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
            let extension = appInterface.extensionCollection.getByExten(number)
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

        logicLog.info(`${this} EXEC "Dial" "${asterTrunkStr}/${number},${timeout}${opts}"`)
        await this.agi.asyncCommand(`EXEC "Dial" "${asterTrunkStr}/${number},${timeout}${opts}"`)
        let result = await this.agi.asyncCommand('GET VARIABLE DIALSTATUS')
        return result['2']
    }

    async switchIn(){
        if (this.extenEmpty()){
            if (this.channel.trunk.trySwitchIn){
                logicLog.info(`${this} SWITCH - GET RULE IN VALUE ${this.channel.number}`)
                let rule = appInterface.ruleCollection.getRuleFromSwitch('in', this.channel.number)
                if (rule !== appInterface.ruleCollection.EMPTY_RULE){
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
        let rule = appInterface.ruleCollection.getRuleFromSwitch('out', this.exten)
        if (rule === appInterface.ruleCollection.EMPTY_RULE && (this.exten.length == 3 || this.exten.length == 11)){
            logicLog.info(`${this} SWITCH OUT - RULE EMPTY - DIAL ${this.exten}`)
            return await this.dial({number: this.exten})
        }
        logicLog.info(`${this} SWITCH OUT - RULE ${rule}`)
        return await rule.run(this)
    }

    async router(){
        logicLog.info(`${this} START SWITCH - EXTEN ${this.exten}`)
        // Звонок инициирован НЕ внутри телефонии
        if (this.channel.trunk){
            return await this.switchIn()
        }
        // Звонок инициирован внутри телефонии
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