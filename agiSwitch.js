"use strict";
const logicLog = require('logger')(module, 'logic.log')
const {ruleCollection, extensionCollection} = require('./ami')

const TIMEOUT = 300

const completionActionDict = {
    // CUSTOM status
    'NO_RULE': [async (agiSession)=> await agiSession.asyncCommand('EXEC Playback "/var/lib/asterisk/moh/messages/CHANUNAVAIL"')]
}

            // let action_dict = {
            //
            //     # AstDom Status
            //     'NO_RULE': [(True, self.agi.execute, 'Playback', '/var/lib/asterisk/moh/messages/CHANUNAVAIL'), ],
            //     'PAUSE': None,
            //     'DND': [(True, self.agi.execute, 'Playback', '/var/lib/asterisk/moh/messages/DND'), ],
            //     'PLAYBACK_SUCCESS': None,
            //     'PLAYBACK_FAILURE': [(False, critical_completion, 'STATUS PLAYBACK_FAILURE')],
            //     # lock типа AFK
            //     'AFK': [(True, self.agi.execute, 'Playback', '/var/lib/asterisk/moh/messages/DND'), ],
            //     'BUSY_CHAN_1': [(True, self.agi.execute, 'Playback', '/var/lib/asterisk/moh/messages/BUSY'), ],
            //     'BUSY_CHAN_2': [(True, self.agi.execute, 'Playback', '/var/lib/asterisk/moh/messages/BUSY'), ],
            //     # Dial Status
            //     'CHANUNAVAIL': [check_chanunavail(), ],
            //     'CONGESTION': [(False, critical_completion, 'STATUS CONGESTION'), ],
            //     'NOANSWER': [(True, self.agi.execute, 'Playback', '/var/lib/asterisk/moh/messages/NOANSWER'), ],
            //     'BUSY': [(True, self.agi.execute, 'Playback', '/var/lib/asterisk/moh/messages/BUSY'), ],
            //     'ANSWER': None,
            //     'CANCEL': [(False, critical_completion, 'STATUS CANCEL'), ],
            //     'DONTCALL': [(False, critical_completion, 'STATUS DONTCALL'), ],
            //     'TORTURE': [(False, critical_completion, 'STATUS TORTURE'), ],
            //     'INVALIDARGS': [(False, critical_completion, 'STATUS INVALIDARGS'), ],
            //     # Queue Status
            //     'TIMEOUT': [(True, self.agi.execute, 'Playback', '/var/lib/asterisk/moh/messages/TIMEOUT'),
            //                 (False, critical_completion, 'STATUS TIMEOUT'),
            //                 ],
            //     'FULL': [(False, critical_completion, 'STATUS FULL'), ],
            //     'JOINEMPTY': [(True, self.agi.execute, 'Playback', '/var/lib/asterisk/moh/messages/TIMEOUT'),
            //                   (False, critical_completion, 'STATUS TIMEOUT'),
            //                   ],
            //     'LEAVEEMPTY': [(True, self.agi.execute, 'Playback', '/var/lib/asterisk/moh/messages/TIMEOUT'),
            //                    (False, critical_completion, 'STATUS LEAVEEMPTY'),
            //                    ],
            //     'JOINUNAVAIL': [(True, self.agi.execute, 'Playback', '/var/lib/asterisk/moh/messages/TIMEOUT'),
            //                     (False, critical_completion, 'STATUS JOINUNAVAIL'),
            //                     ],
            //     'LEAVEUNAVAIL': [(True, self.agi.execute, 'Playback', '/var/lib/asterisk/moh/messages/TIMEOUT'),
            //                      (False, critical_completion, 'STATUS LEAVEUNAVAIL'),
            //                      ],
            //     'CONTINUE': None,
            //     'UNKNOWN': [(True, self.agi.execute, 'Playback', '/var/lib/asterisk/moh/messages/TIMEOUT'),
            //                 (False, critical_completion, 'STATUS JOINUNAVAIL'),
            //                 ],
            // }

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
        logicLog.info(`${this} AGI - COMPLETION status ${status}`)
        status = status.toUpperCase()
        await completionActionDict['NO_RULE'][0](this.agi)
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

    async dial(params){
        //await this.agi.asyncCommand(`EXEC Dial SIP/${number}, 60`)
        let { preferred = null, asterTrunkStr = null, number = null, timeout = TIMEOUT } = params
        logicLog.info(`${this} DIAL | preferred ${preferred}, trunk ${asterTrunkStr}, Number ${number}, Timeout ${timeout}`)
        let result
        if (number.length == 3){
            if (!asterTrunkStr){
                asterTrunkStr = "SIP"
            }
            let extension = extensionCollection.getByExten(number)
            if (!extension){
                logicLog.info(`${this} DIAL - DIAL AST`)
                // Вернуть статус, номер не существует
                result = await this.call({asterTrunkStr, number, timeout})
            } else {
                if (extension.DND){
                    logicLog.info(`${this} DIAL - RETURN DND`)
                    result = 'DND'
                } else {
                    if (extension.channels.collection.length == 0){
                        logicLog.info(`${this} DIAL - RUN CALL`)
                        result = await this.call({asterTrunkStr, number, timeout})
                    } else if (extension.channels.collection.length == 1){
                        logicLog.info(`${this} DIAL - RUN CALL second line`)
                        // TODO without answer test
                        result = await this.call({asterTrunkStr, number, timeout, music_class:'second-call'})
                    } else {
                        logicLog.info(`${this} DIAL - RETURN BUSY_CHAN_2`)
                        result = 'BUSY_CHAN_2'
                    }
                }
            }
            // TODO SECURE
        } else if (number.length == 11){
            if (asterTrunkStr == null){
                asterTrunkStr = this.channel.extension.default_trunk
            }
            logicLog.info(`${this} DIAL - RUN CALL`)
            result = await this.call({asterTrunkStr, number, timeout})
            // TODO SECURE
        } else {
            if (asterTrunkStr == null){
                asterTrunkStr = 'SIP'
            }
            logicLog.info(`${this} DIAL - RUN CALL`)
            result = await this.call({asterTrunkStr, number, timeout})
        }
        return result
    }

    async call(params){
        let {trunk, number, timeout=TIMEOUT, music_class=null} = params
        let opts = ''
        if (music_class){
            opts += `m(${music_class})`
        }

        if (opts != ''){
            opts = "," + opts
        }

        logicLog.info(`${this} Dial ${trunk}/${number}, ${timeout}, ${opts}`)
        await this.agi.asyncCommand(`EXEC Dial ${trunk}/${number}, ${timeout}${opts}`)
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