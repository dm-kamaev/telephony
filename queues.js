"use strict";
const { query, queryOne, backgroundQuery } = require('./db')
const logicLog = require('./logger')(module, 'logic.log')
const errorLog = require('./logger')(module, 'error.log')

class QueueCollection {
    constructor(ami){
        this.collection = []
        this.nameDict = new Object(null)
        this.idDict = new Object(null)
        this.ami = ami
    }

    receivedQueue(name){
        let queue = this.nameDict[name]
        if (queue){
            logicLog.info(`Queue ${queue.name} already exist`)
        } else {
            queue = new Queue(name, this)
            this.collection.push(queue)
            this.nameDict[queue.name] = queue
            logicLog.info(`Queue ${queue.name} received`)
        }
    }

    requestAgentsFromAsterisk(){
        this.ami.action('QueueStatus')
    }

    async loadFromDB(){
        let getQueuesSQL = "SELECT id, name, abandon_webhook " +
                "FROM queues " +
                "WHERE active IS True"
        let rows = await query(getQueuesSQL)
        await this._compare(rows)
    }

    async _compare(rows){
        rows = rows || []
        for (let row of rows){
            let queue = this.nameDict[row.name]
            if (queue) {
                queue.id = row.id
                if (row.abandon_webhook){
                    queue.abandonWebhook = JSON.parse(row.abandon_webhook)
                }
                this.idDict[queue.id] = queue
            } else {
                errorLog.error(`Queue ${queue.name} not found in Asterisk`)
            }
        }
        for (let queue of this.collection){
            if (!queue.id){
                errorLog.error(`Queue ${queue.name} not found in Database`)
            }
        }
        await this._reloadQueuesAgents()
    }

    async _reloadQueuesAgents(){
        for (let queue of this.collection){
            await queue._reloadAgents()
        }
    }

    reload(){
        this.collection = []
        this.nameDict = new Object(null)
        this.idDict = new Object(null)
        this.ami.action('QueueSummary')
    }
}

class Queue {
    constructor (name, queues) {
        this.name = name
        this.agents = []
        this.id = null
        this.abandonWebhook = null
        this.queues = queues
        this.agentDict = new Object(null)
        this.asteriskAgent = new Object(null)
    }

    async _reloadAgents(){
        let getAgentsSQL = "SELECT e.extension, qa.penalty, qa.id " +
                "FROM queue_agents as qa " +
                "INNER JOIN extensions as e ON e.id = qa.extension_id " +
                "WHERE queue_id = $1"
        let rows = await query(getAgentsSQL, [this.id])
        if (rows) {
            for (let row of rows){
                // Если есть в астериске сравниваем параметры
                if (this.asteriskAgent[row.extension]){
                    logicLog.info(`Agent ${row.extension} Queue ${this.name} already exist`)
                    let agent = await this._addAgent(row.extension, row.penalty, row.id, false)
                    delete this.asteriskAgent[row.extension]
                    await this._compareAgent(agent, row.penalty)
                // Создаем в астериске
                } else {
                    logicLog.info(`Agent ${row.extension} Queue ${this.name} loaded from Database`)
                    await this._addAgent(row.extension, row.penalty, row.id, true)

                }
            }
        }
        // Удаляем всех несуществующих агентов в бд из астериска
        await this._removeAgents(this.asteriskAgent)
    }

    async _removeAgents(agents){
        for (let number in agents){
            await this.queues.ami.asyncAction('QueueRemove', {
                'Queue': this.name,
                'Interface': 'SIP/' + number
            })
            logicLog.info(`Agents ${number} Queue ${this.name} remove from Asterisk`)
        }
        logicLog.info(`Reloaded Queue ${this.name} finished`)
    }

    async _compareAgent(agent, penalty){
        if (agent.penalty != penalty){
            await this.queues.ami.asyncAction('QueuePenalty', {
                'Queue': this.name,
                'Penalty': penalty,
                'Interface': 'SIP/' + agent.number
            })
            agent.penalty = penalty
        }
    }

    async _addAgent(number, penalty, id, needCreateAsterisk){
        id = id || null
        let agent = new Agent(number, penalty, id)
        this.agents.push(agent)
        this.agentDict[agent.number] = agent
        if (needCreateAsterisk){
            await this.queues.ami.asyncAction('QueueAdd', {
                'Queue': this.name,
                'Interface': 'SIP/' + agent.number,
                'Penalty': agent.penalty,
                'Paused': 'False'
            })
            logicLog.info(`Agents ${agent.number} add to Queue ${this.name} Penalty ${agent.penalty}`)
        }
        return agent
    }



}

class Agent {
    constructor(number, penalty, id){
        this.number = number
        this.penalty = penalty
        this.id = id
        this.live = null
    }
}

module.exports = {
    QueueCollection
}