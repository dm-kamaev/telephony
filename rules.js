"use strict";
const { query, queryOne, backgroundQuery, backg } = require('./db')
const logicLog = require('./logger')(module, 'logic.log')
const errorLog = require('./logger')(module, 'error.log')
const { sendRequest, backgroundTask } = require('./utils')
const { URL } = require('url')
const moment = require('moment-timezone')

class RuleCollection {
    constructor() {
        this.switch = {'in': new Object(null), 'out': new Object(null)}
        this.idRuleDict = new Object(null)
        this.idTimeGroupDict = new Object(null)
        this.EMPTY_RULE = EMPTY_RULE
    }

    async reloadAll(trunkCollection) {
        // Create TimeGroup
        let idTimeGroupDict = new Object(null)
        let getTimeGroupsSQL = "SELECT tg.id, tg.name, wt.time, wt.time_zone " +
            "FROM time_groups as tg " +
            "LEFT JOIN work_time as wt ON wt.time_group_id = tg.id "
        let timeGroups_rows = await query(getTimeGroupsSQL)
        timeGroups_rows = timeGroups_rows || []
        for (let row of timeGroups_rows) {
            idTimeGroupDict[row.id] = new TimeGroup(row)
        }

        // Add holidays in TimeGroup
        let holiday_rows = await query("SELECT time_group_id, datetime_start, datetime_end, work FROM holidays")
        holiday_rows = holiday_rows || []
        for (let row of holiday_rows) {
            if (!idTimeGroupDict[row.time_group_id]) {
                errorLog.info(`Unknown time group in holiday ${JSON.stringify(row)}`)
            } else {
                idTimeGroupDict[row.time_group_id].holidays.push[{
                    start: row.datetime_start,
                    end: row.datetime_end,
                    work: row.work
                }]
            }
        }

        // Create Rule
        let idRuleDict = new Object(null)
        let rule_rows = await query("SELECT id, value, time_group_id, no_answer_rule_id, off_hours_rule_id FROM switch_rules")
        rule_rows = rule_rows || []
        for (let row of rule_rows) {
            idRuleDict[row.id] = new Rule(row)
        }

        function getRule(rule_id) {
            let rule = null
            if (rule_id) {
                rule = idRuleDict[rule_id]
                if (!rule) {
                    errorLog.error(`Unknown rule id ${rule_id}`)
                }
            }
            return rule
        }

        // Set timeGroup and SubRule in Rule
        for (let rule_id in idRuleDict) {
            if (idRuleDict[rule_id]._time_group_id) {
                let timeGroup = idTimeGroupDict[idRuleDict[rule_id]._time_group_id]
                if (!timeGroup) {
                    errorLog.error(`Unknown time group in Rule ${JSON.stringify(idRuleDict[rule_id])}`)
                } else {
                    idRuleDict[rule_id].timeGroup = timeGroup
                }
            }
            idRuleDict[rule_id]._offHoursRule = getRule(idRuleDict[rule_id]._off_hours_rule_id)
            idRuleDict[rule_id]._noAnswerRule = getRule(idRuleDict[rule_id]._no_answer_rule_id)
        }

        // Set Rule on Trunk Collection
        for (let trunk of trunkCollection.collection){
            trunk.defaultRule = getRule(trunk.default_rule_id) || EMPTY_RULE
        }

        // Create Switch
        let inSwitchDict = new Object(null)
        let outSwitchDict = new Object(null)
        let switch_rows = await query("SELECT id, type, value, rule_id FROM switch")
        switch_rows = switch_rows || []
        for (let row of switch_rows) {
            if (row.type == 'in') {
                inSwitchDict[row.value] = new Switch(row)
            } else if (row.type == 'out') {
                outSwitchDict[row.value] = new Switch(row)
            } else {
                errorLog.info(`Unknown type switch ${JSON.stringify(row)}`)
            }
        }

        // Set rule
        for (let switchValue in inSwitchDict) {
            inSwitchDict[switchValue]._rule = getRule(inSwitchDict[switchValue]._rule_id)
        }
        for (let switchValue in outSwitchDict) {
            outSwitchDict[switchValue]._rule = getRule(outSwitchDict[switchValue]._rule_id)
        }
        this.switch.in = inSwitchDict
        this.switch.out = outSwitchDict
        this.idRuleDict = idRuleDict
        this.idTimeGroupDict = idTimeGroupDict
    }

    getRuleFromSwitch(switchType, value) {
        let router = this.switch[switchType][value]
        if (router && router._rule) {
            return router._rule
        }
        return EMPTY_RULE
    }

    getRuleByID(id){
        return this.idRuleDict[id] || EMPTY_RULE
    }
}

class TimeGroup  {
    constructor (params) {
        let { id, name, time, time_zone } = params
        this.id = id
        this.name = name
        this.time = time
        this.timeZone = time_zone
        this.holidays = []
    }

    checkTime(){
        let currentDate = new Date()
        for (let holiday in this.holidays){
            if (holiday.start <= currentDate && holiday.end > currentDate){
                return holiday.work
            }
        }
        if (this.time){
            let momentNow = moment.tz(this.timeZone)
            let startWeek = momentNow.clone().hour(0).minute(0).second(0).millisecond(0)
            let timePeriod = JSON.parse(this.time)

            for (let period of timePeriod){
                let timeStart = startWeek.clone().second(period['time_start'])
                let timeEnd = startWeek.clone().second(period['time_end'])
                if (timeStart <= momentNow && momentNow <= timeEnd){
                    return true
                }
            }
            return false
        }
        return true
    }
}

