"use strict";
const config = require('config')
const log = require('./logger')(module, 'system.log')
const { query } = require('./db')


class TrunkCollection {

    constructor(){
        this.collection = []
        this.name_dict = new Object(null)
    }

    getByChannelName(name){
        return this.name_dict[name]
    }

    remove(trunk) {
        let index = this.collection.indexOf(trunk)
        if (index > -1){
            this.collection.splice(index, 1)
            delete this.name_dict[trunk.name]
            return true
        }
        return false
    }

    async reload(){
        if (this.collection.length > 0){
            let temp_name_dict = Object.assign({}, this.name_dict)
            let temp_new_trunk = []
            let getAllTrunk = "SELECT t.id, t.location_id, t.name as t_name, t.main, t.default_rule_id, t.try_switch_in, t.wait_exten, l.name as l_name, t.number, t.tracking " +
                "FROM trunks as t " +
                "LEFT JOIN locations as l ON l.id = t.location_id"
            let rows = await query(getAllTrunk)
            for (let row in rows){
                if (row[2] in this.name_dict){
                    if (this.name_dict[row[2]].equil(row)){
                        delete temp_name_dict[row[2]]
                    } else {
                        temp_new_trunk.push(new Trunk(row))
                    }
                } else {
                    temp_new_trunk.push(new Trunk(row))
                }
            }
            for (let name of temp_name_dict) {
                this.remove(temp_name_dict[name])
                log.info(`Remove trunk ${name} from collection`)
            }
            for (let trunk of temp_new_trunk){
                this.collection.push(trunk)
                log.info(`Reloaded trunk ${trunk.name}`)
            }
        } else {
            let getAllTrunk = "SELECT t.id, t.location_id, t.name as t_name, t.main, t.default_rule_id, t.try_switch_in, t.wait_exten, l.name as l_name, t.number, t.tracking " +
                "FROM trunks as t " +
                "LEFT JOIN locations as l ON l.id = t.location_id"
            let rows = await query(getAllTrunk)
            for (let row of rows){
                let trunk = new Trunk(row)
                log.info(`Created trunk ${trunk}`)
                this.collection.push(trunk)
                this.name_dict[trunk.name] = trunk
            }
        }
    }
}

class Trunk {
    constructor(data){
        let {trunk_id, location_id, t_name, main, default_rule_id, try_switch_in, wait_exten, l_name, number, tracking} = data
        this.trunk_id = trunk_id
        this.location_id = location_id
        this.name = t_name
        this.main = main
        this.default_rule_id = default_rule_id
        this.trySwitchIn = Boolean(try_switch_in)
        this.waitExten = Boolean(wait_exten)
        this.location_name = l_name
        this.number = number
        this.tracking = tracking
        // Позже заполнит RuleCollection
        this.defaultRule = null
    }

    equil(data) {
        let [ trunk_id, location_id, name, main, default_rule_id, try_switch_in, wait_exten, location_name, number, tracking ] = data
        if (this.trunk_id != trunk_id){
            return false
        }
        if (this.location_id != location_id){
            return false
        }
        if (this.name != name){
            return false
        }
        if (this.default_rule_id != default_rule_id){
            return false
        }
        if (this.trySwitchIn != (try_switch_in == 1)){
            return false
        }
        if (this.waitExten != (wait_exten == 1)){
            return false
        }
        if (this.location_name != location_name){
            return false
        }
        if (this.number != number){
            return false
        }
        if (this.tracking != tracking){
            return false
        }
        return true
    }

    toString(){
        return `- Trunk ${this.name} | Location_name ${this.location_name} | Default Rule ${this.default_rule_id} | Try Switch In ${this.trySwitchIn} | Wait Exten ${this.waitExten} | Tracking ${this.tracking}`
    }
}


module.exports = {
    TrunkCollection
}