class Rule {
    constructor(params){
        let {id, value, time_group_id, no_answer_rule_id, off_hours_rule_id } = params || {}
        this.id = id || null
        this.value = (value) ? JSON.parse(value) : null
        this.timeGroup = null
        this._noAnswerRule = null
        this._offHoursRule = null
        this._no_answer_rule_id = no_answer_rule_id || null
        this._time_group_id = time_group_id || null
        this._off_hours_rule_id = off_hours_rule_id || null
    }

    toString(){
        return `ID ${this.id} | Value ${(this.value) ? JSON.stringify(this.value) : null}`
    }

    get noAnswerRule(){
        return this._noAnswerRule || EMPTY_RULE
    }

    get offHoursRule(){
        return this._offHoursRule || EMPTY_RULE
    }

    async run(agiSession, previousResult) {
        previousResult = previousResult || 'NO_RULE'
        logicLog.info(`RULE id ${this.id} - RUN | param (prev result - ${previousResult}`)

        // Save run rule
        let currentDate = new Date()
        let saveRunRuleSQL = "INSERT INTO rule_run (rule_id, channel_id, previous_result, datetime, body) " +
                    "VALUES ($1, $2, $3, $4, $5)"
        backgroundQuery(saveRunRuleSQL, async ()=>[this.id, await agiSession.channel.id, previousResult, currentDate, this.value ? JSON.stringify(this.value) : null])

        // Check processed_rule
        if (agiSession.processedRules.indexOf(this) > -1){
            logicLog.error(`${agiSession} Зацикливание правила - ${this.value}, previousResult - ${previousResult}`)

            return previousResult
        }

        // Check Empty Rule
        if (this === EMPTY_RULE){
            logicLog.info(`${agiSession} RULE EMPTY - RETURN previous result ${previousResult}`)
            return previousResult
        }

        // Execute rule
        agiSession.processedRules.push(this)
        let result
        if (this.checkTime()){
            logicLog.info(`${agiSession} RULE - CHECK TIME - TRUE`)
            try {
                result = await this.do(agiSession)
            } catch (e) {
                errorLog.error(`${agiSession} ERROR in RUN RULE ${JSON.stringify(this)}`)
                errorLog.error(e)
                return previousResult
            }
            logicLog.info(`${agiSession} - RULE - CHECK - result ${result}`)
            if (["ANSWER", "CONTINUE"].indexOf(result) > -1){
                return result
            } else {
                logicLog.info(`${agiSession} RULE - NO ANSWER id ${this._no_answer_rule_id} - RUN`)
                return await this.noAnswerRule.run(agiSession, result)
            }
        } else {
            logicLog.info(`${agiSession} RULE - CHECK TIME - FALSE | RUN OFF HOURS ${this._off_hours_rule_id}`)
            return await this.offHoursRule.run(agiSession, "OFF_HOURS")
        }
    }

    async do(agiSession){
        try {
            if (this.value['caller_id_name']){
               await agiSession.agi.asyncCommand(`SET CALLERID ${this.value['caller_id_name']}`)
            }
            if (this.value.webhook){
                backgroundTask(async()=>{
                    let postData = {"info": {
                            "rule_run": {"id": this.id, "value": this.value}
                    }}
                    if (agiSession.channel) {
                        postData.info.channel = {
                            "number": agiSession.channel.number,
                            "id": await agiSession.channel.id
                        }

                        if (agiSession.extension) {
                            postData.info.extension = {"exten": agiSession.channel.extension.exten}
                        }
                        if (agiSession.channel.trunk){
                            postData.info.channel.trunk = {
                                "name": agiSession.channel.trunk.name,
                                "id": agiSession.channel.trunk.trunk_id
                            }
                        }
                    }
                    if (agiSession.processedRules.length > 0){
                        postData.info.processed_rules = []
                        for (let runRule of agiSession.processedRules){
                            postData.info.processed_rules.push({
                                "id": runRule.id,
                                "value": runRule.value
                            })
                        }
                    }
                    const options = new URL(this.value.webhook.url)
                    const headers = this.value.headers || {}
                    headers['Content-Type'] = 'application/json'
                    let connectionParam = {}
                    connectionParam.headers = headers
                    connectionParam.method = 'POST'
                    connectionParam.path = options.pathname
                    connectionParam.hostname = options.hostname
                    connectionParam.protocol = options.protocol

                    await sendRequest(connectionParam, JSON.stringify(postData))
                })
            }
        } catch (e){
            errorLog.error(e)
        }
        switch (this.value.command){
            case 'call':
                return await agiSession.call(this.value.params)
            case 'dial':
                if (this.value.params && this.value.params.force){
                    let {trunk: asterTrunkStr, number, timeout, music_class} = this.value.params
                    return await agiSession.call({asterTrunkStr, number, timeout, music_class})
                }
                return await agiSession.dial(this.value.params)
            case 'queue':
                return await agiSession.queue(this.value.params)
            case 'playback':
                return await agiSession.playback(this.value.params)
            default:
                logicLog.error(`Unknown type command in rule ${JSON.stringify(this)}`)
                throw new Error('Unknown type command in rule')
        }
    }

    checkTime (){
        if (!this.timeGroup) {
            return true
        }
        return this.timeGroup.checkTime()
    }


}

class Switch {
    constructor (params){
        let { id, type, value, rule_id } = params
        this.id = id
        this.type = type
        this.value = value
        this._rule_id = rule_id
        this._rule = null
    }

    get rule(){
        return this._rule || EMPTY_RULE
    }
}

const EMPTY_RULE = new Rule()


module.exports = {
    RuleCollection,
}